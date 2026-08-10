import { zipSync } from 'fflate'
import { BOOTSTRAP_DOCUMENT_FILENAME } from './bootstrap-document'
import {
  extractAssetPathsFromHtml,
  PACKAGE_MANIFEST_FILENAME,
  REQUIRED_PACKAGE_FILES,
  type WebxdcPackageManifest,
} from './package-manifest'

/**
 * Injected by Delta Chat / webxdc hosts — not shipped inside .xdc packages.
 * Never treat as a hard packing requirement.
 */
const HOST_PROVIDED_FILES = new Set(['webxdc.js'])

/** Nested font CSS is unused once fonts.css is flattened for webxdc:// MIME safety. */
const NESTED_FONT_CSS = new Set([
  'fonts/shabnam/shabnam.css',
  'fonts/shabnam/shabnam-full.css',
  'fonts/shabnam/shabnam-lite.css',
  'fonts/arad/arad.css',
  'fonts/arad/arad-full.css',
  'fonts/arad/arad-lite.css',
])

const DEV_INDEX_RE = /\/src\/main\.ts|@vite\/client|\/@vite\/|src\/main\.ts/

const fetchAsBytes = async (zipPath: string): Promise<Uint8Array | null> => {
  try {
    const url = new URL(zipPath, window.location.href).href
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }
    return new Uint8Array(await response.arrayBuffer())
  } catch {
    return null
  }
}

const dirname = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

/** Resolve `./x` / `../x` relative to a zip-style path (no leading slash). */
const resolveZipPath = (fromPath: string, rel: string): string | null => {
  const cleaned = rel.trim().replace(/^\.\//, '')
  if (
    !cleaned
    || cleaned.startsWith('data:')
    || cleaned.startsWith('http://')
    || cleaned.startsWith('https://')
    || cleaned.startsWith('//')
    || cleaned.startsWith('/')
  ) {
    return null
  }

  const base = dirname(fromPath)
  const joined = base ? `${base}/${cleaned}` : cleaned
  const stack: string[] = []
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

/**
 * Collect url(...) and @import targets from a CSS file (or HTML with inline CSS)
 * so font binaries are included in re-exported packages.
 */
const extractCssReferences = (cssPath: string, cssText: string): string[] => {
  const out: string[] = []
  const importRe = /@import\s+(?:url\(\s*)?['"]?([^'")\s]+)['"]?\s*\)?\s*;/gi
  const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi

  for (const re of [importRe, urlRe]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(cssText)) !== null) {
      const resolved = resolveZipPath(cssPath, match[1])
      if (resolved) out.push(resolved)
    }
  }
  return out
}

/**
 * Rewrite url('./File.woff2') → url('./subdir/File.woff2') so rules can live
 * in fonts/fonts.css without nested @import (webxdc:// MIME-safe).
 */
const rewriteFontUrls = (css: string, subdir: string): string =>
  css.replace(
    /url\(\s*(['"]?)\.\/([^'")]+)\1\s*\)/g,
    (_m, q: string, file: string) => `url(${q}./${subdir}/${file}${q})`,
  )

/**
 * fonts/fonts.css uses paths relative to the fonts/ folder (`./arad/…`).
 * When the same rules are inlined into index.html they must be document-root
 * relative (`./fonts/arad/…`).
 */
const rewriteFontCssForDocumentRoot = (css: string): string => {
  if (/url\(\s*['"]?\.\/fonts\//.test(css)) return css
  return css.replace(
    /url\(\s*(['"]?)\.\/([^'")]+)\1\s*\)/g,
    (_m, q: string, path: string) => `url(${q}./fonts/${path}${q})`,
  )
}

/**
 * If fonts/fonts.css still uses @import (vite dist / browser), inline into one
 * flat sheet. Delta Chat often serves nested .css as text/plain, which Chromium
 * refuses to apply.
 */
const flattenFontsCssIfNeeded = (
  files: Record<string, Uint8Array>,
): void => {
  const key = 'fonts/fonts.css'
  const raw = files[key]
  if (!raw) return

  const text = new TextDecoder().decode(raw)
  if (!text.includes('@import')) return

  const parts: string[] = [
    '/* Flat fonts.css (no @import) — rewritten at export for webxdc:// MIME safety */',
  ]
  const importRe = /@import\s+(?:url\(\s*)?['"]?([^'")\s]+)['"]?\s*\)?\s*;/gi
  let match: RegExpExecArray | null
  const imports: string[] = []
  while ((match = importRe.exec(text)) !== null) {
    const resolved = resolveZipPath(key, match[1])
    if (resolved) imports.push(resolved)
  }

  for (const importPath of imports) {
    const bytes = files[importPath]
    if (!bytes) continue
    let css = new TextDecoder().decode(bytes)
    // Nested sheets may themselves @import (arad.css → arad-full.css).
    if (css.includes('@import')) {
      const nested: string[] = []
      const nestedRe = /@import\s+(?:url\(\s*)?['"]?([^'")\s]+)['"]?\s*\)?\s*;/gi
      let m: RegExpExecArray | null
      while ((m = nestedRe.exec(css)) !== null) {
        const r = resolveZipPath(importPath, m[1])
        if (r) nested.push(r)
      }
      const nestedParts: string[] = []
      for (const n of nested) {
        const nb = files[n]
        if (nb) nestedParts.push(new TextDecoder().decode(nb).trim())
      }
      css = nestedParts.join('\n\n')
    }
    const subdir = dirname(importPath).replace(/^fonts\//, '')
    // arad/arad-full.css → subdir "arad"
    const faceDir = subdir.includes('/') ? subdir.split('/')[0]! : subdir
    parts.push(rewriteFontUrls(css.trim(), faceDir), '')
  }

  if (parts.length <= 1) return

  files[key] = new TextEncoder().encode(parts.join('\n'))

  for (const nested of NESTED_FONT_CSS) {
    delete files[nested]
  }
}

/**
 * Delta Chat’s webxdc:// handler often serves standalone .css with a MIME type
 * Chromium rejects (`text/plain` + nosniff). Inlining @font-face into index.html
 * avoids that: the HTML document is text/html and <style> always applies.
 * Font *binaries* (.woff2) still load as separate files (those MIME types work).
 */
const inlineFontsIntoIndexHtml = (files: Record<string, Uint8Array>): void => {
  const indexBytes = files['index.html']
  if (!indexBytes) return

  let html = new TextDecoder().decode(indexBytes)
  if (DEV_INDEX_RE.test(html)) {
    throw new Error('pack-dev-index')
  }

  // Prefer fonts/fonts.css; fall back to already-inlined block for re-export.
  let fontCss = ''
  const fontsFile = files['fonts/fonts.css']
  if (fontsFile) {
    fontCss = rewriteFontCssForDocumentRoot(
      new TextDecoder().decode(fontsFile),
    )
  } else {
    const existing = html.match(
      /<!-- webxdc-fonts -->\s*<style>([\s\S]*?)<\/style>\s*<!-- \/webxdc-fonts -->/i,
    )
    if (existing?.[1]) fontCss = existing[1].trim()
  }

  if (!fontCss || !fontCss.includes('@font-face')) {
    // No fonts to inline — leave HTML alone (dev/partial packages).
    return
  }

  // Drop external fonts stylesheet link(s).
  html = html.replace(
    /<link\b[^>]*href=["'][^"']*fonts\/fonts\.css["'][^>]*>\s*/gi,
    '',
  )
  // Drop previous inline block if re-packing.
  html = html.replace(
    /<!-- webxdc-fonts -->[\s\S]*?<!-- \/webxdc-fonts -->\s*/gi,
    '',
  )

  const block =
    `<!-- webxdc-fonts -->\n<style>\n${fontCss.trim()}\n</style>\n<!-- /webxdc-fonts -->\n`

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${block}</head>`)
  } else {
    html = block + html
  }

  files['index.html'] = new TextEncoder().encode(html)
}

const assertProductionPackageHtml = (html: string): void => {
  if (DEV_INDEX_RE.test(html)) {
    throw new Error('pack-dev-index')
  }
  // Built app always emits hashed assets under ./assets/
  if (!/(?:\.\/)?assets\/[^"'>\s]+\.js/i.test(html)) {
    throw new Error('pack-not-production')
  }
}

const loadPackagePaths = async (): Promise<string[]> => {
  try {
    const response = await fetch(
      new URL(`./${PACKAGE_MANIFEST_FILENAME}`, window.location.href).href,
    )
    if (response.ok) {
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('text/html')) {
        const manifest = (await response.json()) as WebxdcPackageManifest
        if (Array.isArray(manifest.files) && manifest.files.length > 0) {
          return manifest.files.filter((f) => !HOST_PROVIDED_FILES.has(f))
        }
      }
    }
  } catch {
    // Fall back to parsing index.html below.
  }

  const indexResponse = await fetch(
    new URL('./index.html', window.location.href).href,
  )
  if (!indexResponse.ok) {
    return [...REQUIRED_PACKAGE_FILES]
  }

  const html = await indexResponse.text()
  assertProductionPackageHtml(html)

  return extractAssetPathsFromHtml(html).filter(
    (f) => !HOST_PROVIDED_FILES.has(f),
  )
}

export const canPackWebxdcPackage = async () => {
  try {
    const indexResponse = await fetch(
      new URL('./index.html', window.location.href).href,
    )
    if (!indexResponse.ok) return false
    const html = await indexResponse.text()
    if (DEV_INDEX_RE.test(html)) return false
    if (!/(?:\.\/)?assets\/[^"'>\s]+\.js/i.test(html)) return false

    const response = await fetch(
      new URL('./manifest.toml', window.location.href).href,
    )
    return response.ok
  } catch {
    return false
  }
}

export const collectWebxdcPackageFiles = async (): Promise<
  Record<string, Uint8Array>
> => {
  const seedPaths = await loadPackagePaths()
  const files: Record<string, Uint8Array> = {}
  const pending = [...seedPaths]
  const seen = new Set<string>()
  const missing: string[] = []

  while (pending.length > 0) {
    const zipPath = pending.shift()!
    if (seen.has(zipPath)) continue
    seen.add(zipPath)

    if (
      zipPath === BOOTSTRAP_DOCUMENT_FILENAME
      || zipPath === PACKAGE_MANIFEST_FILENAME
      || HOST_PROVIDED_FILES.has(zipPath)
    ) {
      continue
    }

    // Never pack Vite / absolute-dev paths
    if (
      zipPath.startsWith('/')
      || zipPath.includes('@vite')
      || zipPath.endsWith('main.ts')
      || zipPath.includes('src/main')
    ) {
      continue
    }

    const bytes = await fetchAsBytes(zipPath)
    if (!bytes) {
      missing.push(zipPath)
      continue
    }

    files[zipPath] = bytes

    // Follow stylesheet / inline-style references so .woff2 fonts are packed.
    if (zipPath.endsWith('.css') || zipPath === 'index.html') {
      const text = new TextDecoder().decode(bytes)
      if (zipPath === 'index.html') {
        assertProductionPackageHtml(text)
      }
      for (const ref of extractCssReferences(zipPath, text)) {
        if (!seen.has(ref) && !HOST_PROVIDED_FILES.has(ref)) {
          pending.push(ref)
        }
      }
    }
  }

  // Font/CSS refs discovered while walking stylesheets must exist; otherwise the
  // exported app would 404 (e.g. Arad-*.woff2). Host-provided files never enter
  // the queue.
  if (missing.length > 0) {
    throw new Error(`pack-missing-files:${missing.join(',')}`)
  }

  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!files[required]) {
      throw new Error(`pack-missing-root:${required}`)
    }
  }

  flattenFontsCssIfNeeded(files)
  inlineFontsIntoIndexHtml(files)

  // After inlining, collect any font urls that only appear in the rewritten index.
  const indexText = new TextDecoder().decode(files['index.html']!)
  for (const ref of extractCssReferences('index.html', indexText)) {
    if (files[ref] || HOST_PROVIDED_FILES.has(ref)) continue
    const bytes = await fetchAsBytes(ref)
    if (!bytes) {
      throw new Error(`pack-missing-files:${ref}`)
    }
    files[ref] = bytes
  }

  return files
}

export const buildWebxdcPackageBlob = async (
  bootstrapDocumentJson: string,
  downloadName = 'collab-editor.xdc',
) => {
  const files = await collectWebxdcPackageFiles()

  files[BOOTSTRAP_DOCUMENT_FILENAME] = new TextEncoder().encode(
    bootstrapDocumentJson,
  )

  const manifestFiles = [
    ...Object.keys(files).filter(
      (name) =>
        name !== PACKAGE_MANIFEST_FILENAME
        && name !== BOOTSTRAP_DOCUMENT_FILENAME,
    ),
    BOOTSTRAP_DOCUMENT_FILENAME,
    PACKAGE_MANIFEST_FILENAME,
  ].sort()

  files[PACKAGE_MANIFEST_FILENAME] = new TextEncoder().encode(
    JSON.stringify({ version: 1, files: manifestFiles }, null, 2),
  )

  const zipped = zipSync(files)

  return new Blob([zipped], {
    type: downloadName.endsWith('.xdc')
      ? 'application/x-xdc'
      : 'application/zip',
  })
}

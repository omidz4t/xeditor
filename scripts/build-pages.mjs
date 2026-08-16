#!/usr/bin/env node
/**
 * Assemble GitHub Pages output in dist-pages/:
 *   dist-pages/index.html     ← marketing site (from site/)
 *   dist-pages/versions.html  ← version list + artifact links
 *   dist-pages/versions.json  ← machine-readable release metadata
 *   dist-pages/screenshots/** ← product screenshots for the landing page
 *   dist-pages/app/**         ← editor build (from dist/)
 *   dist-pages/app/webxdc.js  ← browser mock only (IndexedDB-backed)
 *
 * Version placeholders (__XEDITOR_*__) are filled from package.json / env /
 * git tags. Marketing + mock are NOT part of WebXDC packages.
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const siteDir = join(root, 'site')
const distDir = join(root, 'dist')
const outDir = join(root, 'dist-pages')
const appDir = join(outDir, 'app')
const mockWebxdc = join(root, 'src/dev/webxdc-mock-idb.js')

const REPO =
  process.env.XEDITOR_REPO
  || process.env.GITHUB_REPOSITORY
  || 'omidz4t/xeditor'

function assertDir(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    console.error(`${label} missing: ${path}`)
    process.exit(1)
  }
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  return String(pkg.version || '0.0.0').replace(/^v/, '')
}

function normalizeVersionTag(name) {
  return String(name || '')
    .trim()
    .replace(/^refs\/tags\//, '')
    .replace(/^v/, '')
}

function sortVersionsDesc(versions) {
  return [...versions].sort((a, b) => {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
    const len = Math.max(pa.length, pb.length)
    for (let i = 0; i < len; i += 1) {
      const d = (pb[i] || 0) - (pa[i] || 0)
      if (d) return d
    }
    return 0
  })
}

function listLocalGitVersions() {
  try {
    const out = execFileSync(
      'git',
      ['tag', '--list', 'v*', '--sort=-v:refname'],
      { cwd: root, encoding: 'utf8' },
    )
    return out
      .split('\n')
      .map((t) => normalizeVersionTag(t))
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Prefer GitHub tags/releases so the versions page lists everything published. */
function listGitHubVersions(limit = 100) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'xeditor-build-pages',
  }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const tryEndpoints = [
    `https://api.github.com/repos/${REPO}/releases?per_page=${limit}`,
    `https://api.github.com/repos/${REPO}/tags?per_page=${limit}`,
  ]

  for (const url of tryEndpoints) {
    try {
      const raw = execFileSync(
        'curl',
        ['-fsSL', '-H', `Accept: ${headers.Accept}`, '-H', `User-Agent: ${headers['User-Agent']}`, ...(process.env.GITHUB_TOKEN ? ['-H', `Authorization: Bearer ${process.env.GITHUB_TOKEN}`] : []), url],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      )
      const data = JSON.parse(raw)
      if (!Array.isArray(data) || !data.length) continue
      const versions = data
        .map((item) => normalizeVersionTag(item.tag_name || item.name))
        .filter((v) => /^\d+\.\d+/.test(v))
      if (versions.length) return sortVersionsDesc([...new Set(versions)]).slice(0, limit)
    } catch {
      // try next endpoint / fall back to local tags
    }
  }
  return []
}

function listGitVersions(limit = 100) {
  const remote = listGitHubVersions(limit)
  const local = listLocalGitVersions()
  const merged = sortVersionsDesc([...new Set([...remote, ...local])])
  return merged.slice(0, limit)
}

function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) {
    const n = kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10
    return `${n} KB`
  }
  const mb = kb / 1024
  const n = mb >= 10 ? Math.round(mb * 10) / 10 : Math.round(mb * 100) / 100
  return `${n} MB`
}

/** Read local WebXDC package sizes from dist-xdc/ (or env overrides). */
function readLocalXdcSizes() {
  const dir = join(root, 'dist-xdc')
  const files = {
    app: 'app.xdc',
    full: 'editor-full.xdc',
    lite: 'editor-lite.xdc',
  }
  /** @type {{ app: number|null, full: number|null, lite: number|null, labels: Record<string,string> }} */
  const sizes = { app: null, full: null, lite: null, labels: {} }
  for (const [key, name] of Object.entries(files)) {
    const envKey = `XEDITOR_${key.toUpperCase()}_XDC_BYTES`
    if (process.env[envKey] && Number.isFinite(Number(process.env[envKey]))) {
      sizes[key] = Number(process.env[envKey])
    } else {
      const abs = join(dir, name)
      if (existsSync(abs) && statSync(abs).isFile()) {
        sizes[key] = statSync(abs).size
      }
    }
    sizes.labels[key] = formatBytes(sizes[key])
  }
  return sizes
}

function releaseMeta(version, sizes = null) {
  const v = version.replace(/^v/, '')
  const tag = `v${v}`
  const base = `https://github.com/${REPO}/releases`
  return {
    version: v,
    tag,
    releaseUrl: `${base}/tag/${tag}`,
    releasesUrl: base,
    assets: {
      app: `${base}/download/${tag}/app.xdc`,
      full: `${base}/download/${tag}/editor-full.xdc`,
      lite: `${base}/download/${tag}/editor-lite.xdc`,
    },
    sizes: sizes
      ? {
          app: sizes.app,
          full: sizes.full,
          lite: sizes.lite,
          appLabel: sizes.labels.app,
          fullLabel: sizes.labels.full,
          liteLabel: sizes.labels.lite,
        }
      : null,
  }
}

function applyPlaceholders(html, meta) {
  const s = meta.sizes || {}
  return html
    .replaceAll('__XEDITOR_VERSION__', meta.version)
    .replaceAll('__XEDITOR_TAG__', meta.tag)
    .replaceAll('__XEDITOR_REPO__', REPO)
    .replaceAll('__XEDITOR_RELEASE_URL__', meta.releaseUrl)
    .replaceAll('__XEDITOR_RELEASES_URL__', meta.releasesUrl)
    .replaceAll('__XEDITOR_APP_XDC_URL__', meta.assets.app)
    .replaceAll('__XEDITOR_FULL_XDC_URL__', meta.assets.full)
    .replaceAll('__XEDITOR_LITE_XDC_URL__', meta.assets.lite)
    .replaceAll('__XEDITOR_APP_XDC_SIZE__', s.appLabel || '—')
    .replaceAll('__XEDITOR_FULL_XDC_SIZE__', s.fullLabel || '—')
    .replaceAll('__XEDITOR_LITE_XDC_SIZE__', s.liteLabel || '—')
}

function versionsTableHtml(versions, latest) {
  if (!versions.length) {
    return `<p class="versions-empty">No published versions yet.</p>`
  }

  const rows = versions
    .map((ver) => {
      const m = releaseMeta(ver)
      const isLatest = ver === latest
      const latestMark = isLatest ? ' <span class="ver-latest">latest</span>' : ''
      return `<tr class="ver-row${isLatest ? ' ver-row--latest' : ''}" data-version="${m.version}">
  <th scope="row" class="ver-row__tag">v${m.version}${latestMark}</th>
  <td><a href="${m.assets.app}">app.xdc</a></td>
  <td><a href="${m.assets.full}">full</a></td>
  <td><a href="${m.assets.lite}">lite</a></td>
  <td class="ver-row__notes"><a href="${m.releaseUrl}" target="_blank" rel="noopener">notes</a></td>
</tr>`
    })
    .join('\n')

  return `<div class="ver-table-wrap">
<table class="ver-table">
  <thead>
    <tr>
      <th scope="col">Version</th>
      <th scope="col">app.xdc</th>
      <th scope="col">full</th>
      <th scope="col">lite</th>
      <th scope="col"></th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
</div>`
}

// ── main ─────────────────────────────────────────────────────────────────────

assertDir(siteDir, 'site/')
assertDir(distDir, 'dist/ (run npm run build first)')

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('dist/index.html missing — editor build incomplete')
  process.exit(1)
}

if (!existsSync(join(siteDir, 'index.html'))) {
  console.error('site/index.html missing')
  process.exit(1)
}

if (!existsSync(mockWebxdc)) {
  console.error('browser webxdc mock missing:', mockWebxdc)
  process.exit(1)
}

const version = (process.env.XEDITOR_VERSION || readPackageVersion()).replace(/^v/, '')
const xdcSizes = readLocalXdcSizes()
const meta = releaseMeta(version, xdcSizes)
let history = listGitVersions(40)
if (!history.includes(version)) {
  history = [version, ...history]
}
// de-dupe keep order
history = [...new Set(history)]

const payload = {
  generatedAt: new Date().toISOString(),
  repo: REPO,
  latest: meta,
  // Only the current build has measured package sizes locally
  versions: history.map((v) => releaseMeta(v, v === version ? xdcSizes : null)),
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })

// 1) Marketing landing at site root
cpSync(siteDir, outDir, { recursive: true })

// 2) Editor under /app/
cpSync(distDir, appDir, { recursive: true })

// Screenshots belong on the marketing site only — not inside /app/ (or .xdc).
const appShots = join(appDir, 'screenshots')
if (existsSync(appShots)) {
  rmSync(appShots, { recursive: true, force: true })
}

// Prefer fresh Puppeteer output; fall back to docs/screenshots if present.
const shotsSrcCandidates = [
  join(distDir, 'screenshots'),
  join(root, 'docs/screenshots'),
]
const shotsSrc = shotsSrcCandidates.find(
  (p) => existsSync(p) && statSync(p).isDirectory(),
)
if (shotsSrc) {
  const shotsOut = join(outDir, 'screenshots')
  mkdirSync(shotsOut, { recursive: true })
  cpSync(shotsSrc, shotsOut, { recursive: true })
  console.log(`  screenshots ← ${relative(root, shotsSrc)}/`)
} else {
  console.warn('  warning: no screenshots dir (dist/screenshots or docs/screenshots)')
}

// 3) Browser-only WebXDC mock
writeFileSync(
  join(appDir, 'webxdc.js'),
  `/* Browser demo mock — IndexedDB-backed. Not used inside real WebXDC hosts. */\n${readFileSync(mockWebxdc, 'utf8')}`,
  'utf8',
)

// 4) Inject version + download URLs into HTML pages
for (const name of ['index.html', 'versions.html', 'fa/index.html']) {
  const path = join(outDir, name)
  if (!existsSync(path)) continue
  let html = readFileSync(path, 'utf8')
  html = applyPlaceholders(html, meta)
  if (name === 'versions.html') {
    html = html.replace(
      '<!-- __XEDITOR_VERSIONS_TABLE__ -->',
      versionsTableHtml(history, version),
    )
  }
  if (html.includes('__XEDITOR_')) {
    console.warn(`warning: unresolved placeholders remain in ${name}`)
  }
  writeFileSync(path, html, 'utf8')
}

// 5) Machine-readable catalog for the site / debugging
writeFileSync(join(outDir, 'versions.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

// 6) Strip any .xdc from pages tree
function stripXdc(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) stripXdc(abs)
    else if (name.endsWith('.xdc') || name.endsWith('.webxdc')) rmSync(abs)
  }
}
stripXdc(outDir)

writeFileSync(join(outDir, '.nojekyll'), '')
writeFileSync(
  join(outDir, 'robots.txt'),
  ['User-agent: *', 'Allow: /', ''].join('\n'),
)

const listing = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs)
    else listing.push(relative(outDir, abs).split('\\').join('/'))
  }
}
walk(outDir)

if (!existsSync(join(appDir, 'webxdc.js'))) {
  console.error('failed to write dist-pages/app/webxdc.js')
  process.exit(1)
}

console.log(`Pages site → ${relative(root, outDir)}/`)
console.log(`  version:  v${version}`)
console.log(`  release:  ${meta.releaseUrl}`)
console.log(`  app.xdc:  ${meta.assets.app} (${xdcSizes.labels.app})`)
console.log(`  full.xdc: ${xdcSizes.labels.full}`)
console.log(`  lite.xdc: ${xdcSizes.labels.lite}`)
console.log(`  history:  ${history.length} tag(s)`)
console.log(`  landing:  index.html`)
console.log(`  versions: versions.html + versions.json`)
console.log(`  editor:   app/`)
console.log(`  total:    ${listing.length} files`)
console.log('WebXDC packages remain in dist-xdc/ only (no mock / no marketing).')

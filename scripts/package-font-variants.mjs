#!/usr/bin/env node
/**
 * After `vite build`, produce two WebXDC packages:
 *   dist-xdc/editor-full.xdc  — Arad only (all weights) — no Shabnam
 *   dist-xdc/editor-lite.xdc  — Regular + Bold only (woff2) for Shabnam + Arad
 *
 * Also keeps dist-xdc/app.xdc as a copy of full (default build artifact).
 *
 * Important for Delta Chat webxdc://:
 * - Do NOT use CSS @import chains (nested .css often arrives as text/plain and
 *   Chromium refuses to apply them). Write one flat fonts/fonts.css with all
 *   @font-face rules and correct relative font URLs.
 * - ALSO inline that CSS into index.html as <style>: some DC versions still
 *   serve standalone .css as text/plain + nosniff, so <link rel=stylesheet>
 *   is rejected even for a single flat sheet.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')
const outDir = join(root, 'dist-xdc')
const fontsRoot = join(root, 'public/fonts')

if (!existsSync(dist)) {
  console.error('dist/ missing — run vite build first')
  process.exit(1)
}

/** Recursively collect files as { zipPath: Uint8Array } */
function collectFiles(dir, base = dir, into = {}) {
  for (const name of readdirSync(dir)) {
    // Screenshots / docs are for the site build, not the .xdc payload
    if (name === 'screenshots') continue
    // Host injects webxdc.js in Delta Chat; browser mock must never ship in .xdc
    if (name === 'webxdc.js') continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      collectFiles(abs, base, into)
    } else {
      const zipPath = relative(base, abs).split('\\').join('/')
      into[zipPath] = new Uint8Array(readFileSync(abs))
    }
  }
  return into
}

/**
 * Embed a complete file list so runtime re-export (Export WebXDC / share as .xdc)
 * packs fonts and assets without re-parsing index.html (which omits CSS url()s).
 */
function writePackageManifest(files) {
  const names = Object.keys(files)
    .filter((name) => name !== 'package-manifest.json')
    .sort()
  // package-manifest.json is always present in the zip
  names.push('package-manifest.json')
  names.sort()
  files['package-manifest.json'] = new Uint8Array(
    Buffer.from(JSON.stringify({ version: 1, files: names }, null, 2), 'utf8'),
  )
}

function zipTo(path, files) {
  writePackageManifest(files)
  const zipped = zipSync(files, { level: 6 })
  writeFileSync(path, zipped)
  const kb = (zipped.byteLength / 1024).toFixed(0)
  console.log(`  wrote ${relative(root, path)} (${kb} KB, ${Object.keys(files).length} files)`)
}

function deleteKeys(files, keys) {
  for (const k of keys) delete files[k]
}

function deletePrefixExcept(files, prefix, keep) {
  for (const key of Object.keys(files)) {
    if (!key.startsWith(prefix)) continue
    if (!keep.has(key)) delete files[key]
  }
}

/**
 * Rewrite url('./File.woff2') → url('./subdir/File.woff2') so rules can live
 * in fonts/fonts.css (one hop from HTML) without nested @import.
 */
function rewriteFontUrls(css, subdir) {
  return css.replace(
    /url\(\s*(['"]?)\.\/([^'")]+)\1\s*\)/g,
    (_m, q, file) => `url(${q}./${subdir}/${file}${q})`,
  )
}

/**
 * fonts/fonts.css paths are relative to fonts/ (`./arad/…`).
 * Inlined into index.html they must be document-root relative (`./fonts/arad/…`).
 */
function rewriteFontCssForDocumentRoot(css) {
  if (/url\(\s*['"]?\.\/fonts\//.test(css)) return css
  return css.replace(
    /url\(\s*(['"]?)\.\/([^'")]+)\1\s*\)/g,
    (_m, q, path) => `url(${q}./fonts/${path}${q})`,
  )
}

/**
 * Delta Chat webxdc:// often serves standalone .css as text/plain + nosniff,
 * so Chromium refuses <link rel=stylesheet>. Inline @font-face into index.html
 * (text/html) — font binaries still load as .woff2 files.
 */
function inlineFontsIntoIndex(files, fontsCssText) {
  const indexKey = 'index.html'
  if (!files[indexKey]) {
    throw new Error('index.html missing from package files')
  }
  let html = Buffer.from(files[indexKey]).toString('utf8')

  html = html.replace(
    /<link\b[^>]*href=["'][^"']*fonts\/fonts\.css["'][^>]*>\s*/gi,
    '',
  )
  html = html.replace(
    /<!-- webxdc-fonts -->[\s\S]*?<!-- \/webxdc-fonts -->\s*/gi,
    '',
  )

  const css = rewriteFontCssForDocumentRoot(fontsCssText)
  const block =
    `<!-- webxdc-fonts -->\n<style>\n${css.trim()}\n</style>\n<!-- /webxdc-fonts -->\n`

  if (!/<\/head>/i.test(html)) {
    throw new Error('index.html has no </head> — cannot inline fonts')
  }
  html = html.replace(/<\/head>/i, `${block}</head>`)
  files[indexKey] = new Uint8Array(Buffer.from(html, 'utf8'))
}

function readFontCss(relPath) {
  return readFileSync(join(fontsRoot, relPath), 'utf8')
}

/** Single stylesheet: no @import (webxdc MIME-safe). */
function buildFlatFontsCss({ shabnamFile = null, aradFile = null, label }) {
  const parts = [`/* ${label} — flat (no @import) for webxdc:// MIME safety */`]
  if (shabnamFile) {
    parts.push(rewriteFontUrls(readFontCss(shabnamFile), 'shabnam').trim(), '')
  }
  if (aradFile) {
    parts.push(rewriteFontUrls(readFontCss(aradFile), 'arad').trim(), '')
  }
  return parts.join('\n')
}

function stripExtraFontCss(files) {
  // Nested CSS is unused once fonts.css is flat; drop to shrink the package
  // and avoid accidental @import usage.
  deleteKeys(files, [
    'fonts/shabnam/shabnam.css',
    'fonts/shabnam/shabnam-full.css',
    'fonts/shabnam/shabnam-lite.css',
    'fonts/arad/arad.css',
    'fonts/arad/arad-full.css',
    'fonts/arad/arad-lite.css',
  ])
}

function applyFontsToPackage(files, flatCss) {
  files['fonts/fonts.css'] = new Uint8Array(Buffer.from(flatCss, 'utf8'))
  stripExtraFontCss(files)
  // Primary load path: inline into HTML (avoids CSS MIME rejection on webxdc://).
  // Keep fonts/fonts.css for re-export tooling / path walking.
  inlineFontsIntoIndex(files, flatCss)
}

/** Full package: Arad only (all weights) — no Shabnam. */
function packageFull() {
  const files = collectFiles(dist)

  // Drop entire Shabnam tree from the full/app package
  for (const key of Object.keys(files)) {
    if (key.startsWith('fonts/shabnam/')) delete files[key]
  }

  applyFontsToPackage(
    files,
    buildFlatFontsCss({
      aradFile: 'arad/arad-full.css',
      label: 'Full: Arad only (all weights)',
    }),
  )

  mkdirSync(outDir, { recursive: true })
  zipTo(join(outDir, 'editor-full.xdc'), files)
  zipTo(join(outDir, 'app.xdc'), files)
}

/**
 * Lite package: Regular + Bold only (woff2) for both fonts.
 */
function packageLite() {
  const files = collectFiles(dist)

  deletePrefixExcept(
    files,
    'fonts/shabnam/',
    new Set([
      'fonts/shabnam/Shabnam.woff2',
      'fonts/shabnam/Shabnam-Bold.woff2',
      // shabnam.css removed by strip; keep only woff2
    ]),
  )
  deletePrefixExcept(
    files,
    'fonts/arad/',
    new Set([
      'fonts/arad/Arad-Regular.woff2',
      'fonts/arad/Arad-Bold.woff2',
      'fonts/arad/OFL.txt',
    ]),
  )

  applyFontsToPackage(
    files,
    buildFlatFontsCss({
      shabnamFile: 'shabnam/shabnam-lite.css',
      aradFile: 'arad/arad-lite.css',
      label: 'Lite: Shabnam + Arad (Regular + Bold)',
    }),
  )

  mkdirSync(outDir, { recursive: true })
  zipTo(join(outDir, 'editor-lite.xdc'), files)
}

/** Keep dist/ package-manifest in sync so browser re-export can list fonts. */
function writeDistPackageManifest() {
  const files = collectFiles(dist)
  // Manifest lists on-disk dist files (may still use nested @import CSS;
  // runtime pack-webxdc flattens when re-exporting).
  writePackageManifest(files)
  writeFileSync(
    join(dist, 'package-manifest.json'),
    Buffer.from(files['package-manifest.json']),
  )
  console.log(
    `  wrote dist/package-manifest.json (${JSON.parse(Buffer.from(files['package-manifest.json']).toString('utf8')).files.length} paths)`,
  )
}

/**
 * vite preview / plain static servers need a browser mock; Delta Chat injects
 * its own webxdc.js and must never receive this file inside .xdc (excluded above).
 */
function writeBrowserWebxdcMock() {
  const mockPath = join(root, 'src/dev/webxdc-mock-idb.js')
  if (!existsSync(mockPath)) {
    console.warn('  skip dist/webxdc.js — mock missing at src/dev/webxdc-mock-idb.js')
    return
  }
  const body =
    `/* Browser preview mock — IndexedDB-backed. Not used inside real WebXDC hosts. */\n${readFileSync(mockPath, 'utf8')}`
  writeFileSync(join(dist, 'webxdc.js'), body)
  console.log('  wrote dist/webxdc.js (browser mock for vite preview)')
}

console.log('Packaging WebXDC font variants…')
packageFull()
packageLite()
writeDistPackageManifest()
writeBrowserWebxdcMock()
console.log('Done.')
console.log('  full → dist-xdc/editor-full.xdc (also app.xdc) — Arad only, all weights')
console.log('  lite → dist-xdc/editor-lite.xdc — Shabnam + Arad (Regular + Bold woff2)')

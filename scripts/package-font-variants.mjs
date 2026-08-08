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

function zipTo(path, files) {
  const zipped = zipSync(files, { level: 6 })
  writeFileSync(path, zipped)
  const kb = (zipped.byteLength / 1024).toFixed(0)
  console.log(`  wrote ${relative(root, path)} (${kb} KB)`)
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

/** Full package: Arad only (all weights) — no Shabnam. */
function packageFull() {
  const files = collectFiles(dist)

  // Drop entire Shabnam tree from the full/app package
  for (const key of Object.keys(files)) {
    if (key.startsWith('fonts/shabnam/')) delete files[key]
  }

  files['fonts/fonts.css'] = new Uint8Array(
    Buffer.from(
      buildFlatFontsCss({
        aradFile: 'arad/arad-full.css',
        label: 'Full: Arad only (all weights)',
      }),
      'utf8',
    ),
  )
  stripExtraFontCss(files)

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

  files['fonts/fonts.css'] = new Uint8Array(
    Buffer.from(
      buildFlatFontsCss({
        shabnamFile: 'shabnam/shabnam-lite.css',
        aradFile: 'arad/arad-lite.css',
        label: 'Lite: Shabnam + Arad (Regular + Bold)',
      }),
      'utf8',
    ),
  )
  stripExtraFontCss(files)

  mkdirSync(outDir, { recursive: true })
  zipTo(join(outDir, 'editor-lite.xdc'), files)
}

console.log('Packaging WebXDC font variants…')
packageFull()
packageLite()
console.log('Done.')
console.log('  full → dist-xdc/editor-full.xdc (also app.xdc) — Arad only, all weights')
console.log('  lite → dist-xdc/editor-lite.xdc — Shabnam + Arad (Regular + Bold woff2)')

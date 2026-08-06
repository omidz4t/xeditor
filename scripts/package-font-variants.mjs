#!/usr/bin/env node
/**
 * After `vite build`, produce two WebXDC packages:
 *   dist-xdc/editor-full.xdc  — all Shabnam + Arad weights
 *   dist-xdc/editor-lite.xdc  — Regular + Bold only (woff2) for both fonts
 *
 * Also keeps dist-xdc/app.xdc as a copy of full (default build artifact).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')
const outDir = join(root, 'dist-xdc')

if (!existsSync(dist)) {
  console.error('dist/ missing — run vite build first')
  process.exit(1)
}

/** Recursively collect files as { zipPath: Uint8Array } */
function collectFiles(dir, base = dir, into = {}) {
  for (const name of readdirSync(dir)) {
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

/** Full package: all font weights for Shabnam + Arad. */
function packageFull() {
  const files = collectFiles(dist)

  files['fonts/shabnam/shabnam.css'] = new Uint8Array(
    readFileSync(join(root, 'public/fonts/shabnam/shabnam-full.css')),
  )
  files['fonts/arad/arad.css'] = new Uint8Array(
    readFileSync(join(root, 'public/fonts/arad/arad-full.css')),
  )
  // Single entry CSS used by index.html
  files['fonts/fonts.css'] = new Uint8Array(
    Buffer.from(
      "/* Full: Shabnam + Arad (all weights) */\n@import './shabnam/shabnam.css';\n@import './arad/arad.css';\n",
      'utf8',
    ),
  )

  deleteKeys(files, [
    'fonts/shabnam/shabnam-full.css',
    'fonts/shabnam/shabnam-lite.css',
    'fonts/arad/arad-full.css',
    'fonts/arad/arad-lite.css',
  ])

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
      'fonts/shabnam/shabnam.css',
    ]),
  )
  deletePrefixExcept(
    files,
    'fonts/arad/',
    new Set([
      'fonts/arad/Arad-Regular.woff2',
      'fonts/arad/Arad-Bold.woff2',
      'fonts/arad/arad.css',
      'fonts/arad/OFL.txt',
    ]),
  )

  files['fonts/shabnam/shabnam.css'] = new Uint8Array(
    readFileSync(join(root, 'public/fonts/shabnam/shabnam-lite.css')),
  )
  files['fonts/arad/arad.css'] = new Uint8Array(
    readFileSync(join(root, 'public/fonts/arad/arad-lite.css')),
  )
  files['fonts/fonts.css'] = new Uint8Array(
    Buffer.from(
      "/* Lite: Shabnam + Arad (Regular + Bold) */\n@import './shabnam/shabnam.css';\n@import './arad/arad.css';\n",
      'utf8',
    ),
  )

  deleteKeys(files, [
    'fonts/shabnam/shabnam-full.css',
    'fonts/shabnam/shabnam-lite.css',
    'fonts/arad/arad-full.css',
    'fonts/arad/arad-lite.css',
  ])

  mkdirSync(outDir, { recursive: true })
  zipTo(join(outDir, 'editor-lite.xdc'), files)
}

console.log('Packaging WebXDC font variants (Shabnam + Arad)…')
packageFull()
packageLite()
console.log('Done.')
console.log('  full → dist-xdc/editor-full.xdc (also app.xdc)')
console.log('  lite → dist-xdc/editor-lite.xdc (Regular + Bold woff2 only)')

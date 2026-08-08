#!/usr/bin/env node
/**
 * Assemble GitHub Pages output in dist-pages/:
 *   dist-pages/index.html     ← marketing site (from site/)
 *   dist-pages/app/**         ← editor build (from dist/)
 *   dist-pages/app/webxdc.js  ← browser mock only (IndexedDB-backed)
 *
 * The marketing site and mock webxdc.js are intentionally NOT part of
 * `dist/` / WebXDC packages (real Delta Chat provides webxdc.js).
 * Run after `npm run build` (or `vite build`).
 */
import {
  cpSync,
  copyFileSync,
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

function assertDir(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    console.error(`${label} missing: ${path}`)
    process.exit(1)
  }
}

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

// Guard: never let a production dist accidentally ship a mock webxdc.js into .xdc
if (existsSync(join(distDir, 'webxdc.js'))) {
  console.warn(
    'warning: dist/webxdc.js exists — WebXDC hosts inject their own API; ' +
      'removing from Pages copy source is recommended for .xdc purity',
  )
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })

// 1) Marketing landing at site root
cpSync(siteDir, outDir, { recursive: true })

// 2) Editor under /app/ (relative asset base `./` from vite still works)
cpSync(distDir, appDir, { recursive: true })

// 3) Browser-only WebXDC mock (IndexedDB status history). NOT included in .xdc.
//    index.html loads <script src="webxdc.js"> — required for /app/ demo.
const mockOut = join(appDir, 'webxdc.js')
const mockSrc = readFileSync(mockWebxdc, 'utf8')
writeFileSync(
  mockOut,
  `/* Browser demo mock — IndexedDB-backed. Not used inside real WebXDC hosts. */\n${mockSrc}`,
  'utf8',
)

// 4) Never ship WebXDC archives on Pages
function stripXdc(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) stripXdc(abs)
    else if (name.endsWith('.xdc') || name.endsWith('.webxdc')) rmSync(abs)
  }
}
stripXdc(outDir)

// 5) Helpful robots / no-jekyll for GitHub Pages
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
console.log(`  landing:  index.html (+ site assets)`)
console.log(`  editor:   app/  (${listing.filter((p) => p.startsWith('app/')).length} files)`)
console.log(`  mock:     app/webxdc.js (IndexedDB browser mock)`)
console.log(`  total:    ${listing.length} files`)
console.log('WebXDC packages remain in dist-xdc/ only (no mock webxdc.js there).')

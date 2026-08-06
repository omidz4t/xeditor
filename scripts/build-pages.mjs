#!/usr/bin/env node
/**
 * Assemble GitHub Pages output in dist-pages/:
 *   dist-pages/index.html     ← marketing site (from site/)
 *   dist-pages/app/**         ← editor build (from dist/)
 *
 * The marketing site is intentionally NOT part of `dist/` / WebXDC packages.
 * Run after `npm run build` (or `vite build`).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
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

rmSync(outDir, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })

// 1) Marketing landing at site root
cpSync(siteDir, outDir, { recursive: true })

// 2) Editor under /app/ (relative asset base `./` from vite still works)
cpSync(distDir, appDir, { recursive: true })

// 3) Never ship WebXDC archives on Pages
function stripXdc(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) stripXdc(abs)
    else if (name.endsWith('.xdc') || name.endsWith('.webxdc')) rmSync(abs)
  }
}
stripXdc(outDir)

// 4) Helpful robots / no-jekyll for GitHub Pages
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

console.log(`Pages site → ${relative(root, outDir)}/`)
console.log(`  landing:  index.html (+ site assets)`)
console.log(`  editor:   app/  (${listing.filter((p) => p.startsWith('app/')).length} files)`)
console.log(`  total:    ${listing.length} files`)
console.log('WebXDC packages remain in dist-xdc/ only (not copied here).')

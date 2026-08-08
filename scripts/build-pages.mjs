#!/usr/bin/env node
/**
 * Assemble GitHub Pages output in dist-pages/:
 *   dist-pages/index.html     ← marketing site (from site/)
 *   dist-pages/versions.html  ← version list + artifact links
 *   dist-pages/versions.json  ← machine-readable release metadata
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

function listGitVersions(limit = 30) {
  try {
    const out = execFileSync(
      'git',
      ['tag', '--list', 'v*', '--sort=-v:refname'],
      { cwd: root, encoding: 'utf8' },
    )
    const tags = out
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => t.replace(/^v/, ''))
    if (tags.length) return tags.slice(0, limit)
  } catch {
    // not a git checkout
  }
  return []
}

function releaseMeta(version) {
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
  }
}

function applyPlaceholders(html, meta) {
  return html
    .replaceAll('__XEDITOR_VERSION__', meta.version)
    .replaceAll('__XEDITOR_TAG__', meta.tag)
    .replaceAll('__XEDITOR_REPO__', REPO)
    .replaceAll('__XEDITOR_RELEASE_URL__', meta.releaseUrl)
    .replaceAll('__XEDITOR_RELEASES_URL__', meta.releasesUrl)
    .replaceAll('__XEDITOR_APP_XDC_URL__', meta.assets.app)
    .replaceAll('__XEDITOR_FULL_XDC_URL__', meta.assets.full)
    .replaceAll('__XEDITOR_LITE_XDC_URL__', meta.assets.lite)
}

function versionsTableHtml(versions, latest) {
  const rows = versions
    .map((ver) => {
      const m = releaseMeta(ver)
      const latestBadge =
        ver === latest
          ? ' <span class="version-pill" style="font-size:0.7rem">latest</span>'
          : ''
      return `<tr>
  <td class="tag">v${m.version}${latestBadge}</td>
  <td><a href="${m.releaseUrl}">Notes</a></td>
  <td><a href="${m.assets.app}">app.xdc</a></td>
  <td><a href="${m.assets.full}">editor-full.xdc</a></td>
  <td><a href="${m.assets.lite}">editor-lite.xdc</a></td>
</tr>`
    })
    .join('\n')

  return `<table class="version-table">
  <thead>
    <tr>
      <th>Version</th>
      <th>Release</th>
      <th>Default</th>
      <th>Full fonts</th>
      <th>Lite fonts</th>
    </tr>
  </thead>
  <tbody>
${rows || '<tr><td colspan="5">No version tags yet.</td></tr>'}
  </tbody>
</table>`
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
const meta = releaseMeta(version)
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
  versions: history.map((v) => releaseMeta(v)),
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })

// 1) Marketing landing at site root
cpSync(siteDir, outDir, { recursive: true })

// 2) Editor under /app/
cpSync(distDir, appDir, { recursive: true })

// 3) Browser-only WebXDC mock
writeFileSync(
  join(appDir, 'webxdc.js'),
  `/* Browser demo mock — IndexedDB-backed. Not used inside real WebXDC hosts. */\n${readFileSync(mockWebxdc, 'utf8')}`,
  'utf8',
)

// 4) Inject version + download URLs into HTML pages
for (const name of ['index.html', 'versions.html']) {
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
console.log(`  app.xdc:  ${meta.assets.app}`)
console.log(`  history:  ${history.length} tag(s)`)
console.log(`  landing:  index.html`)
console.log(`  versions: versions.html + versions.json`)
console.log(`  editor:   app/`)
console.log(`  total:    ${listing.length} files`)
console.log('WebXDC packages remain in dist-xdc/ only (no mock / no marketing).')

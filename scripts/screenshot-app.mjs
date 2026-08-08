#!/usr/bin/env node
/**
 * Capture small UI screenshots of XEditor (landing + block editor) with Puppeteer.
 *
 * Goals
 * ─────
 * • Align crops with real UI chrome (topbar, sidebar, editor, dialogs)
 * • Keep each file ~8–20 KB (JPEG, modest viewport, quality ladder)
 * • Work against a running server OR auto-start `vite` for the app
 *
 * Quick start
 * ───────────
 *   # one-time
 *   npm i -D puppeteer
 *
 *   # against local Vite (auto-starts if BASE_URL not set)
 *   npm run screenshots
 *
 *   # against GitHub Pages demo
 *   BASE_URL=https://omidz4t.github.io/xeditor npm run screenshots
 *
 *   # only a few stages
 *   npm run screenshots -- --only landing-hero,app-editor,app-settings
 *
 *   # mobile-ish frame
 *   npm run screenshots -- --width 390 --height 844 --device-scale 2
 *
 * Output
 * ──────
 *   docs/screenshots/*.jpg
 *   docs/screenshots/manifest.json   ← paths + byte sizes for docs / CI
 *
 * Env
 * ───
 *   BASE_URL          Site root (default: start local Vite on 5173, app at /)
 *   APP_PATH          App path under BASE_URL (default: "" for vite, "/app/" for pages)
 *   OUT_DIR           Override output dir (default: docs/screenshots)
 *   TARGET_KB         Soft max size per image (default: 14)
 *   HEADLESS          "false" to watch the browser
 *   NO_SERVER         "1" — never spawn Vite; require BASE_URL / open port
 *
 * Examples (after capture)
 * ────────────────────────
 *   ![Editor](docs/screenshots/app-editor.jpg)
 *   ![Sync setup](docs/screenshots/app-sync-local.jpg)
 */

import { spawn } from 'node:child_process'
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const OUT_DIR = process.env.OUT_DIR
  ? join(root, process.env.OUT_DIR)
  : join(root, 'docs/screenshots')
const TARGET_KB = Number(process.env.TARGET_KB || 12)
const HEADLESS = process.env.HEADLESS !== 'false'

// ── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(name)
  if (i === -1) return null
  return args[i + 1] ?? true
}
const onlyList = String(flag('--only') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const VIEW_W = Number(flag('--width') || process.env.WIDTH || 1100)
const VIEW_H = Number(flag('--height') || process.env.HEIGHT || 700)
const DEVICE_SCALE = Number(flag('--device-scale') || process.env.DEVICE_SCALE || 1)

// ── Stages (edit / extend freely) ────────────────────────────────────────────

/**
 * Each stage is either:
 *   { id, path, waitFor, prepare?, clip? }
 * or produces multiple shots via prepare(page) + shot helpers.
 *
 * `path` is relative to BASE_URL.
 * `clip` optional { x, y, width, height } in CSS pixels.
 */
const STAGES = [
  {
    id: 'landing-hero',
    title: 'Marketing hero',
    path: '/',
    waitFor: '.hero h1, .brand',
    // Clip computed from .hero element (viewport-relative) for small files
    clipFrom: '.hero',
    clipPad: { x: 8, y: 8, maxW: 720, maxH: 400 },
  },
  {
    id: 'landing-download',
    title: 'Download cards',
    path: '/#download',
    waitFor: '#download',
    prepare: async (page) => {
      await page.evaluate(() => {
        document.querySelector('#download')?.scrollIntoView({ block: 'start' })
      })
      await sleep(250)
    },
    clipFrom: '#download',
    clipPad: { x: 8, y: 8, maxW: 720, maxH: 440 },
  },
  {
    id: 'app-sync-setup',
    title: 'Sync mode dialog (browser: local only)',
    path: 'APP',
    waitFor: '.sync-setup-panel, .page, .xeditor-topbar, .block-editor',
    prepare: async (page) => {
      // Dialog may already be open on first load; wait either way.
      await sleep(600)
    },
  },
  {
    id: 'app-editor',
    title: 'Block editor main canvas',
    path: 'APP',
    waitFor: '.block-editor, .xeditor-topbar, .page-content',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      // Seed a short demo document for a richer frame
      await seedDemoContent(page)
      await sleep(300)
    },
  },
  {
    id: 'app-editor-focus',
    title: 'Editor focused mid-document',
    path: 'APP',
    waitFor: '.block-editor',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await seedDemoContent(page)
      await page.evaluate(() => {
        const ed = document.querySelector('.block-editor [contenteditable="true"]')
        ed?.scrollIntoView({ block: 'center' })
        ed?.focus()
      })
      await sleep(200)
    },
  },
  {
    id: 'app-sidebar',
    title: 'Page sidebar open',
    path: 'APP',
    waitFor: '.page-sidebar, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await ensureSidebarOpen(page)
      await sleep(250)
    },
  },
  {
    id: 'app-settings',
    title: 'Settings dialog',
    path: 'APP',
    waitFor: '.settings-panel, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await openSettings(page)
      await sleep(300)
    },
  },
  {
    id: 'app-settings-sync',
    title: 'Settings → Sync tab (local only in browser)',
    path: 'APP',
    waitFor: '.block-editor, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await openSettings(page)
      await openSettingsTab(page, 'Sync')
      await page.waitForSelector('.settings-panel', { timeout: 8000 })
      await sleep(250)
    },
  },
]

// ── Helpers: app interactions ────────────────────────────────────────────────

async function pickLocalSyncIfNeeded(page) {
  // Browser demo shows SyncModeSetup — pick Local only if visible.
  const btn = await page.$('.sync-setup-option')
  if (!btn) return
  // Prefer the enabled / recommended local option
  const clicked = await page.evaluate(() => {
    const options = [...document.querySelectorAll('.sync-setup-option')]
    const local = options.find((el) =>
      /local/i.test(el.textContent || ''),
    )
    const enabled = options.find(
      (el) => !el.classList.contains('sync-setup-option--disabled'),
    )
    const target = local && !local.classList.contains('sync-setup-option--disabled')
      ? local
      : enabled
    if (target) {
      target.click()
      return true
    }
    return false
  })
  if (clicked) await sleep(500)
  // Wait for dialog to go away
  await page.waitForFunction(
    () => !document.querySelector('.sync-setup-panel'),
    { timeout: 8000 },
  ).catch(() => {})
}

async function waitForEditor(page) {
  await page.waitForSelector('.block-editor, .editor-container, .page-content', {
    timeout: 20000,
  })
  await sleep(400)
}

async function seedDemoContent(page) {
  // Type via keyboard into the first contenteditable if empty-ish
  await page.evaluate(() => {
    const root = document.querySelector('.block-editor')
    if (!root) return
    const editable = root.querySelector('[contenteditable="true"]')
    if (!editable) return
    editable.focus()
  })
  // Only inject once per page session
  const already = await page.evaluate(() => {
    const t = document.querySelector('.block-editor')?.innerText || ''
    return t.includes('Welcome to XEditor')
  })
  if (already) return

  // Use slash / typing if possible — fallback: title field
  try {
    await page.keyboard.type('Welcome to XEditor', { delay: 8 })
    await page.keyboard.press('Enter')
    await page.keyboard.type('A collaborative block editor for Delta Chat.', {
      delay: 5,
    })
    await page.keyboard.press('Enter')
    await page.keyboard.type('- Local mode stores data in IndexedDB', { delay: 4 })
    await page.keyboard.press('Enter')
    await page.keyboard.type('- Export packages as .xdc for chat', { delay: 4 })
  } catch {
    // ignore interaction failures on constrained builds
  }
  await sleep(200)
}

async function ensureSidebarOpen(page) {
  const open = await page.evaluate(() => {
    const sb = document.querySelector('.page-sidebar')
    if (!sb) return false
    // open class or visible width
    return (
      sb.classList.contains('page-sidebar--open')
      || sb.getAttribute('data-open') === 'true'
      || sb.getBoundingClientRect().width > 120
    )
  })
  if (open) return
  // Click sidebar toggle in topbar
  await page.evaluate(() => {
    const btn =
      document.querySelector('[aria-label*="sidebar" i]')
      || document.querySelector('.xeditor-topbar__island--left button')
    btn?.click()
  })
  await sleep(300)
}

async function openSettings(page) {
  if (await page.$('.settings-panel')) return

  // Settings lives under the topbar "More" menu on this UI.
  await page.evaluate(() => {
    const more =
      document.querySelector('button[aria-label="More actions"]')
      || document.querySelector('.xeditor-more-btn')
      || [...document.querySelectorAll('button')].find((b) =>
        /more/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''),
      )
    more?.click()
  })
  await sleep(200)

  const opened = await page.evaluate(() => {
    if (document.querySelector('.settings-panel')) return true
    const item = [...document.querySelectorAll('button, [role="menuitem"]')].find((el) =>
      /settings/i.test(el.textContent || ''),
    )
    item?.click()
    return !!item
  })
  if (!opened) throw new Error('Could not open settings')
  await page.waitForSelector('.settings-panel', { timeout: 8000 })
}

async function openSettingsTab(page, tipOrLabel) {
  await page.evaluate((label) => {
    const tabs = [...document.querySelectorAll('.settings-tab, [role="tab"]')]
    const tab = tabs.find((el) =>
      new RegExp(label, 'i').test(el.textContent || el.getAttribute('title') || ''),
    )
    tab?.click()
  }, tipOrLabel)
  await sleep(200)
}

// ── Capture + compress ───────────────────────────────────────────────────────

/**
 * Binary-search JPEG quality so file is ≤ TARGET_KB when possible.
 * Falls back to lowest quality if still large (e.g. very busy UI).
 */
async function resolveClip(page, stage) {
  if (stage.clip) return stage.clip
  if (!stage.clipFrom) return undefined
  const pad = stage.clipPad || {}
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    el.scrollIntoView({ block: 'start', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
    }
  }, stage.clipFrom)
  if (!box || box.width < 2 || box.height < 2) return undefined
  const vw = box.vw || VIEW_W
  const vh = box.vh || VIEW_H
  let x = Math.floor(box.x - (pad.x || 0))
  let y = Math.floor(box.y - (pad.y || 0))
  let width = Math.ceil(box.width + (pad.x || 0) * 2)
  let height = Math.ceil(box.height + (pad.y || 0) * 2)
  if (pad.maxW) width = Math.min(width, pad.maxW)
  if (pad.maxH) height = Math.min(height, pad.maxH)
  // Clamp into visible viewport
  if (x < 0) {
    width += x
    x = 0
  }
  if (y < 0) {
    height += y
    y = 0
  }
  width = Math.min(width, vw - x)
  height = Math.min(height, vh - y)
  if (width < 8 || height < 8) {
    // Element not usefully visible — full viewport fallback
    return undefined
  }
  return { x, y, width, height }
}

function sanitizeClip(clip) {
  if (!clip) return undefined
  const x = Math.max(0, Math.round(Number(clip.x) || 0))
  const y = Math.max(0, Math.round(Number(clip.y) || 0))
  const width = Math.max(0, Math.round(Number(clip.width) || 0))
  const height = Math.max(0, Math.round(Number(clip.height) || 0))
  if (width < 8 || height < 8) return undefined
  return { x, y, width, height }
}

async function captureCompressed(page, filePath, clip) {
  const qualities = [68, 58, 48, 40, 32, 26, 20, 16]
  let best = null
  let useClip = sanitizeClip(clip)
  for (const q of qualities) {
    try {
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: q,
        clip: useClip,
        captureBeyondViewport: false,
      })
      best = buf
      if (buf.byteLength <= TARGET_KB * 1024) break
    } catch (err) {
      // Bad clip (0 height / offscreen) → fall back to full viewport once
      if (useClip) {
        console.warn(`  warn: clip failed (${err.message || err}); using full viewport`)
        useClip = undefined
        continue
      }
      throw err
    }
  }
  if (!best) throw new Error('screenshot produced no buffer')
  writeFileSync(filePath, best)
  return best.byteLength
}

// ── Server bootstrap ─────────────────────────────────────────────────────────

async function waitForUrl(url, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' })
      if (res.ok || res.status === 304) return
    } catch {
      // retry
    }
    await sleep(400)
  }
  throw new Error(`Timeout waiting for ${url}`)
}

async function ensureServer() {
  if (process.env.BASE_URL) {
    const base = process.env.BASE_URL.replace(/\/$/, '')
    // GitHub Pages layout: landing at /, app at /app/
    const appPath =
      process.env.APP_PATH
      ?? (base.includes('github.io') ? '/app/' : '/')
    return { base, appPath, child: null }
  }

  const port = process.env.VITE_DEV_PORT || '5173'
  const base = `http://127.0.0.1:${port}`
  // Probe existing server
  try {
    const res = await fetch(base)
    if (res.ok) {
      console.log(`Using existing server at ${base}`)
      return { base, appPath: process.env.APP_PATH || '/', child: null }
    }
  } catch {
    // start vite
  }

  if (process.env.NO_SERVER === '1') {
    throw new Error('No server and NO_SERVER=1')
  }

  console.log(`Starting Vite on ${port}…`)
  const child = spawn('npm', ['run', 'dev'], {
    cwd: root,
    env: { ...process.env, VITE_DEV_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', () => {})
  await waitForUrl(base)
  return { base, appPath: process.env.APP_PATH || '/', child }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let puppeteer
  try {
    puppeteer = await import('puppeteer')
  } catch {
    console.error(`
Puppeteer is not installed. Add it as a dev dependency:

  npm i -D puppeteer

Then re-run:

  npm run screenshots
`)
    process.exit(1)
  }

  mkdirSync(OUT_DIR, { recursive: true })

  const { base, appPath, child } = await ensureServer()
  console.log(`Base URL: ${base}  app: ${appPath}`)

  const browser = await puppeteer.default.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  })

  const page = await browser.newPage()
  await page.setViewport({
    width: VIEW_W,
    height: VIEW_H,
    deviceScaleFactor: DEVICE_SCALE,
  })

  // Prefer light UI for consistent marketing shots
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])

  const stages = onlyList.length
    ? STAGES.filter((s) => onlyList.includes(s.id))
    : STAGES

  if (!stages.length) {
    console.error('No stages matched --only filter')
    process.exit(1)
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    base,
    viewport: { width: VIEW_W, height: VIEW_H, deviceScaleFactor: DEVICE_SCALE },
    targetKb: TARGET_KB,
    shots: [],
  }

  try {
    for (const stage of stages) {
      const pathPart = stage.path === 'APP' ? appPath : stage.path
      const url = new URL(pathPart.replace(/^\//, './'), base.endsWith('/') ? base : `${base}/`).href
        .replace(/\/\.\/?/, '/')

      // Normalize: base + path
      const fullUrl =
        stage.path === 'APP'
          ? `${base.replace(/\/$/, '')}${appPath.startsWith('/') ? appPath : `/${appPath}`}`
          : `${base.replace(/\/$/, '')}${stage.path.startsWith('/') ? stage.path : `/${stage.path}`}`

      console.log(`\n→ ${stage.id}: ${stage.title}`)
      console.log(`  ${fullUrl}`)

      await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 60000 })
      if (stage.waitFor) {
        await page.waitForSelector(stage.waitFor, { timeout: 25000 }).catch(() => {
          console.warn(`  warn: waitFor ${stage.waitFor} timed out`)
        })
      }
      if (stage.prepare) {
        try {
          await stage.prepare(page)
        } catch (e) {
          console.warn(`  warn: prepare failed: ${e.message || e}`)
        }
      }

      // Settle fonts / layout
      await sleep(250)

      const file = `${stage.id}.jpg`
      const outPath = join(OUT_DIR, file)
      const clip = await resolveClip(page, stage)
      const bytes = await captureCompressed(page, outPath, clip)
      const kb = (bytes / 1024).toFixed(1)
      console.log(`  saved ${relative(root, outPath)} (${kb} KB)`)
      manifest.shots.push({
        id: stage.id,
        title: stage.title,
        file,
        bytes,
        kb: Number(kb),
        url: fullUrl,
      })
    }
  } finally {
    await browser.close()
    if (child) {
      child.kill('SIGTERM')
    }
  }

  writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  // README snippet for docs
  const readme = `# Screenshots

Generated by \`npm run screenshots\` (Puppeteer). Target ~${TARGET_KB} KB JPEG each.

| Stage | File | Size |
|-------|------|------|
${manifest.shots.map((s) => `| ${s.title} | \`${s.file}\` | ${s.kb} KB |`).join('\n')}

\`\`\`bash
# Local Vite (auto-start)
npm run screenshots

# Production Pages
BASE_URL=https://omidz4t.github.io/xeditor npm run screenshots

# Subset
npm run screenshots -- --only landing-hero,app-editor
\`\`\`
`
  writeFileSync(join(OUT_DIR, 'README.md'), readme)

  console.log(`\nDone — ${manifest.shots.length} shot(s) → ${relative(root, OUT_DIR)}/`)
  const over = manifest.shots.filter((s) => s.bytes > TARGET_KB * 1024)
  if (over.length) {
    console.log(
      `Note: ${over.length} file(s) still over ${TARGET_KB} KB after quality ladder: ${over.map((s) => s.file).join(', ')}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

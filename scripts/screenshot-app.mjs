#!/usr/bin/env node
/**
 * Capture UI screenshots of XEditor (landing + block editor) with Puppeteer.
 *
 * Goals
 * ─────
 * • Show real chrome: top header, page title/emoji icon, sidebar, editor
 * • Higher visual quality (default ~2× DPR, JPEG q≥80, soft size budget)
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
 *   # full-screen desktop viewport (1920×1080), no UI crops
 *   npm run screenshots -- --full-screen
 *   npm run screenshots:full
 *
 *   # full-screen + scroll entire document height (long landing pages)
 *   npm run screenshots -- --full-screen --full-page
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
 *   TARGET_KB         Soft max size per image (default: 90 — quality-first)
 *   MIN_QUALITY       JPEG quality floor (default: 82)
 *   DEVICE_SCALE      DPR (default: 2 for sharper text)
 *   HEADLESS          "false" to watch the browser
 *   NO_SERVER         "1" — never spawn Vite; require BASE_URL / open port
 *   FULL_SCREEN       "1" — same as --full-screen
 *   FULL_PAGE         "1" — same as --full-page
 *
 * Examples (after capture)
 * ────────────────────────
 *   ![Editor](docs/screenshots/app-editor.jpg)
 *   ![Sync setup](docs/screenshots/app-sync-setup.jpg)
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
const HEADLESS = process.env.HEADLESS !== 'false'

// ── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(name)
  if (i === -1) return null
  return args[i + 1] ?? true
}

// Quality-first defaults (clearer shots; still JPEG unless --png).
const TARGET_KB = Number(process.env.TARGET_KB || flag('--target-kb') || 90)
const MIN_QUALITY = Number(process.env.MIN_QUALITY || flag('--min-quality') || 82)

const onlyList = String(flag('--only') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// Full-screen: desktop-class viewport, ignore stage crops (clipFrom / clip).
const FULL_SCREEN =
  args.includes('--full-screen')
  || args.includes('--fullscreen')
  || process.env.FULL_SCREEN === '1'
// Capture entire scrollable document (tall landing pages). Implies no clip.
const FULL_PAGE =
  args.includes('--full-page')
  || args.includes('--fullpage')
  || process.env.FULL_PAGE === '1'
// Prefer PNG (lossless UI) when --png is set
const USE_PNG = args.includes('--png') || process.env.PNG === '1'
const DEFAULT_W = FULL_SCREEN ? 1920 : 1280
const DEFAULT_H = FULL_SCREEN ? 1080 : 800
const VIEW_W = Number(flag('--width') || process.env.WIDTH || DEFAULT_W)
const VIEW_H = Number(flag('--height') || process.env.HEIGHT || DEFAULT_H)
// 2× DPR makes text/emoji crisp on retina / docs embeds
const DEVICE_SCALE = Number(flag('--device-scale') || process.env.DEVICE_SCALE || 2)

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
    title: 'Marketing hero + site header',
    path: '/',
    waitFor: '.hero h1, .brand, .site-header',
    // Full viewport so brand header stays in frame
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
  },
  {
    id: 'app-sync-setup',
    title: 'Sync mode dialog (browser: local only)',
    path: 'APP',
    waitFor: '.sync-setup-panel, .page, .xeditor-topbar, .block-editor',
    prepare: async (page) => {
      await sleep(600)
    },
  },
  {
    id: 'app-editor',
    title: 'Header + page emoji/title + block editor',
    path: 'APP',
    waitFor: '.block-editor, .xeditor-topbar, .page-content',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await seedDemoContent(page)
      await ensureHeaderVisible(page)
      await sleep(400)
    },
  },
  {
    id: 'app-editor-focus',
    title: 'Editor with emoji header, focused body',
    path: 'APP',
    waitFor: '.block-editor, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await seedDemoContent(page)
      await ensureHeaderVisible(page)
      await page.evaluate(() => {
        const ed = document.querySelector('.block-editor [contenteditable="true"]')
        ed?.focus()
      })
      await sleep(250)
    },
  },
  {
    id: 'app-sidebar',
    title: 'Top header + page sidebar',
    path: 'APP',
    waitFor: '.page-sidebar, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await seedDemoContent(page)
      await ensureSidebarOpen(page)
      await ensureHeaderVisible(page)
      await sleep(300)
    },
  },
  {
    id: 'app-settings',
    title: 'Settings dialog over app chrome',
    path: 'APP',
    waitFor: '.settings-panel, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await seedDemoContent(page)
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

async function ensureHeaderVisible(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    document.querySelector('.xeditor-topbar')?.scrollIntoView({ block: 'start' })
    document.querySelector('.xeditor-page-header, .page-title-shell')?.scrollIntoView({
      block: 'nearest',
    })
  })
  await sleep(150)
}

async function seedDemoContent(page) {
  const already = await page.evaluate(() => {
    const t = document.querySelector('.block-editor')?.innerText || ''
    return t.includes('Welcome to XEditor')
  })
  if (already) {
    await ensurePageEmojiAndTitle(page)
    return
  }

  await ensurePageEmojiAndTitle(page)

  await page.evaluate(() => {
    const editable = document.querySelector('.block-editor [contenteditable="true"]')
    editable?.focus()
  })

  try {
    // Rich demo body with emoji so shots aren't plain text
    await page.keyboard.type('✨ Welcome to XEditor', { delay: 12 })
    await page.keyboard.press('Enter')
    await page.keyboard.type(
      'A collaborative block editor for Delta Chat — pages, comments, and more.',
      { delay: 6 },
    )
    await page.keyboard.press('Enter')
    await page.keyboard.type('📝 Local mode stores data in IndexedDB', { delay: 5 })
    await page.keyboard.press('Enter')
    await page.keyboard.type('📦 Export packages as .xdc for chat', { delay: 5 })
    await page.keyboard.press('Enter')
    await page.keyboard.type('🚀 Try slash commands and formatting shortcuts', { delay: 5 })
  } catch {
    // ignore interaction failures on constrained builds
  }
  await ensureHeaderVisible(page)
  await sleep(250)
}

/** Set page title + open icon picker to place a visible emoji in the header. */
async function ensurePageEmojiAndTitle(page) {
  // Title input
  await page.evaluate(() => {
    const input = document.querySelector(
      '.xeditor-page-title-input, input.xeditor-page-title-input, .page-title-shell input',
    )
    if (!input) return
    input.focus()
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  try {
    const titleSel =
      '.xeditor-page-title-input, .page-title-shell input[type="text"], .page-title-shell textarea'
    const titleEl = await page.$(titleSel)
    if (titleEl) {
      await titleEl.click({ clickCount: 3 })
      await page.keyboard.type('📚 Product notes', { delay: 15 })
      await page.keyboard.press('Escape')
    }
  } catch {
    // ignore
  }

  // Prefer "Add icon" / "Change icon" control under the title
  const added = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll(
        '.xeditor-page-control, button.xeditor-page-control, .xeditor-page-icon',
      ),
    ]
    const addIcon = controls.find((el) =>
      /icon/i.test(el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || ''),
    )
    if (addIcon) {
      addIcon.click()
      return 'open-picker'
    }
    // Existing icon button
    const iconBtn = document.querySelector('.xeditor-page-icon, .xeditor-page-icon-wrap button')
    if (iconBtn) {
      iconBtn.click()
      return 'open-picker'
    }
    return null
  })

  if (added === 'open-picker') {
    await sleep(350)
    // Click first emoji cell in the picker if present
    const picked = await page.evaluate(() => {
      const cell =
        document.querySelector('.xpe-icon-cell')
        || document.querySelector('[role="listbox"] button')
        || document.querySelector('.xpe-icon-grid button')
      if (cell) {
        cell.click()
        return true
      }
      // Fallback: type emoji into custom input if any
      const custom = document.querySelector('.xpe-icon-custom-input, input[placeholder*="emoji" i]')
      if (custom) {
        custom.focus()
        custom.value = '📝'
        custom.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('.xpe-icon-custom-apply')?.click()
        return true
      }
      return false
    })
    if (!picked) {
      // Close any open popover with Escape
      await page.keyboard.press('Escape')
    }
    await sleep(200)
  }

  // Scroll so topbar + page header (emoji + title) are in frame
  await ensureHeaderVisible(page)
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

async function captureCompressed(page, filePath, clip, { fullPage = false } = {}) {
  const targetBytes =
    (FULL_SCREEN || fullPage ? Math.max(TARGET_KB, 120) : TARGET_KB) * 1024
  // High quality first; only step down toward MIN_QUALITY if over budget
  const qualities = [94, 90, 88, 86, 84, 82, 80, 78]
    .filter((q) => q >= MIN_QUALITY)
  if (!qualities.includes(MIN_QUALITY)) qualities.push(MIN_QUALITY)

  let best = null
  // Prefer full frame (header + emoji + editor). Only crop if stage asked and not full modes.
  let useClip = fullPage || FULL_SCREEN ? undefined : sanitizeClip(clip)
  const type = USE_PNG ? 'png' : 'jpeg'

  if (USE_PNG) {
    const buf = await page.screenshot({
      type: 'png',
      clip: useClip,
      fullPage: Boolean(fullPage),
      captureBeyondViewport: Boolean(fullPage),
    })
    writeFileSync(filePath, buf)
    return buf.byteLength
  }

  for (const q of qualities) {
    try {
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: q,
        clip: useClip,
        fullPage: Boolean(fullPage),
        captureBeyondViewport: Boolean(fullPage),
      })
      best = buf
      // Keep the highest quality that still fits the budget
      if (buf.byteLength <= targetBytes) break
    } catch (err) {
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
  if (FULL_SCREEN) {
    console.log(`Full-screen mode: ${VIEW_W}×${VIEW_H} (no UI crops)`)
  }
  if (FULL_PAGE) {
    console.log('Full-page mode: capture entire scroll height')
  }

  const browser = await puppeteer.default.launch({
    headless: HEADLESS,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--font-render-hinting=none',
      ...(FULL_SCREEN
        ? [`--window-size=${VIEW_W},${VIEW_H}`, '--start-maximized']
        : []),
    ],
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
    fullScreen: FULL_SCREEN,
    fullPage: FULL_PAGE,
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

      const suffix = FULL_SCREEN ? '-full' : ''
      const ext = USE_PNG ? 'png' : 'jpg'
      const file = `${stage.id}${suffix}.${ext}`
      const outPath = join(OUT_DIR, file)
      // Prefer full viewport (includes topbar + page header/emoji). Optional crops only if set.
      const clip =
        FULL_SCREEN || FULL_PAGE || !stage.clipFrom
          ? stage.clip
          : await resolveClip(page, stage)
      const bytes = await captureCompressed(page, outPath, clip, {
        fullPage: FULL_PAGE,
      })
      const kb = (bytes / 1024).toFixed(1)
      console.log(`  saved ${relative(root, outPath)} (${kb} KB)`)
      manifest.shots.push({
        id: stage.id,
        title: stage.title,
        file,
        bytes,
        kb: Number(kb),
        url: fullUrl,
        fullScreen: FULL_SCREEN,
        fullPage: FULL_PAGE,
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
${FULL_SCREEN ? '\n**Mode:** full-screen (1920×1080 viewport, no crops).\n' : ''}${FULL_PAGE ? '\n**Mode:** full-page (entire scroll height).\n' : ''}
| Stage | File | Size |
|-------|------|------|
${manifest.shots.map((s) => `| ${s.title} | \`${s.file}\` | ${s.kb} KB |`).join('\n')}

\`\`\`bash
# Local Vite (auto-start)
npm run screenshots

# Full-screen desktop (1920×1080, no crops)
npm run screenshots -- --full-screen
npm run screenshots:full

# Full-screen + entire page scroll
npm run screenshots -- --full-screen --full-page

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

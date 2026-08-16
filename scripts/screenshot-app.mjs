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
  readFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const HEADLESS = process.env.HEADLESS !== 'false'

// ── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(name)
  if (i === -1) return null
  return args[i + 1] ?? true
}

const LOCALE = String(flag('--locale') || process.env.SCREENSHOT_LOCALE || 'en')
  .trim()
  .toLowerCase()

const OUT_DIR = process.env.OUT_DIR
  ? join(root, process.env.OUT_DIR)
  : join(root, LOCALE === 'fa' ? 'docs/screenshots/fa' : 'docs/screenshots')

function parseDemoCopy(md) {
  const src = String(md || '')
  const galleryMatch = src.match(/^## gallery\s*\n([\s\S]*)$/m)
  const gallery = galleryMatch ? galleryMatch[1].trim() : ''
  const head = galleryMatch ? src.slice(0, galleryMatch.index) : src
  const fields = { gallery }
  for (const part of head.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n')
    const key = (nl === -1 ? part : part.slice(0, nl)).trim()
    const val = (nl === -1 ? '' : part.slice(nl + 1)).trim()
    if (key) fields[key] = val
  }
  return fields
}

const DEMO_COPY = parseDemoCopy(
  readFileSync(
    join(
      root,
      'site/copy',
      LOCALE === 'fa' ? 'screenshot-demo.fa.md' : 'screenshot-demo.md',
    ),
    'utf8',
  ),
)

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
    path: LOCALE === 'fa' ? '/fa/' : '/',
    waitFor: '.hero h1, .brand, .site-header',
    // Full viewport so brand header stays in frame
  },
  {
    id: 'landing-download',
    title: 'Download cards',
    path: LOCALE === 'fa' ? '/fa/#download' : '/#download',
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
    title: 'Block gallery — scrolled viewports (sidebar closed)',
    path: 'APP',
    // Tall gallery: capture overlapping viewport slices while scrolling #app
    scrollShots: true,
    scrollOverlap: 0.18,
    maxScrollShots: 8,
    waitFor: '.block-editor, .xeditor-topbar, .page-content',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await ensureCommentsClosed(page)
      await seedDemoContent(page)
      await ensureHeaderVisible(page)
      await ensureSidebarClosed(page)
      await sleep(400)
    },
  },
  {
    id: 'app-editor-focus',
    title: 'Block gallery (focused) — scrolled viewports',
    path: 'APP',
    scrollShots: true,
    scrollOverlap: 0.18,
    maxScrollShots: 8,
    waitFor: '.block-editor, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await ensureCommentsClosed(page)
      await seedDemoContent(page)
      await ensureHeaderVisible(page)
      await page.evaluate(() => {
        const ed = document.querySelector('.block-editor [contenteditable="true"]')
        ed?.focus()
      })
      await ensureSidebarClosed(page)
      await sleep(250)
    },
  },
  {
    id: 'app-sidebar',
    title: 'Top header + page sidebar (pages list)',
    path: 'APP',
    // Only stage that intentionally shows the left panel
    sidebar: 'open',
    waitFor: '.page-sidebar--open, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await ensureCommentsClosed(page)
      await seedDemoContent(page)
      await seedExtraSidebarPages(page)
      await ensureHeaderVisible(page)
      await ensureSidebarOpen(page)
      await sleep(300)
    },
  },
  {
    id: 'app-command-palette',
    title: 'Command palette (Ctrl+K / Ctrl+P)',
    path: 'APP',
    waitFor: '.block-editor, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await ensureCommentsClosed(page)
      await seedDemoContent(page)
      await ensureHeaderVisible(page)
      await ensureSidebarClosed(page)
      await openCommandPalette(page)
      await sleep(350)
    },
  },
  {
    id: 'app-import',
    title: 'Import / Open-bind modal',
    path: 'APP',
    waitFor: '.block-editor, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await ensureCommentsClosed(page)
      await seedDemoContent(page)
      await ensureHeaderVisible(page)
      await openImportDialog(page)
      // Modal is portaled — close the rail so the shot is modal-focused
      await ensureSidebarClosed(page)
      await sleep(350)
    },
  },
  {
    id: 'app-comments',
    title: 'Comments panel with example threads',
    path: 'APP',
    waitFor: '.block-editor, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await seedDemoContent(page)
      await ensureHeaderVisible(page)
      await ensureSidebarClosed(page)
      await openCommentsPanel(page)
      await seedDemoComments(page)
      await dismissFloatingCommentPopover(page)
      await sleep(350)
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
      await ensureCommentsClosed(page)
      await seedDemoContent(page)
      await ensureSidebarClosed(page)
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
      await ensureCommentsClosed(page)
      await ensureSidebarClosed(page)
      await openSettings(page)
      await openSettingsTab(page, 'Sync')
      await page.waitForSelector('.settings-panel', { timeout: 8000 })
      await sleep(250)
    },
  },

  // ── Mobile (phone frame) ──────────────────────────────────────────────────
  {
    id: 'mobile-editor',
    title: 'Mobile editor (sidebar closed)',
    path: 'APP',
    mobile: true,
    waitFor: '.block-editor, .xeditor-topbar, .page-content',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await ensureCommentsClosed(page)
      await seedDemoContent(page)
      await ensureHeaderVisible(page)
      await ensureSidebarClosed(page)
      await sleep(350)
    },
  },
  {
    id: 'mobile-comments',
    title: 'Mobile comments panel',
    path: 'APP',
    mobile: true,
    waitFor: '.block-editor, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await seedDemoContent(page)
      await ensureSidebarClosed(page)
      await openCommentsPanel(page)
      await seedDemoComments(page)
      await dismissFloatingCommentPopover(page)
      await sleep(350)
    },
  },
  {
    id: 'mobile-import',
    title: 'Mobile import / Open-bind modal',
    path: 'APP',
    mobile: true,
    waitFor: '.block-editor, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await ensureCommentsClosed(page)
      await seedDemoContent(page)
      await openImportDialog(page)
      await ensureSidebarClosed(page)
      await sleep(350)
    },
  },
  {
    id: 'mobile-command-palette',
    title: 'Mobile command palette (Ctrl+K)',
    path: 'APP',
    mobile: true,
    waitFor: '.block-editor, .xeditor-topbar',
    prepare: async (page) => {
      await pickLocalSyncIfNeeded(page)
      await waitForEditor(page)
      await ensureCommentsClosed(page)
      await seedDemoContent(page)
      await ensureSidebarClosed(page)
      await openCommandPalette(page)
      await sleep(350)
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

/** Comments panel steals horizontal space and looks wrong in most marketing shots. */
async function ensureCommentsClosed(page) {
  const open = await page.evaluate(() => {
    const root = document.querySelector('.comment-panel-root--open, .comment-panel-root')
    if (root?.classList.contains('comment-panel-root--open')) return true
    const btn = document.querySelector('button[aria-label="Comments"]')
    return btn?.getAttribute('aria-pressed') === 'true'
  })
  if (!open) return

  await page.evaluate(() => {
    document.querySelector('.comment-panel__close')?.click()
    const btn =
      document.querySelector('button[aria-label="Comments"][aria-pressed="true"]')
      || document.querySelector('button[aria-label*="Comment" i][aria-pressed="true"]')
    btn?.click()
  })
  await sleep(200)
}

async function openCommentsPanel(page) {
  const already = await page.evaluate(
    () => !!document.querySelector('.comment-panel-root--open .comment-panel'),
  )
  if (already) return

  await page.evaluate(() => {
    const btn =
      document.querySelector('button[aria-label="Comments"]')
      || document.querySelector('button[title^="Comments"]')
      || [...document.querySelectorAll('button')].find((b) =>
        /^comments/i.test((b.getAttribute('aria-label') || b.getAttribute('title') || '').trim()),
      )
    btn?.click()
  })
  await page.waitForSelector('.comment-panel-root--open .comment-panel, .comment-panel', {
    timeout: 8000,
  })
  await sleep(200)
}

/**
 * Seed a few page comments + one reply so the panel is not empty in screenshots.
 * Uses native value setters so Svelte bind:value picks up the draft.
 */
async function seedDemoComments(page) {
  await openCommentsPanel(page)

  const hasExamples = await page.evaluate((needle) => {
    const text = document.querySelector('.comment-panel')?.innerText || ''
    // Require at least two threads so we don't skip after a partial seed
    const threads = document.querySelectorAll('.comment-thread').length
    return threads >= 2 && (text.includes(needle) || /Looks great|Can we add/i.test(text))
  }, DEMO_COPY.commentNeedle || 'Looks great')
  if (hasExamples) return

  const composerSel =
    '#comment-panel-composer, textarea.comment-panel__input, textarea[aria-label="Write a page comment"]'

  async function setInputValue(selector, text) {
    await page.evaluate(
      (sel, value) => {
        const el = document.querySelector(sel)
        if (!el) return
        el.focus()
        const proto = el instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        setter?.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      },
      selector,
      text,
    )
    await sleep(60)
  }

  async function postPageComment(text) {
    await setInputValue(composerSel, text)
    // Click the primary Comment button (more reliable than Enter with Svelte binds)
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector(
        '.comment-panel__send--primary, .comment-panel__composer button.comment-panel__send',
      )
      if (btn && !btn.disabled) {
        btn.click()
        return true
      }
      return false
    })
    if (!clicked) {
      const area = await page.$(composerSel)
      await area?.focus()
      await page.keyboard.press('Enter')
    }
    await sleep(350)
  }

  try {
    await postPageComment(DEMO_COPY.comment1 || 'Looks great — this gallery will help new users.')
    await postPageComment(DEMO_COPY.comment2 || 'Can we add a short note about Delta Chat sync next?')

    // Reply on the newest thread (first in the list)
    const replySel = '.comment-thread__reply-input, input[aria-label="Reply to thread"]'
    const replyInput = await page.$(replySel)
    if (replyInput) {
      await replyInput.click()
      await setInputValue(replySel, DEMO_COPY.commentReply || 'Agreed — I will draft that for the next pass.')
      const sent = await page.evaluate(() => {
        const btn = document.querySelector('.comment-thread__reply-send')
        if (btn && !btn.disabled) {
          btn.click()
          return true
        }
        return false
      })
      if (!sent) {
        await replyInput.focus()
        await page.keyboard.press('Enter')
      }
      await sleep(300)
    }
  } catch (e) {
    console.warn(`  warn: seedDemoComments failed: ${e.message || e}`)
  }

  await dismissFloatingCommentPopover(page)
  await page.evaluate(() => {
    document.querySelector('.comment-panel__list')?.scrollTo?.({ top: 0 })
  })
  await sleep(150)
}

/** Hide gutter / floating "Comment" card so only the side Comments panel shows. */
async function dismissFloatingCommentPopover(page) {
  await page.evaluate(() => {
    // Floating CommentThread (portal) — not the side-panel threads
    document.querySelector('.comment-thread-backdrop')?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    )
    document.querySelector('.comment-thread-close')?.click()
    // Deselect active thread in the side panel
    document.querySelector('.comment-panel .comment-thread--active .comment-thread__body')?.click()
  })
  await sleep(200)
  // If still open, click backdrop again
  await page.evaluate(() => {
    if (document.querySelector('.comment-thread-header')) {
      document.querySelector('.comment-thread-close')?.click()
      document.querySelector('.comment-thread-backdrop')?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      )
    }
  })
  await sleep(150)
}

async function waitForEditor(page) {
  await page.waitForSelector('.block-editor, .editor-container, .page-content', {
    timeout: 20000,
  })
  await sleep(400)
}

async function ensureHeaderVisible(page) {
  await page.evaluate(() => {
    // App uses #app as the scroll root (html/body are overflow:hidden).
    window.scrollTo(0, 0)
    document.querySelector('#app')?.scrollTo?.(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    document.querySelector('.xeditor-topbar')?.scrollIntoView({ block: 'start' })
    document.querySelector('.xeditor-page-header, .page-title-shell')?.scrollIntoView({
      block: 'nearest',
    })
  })
  await sleep(150)
}

/**
 * Expand the #app scroll root so Puppeteer fullPage can see the whole document.
 * (html/body are height:100%; overflow:hidden — only #app scrolls.)
 */
async function expandScrollRootForFullPage(page) {
  await page.evaluate(() => {
    const app = document.querySelector('#app')
    const shell = document.querySelector('.page, .app-shell, .app-main')
    const contentH = Math.max(
      app?.scrollHeight || 0,
      shell?.scrollHeight || 0,
      document.querySelector('.block-editor')?.scrollHeight || 0,
      800,
    )
    const h = Math.ceil(contentH + 48)
    for (const el of [document.documentElement, document.body, app]) {
      if (!el) continue
      el.style.setProperty('height', `${h}px`, 'important')
      el.style.setProperty('min-height', `${h}px`, 'important')
      el.style.setProperty('max-height', 'none', 'important')
      el.style.setProperty('overflow', 'visible', 'important')
    }
    if (app) app.scrollTop = 0
    window.scrollTo(0, 0)
  })
  await sleep(120)
}

/** App scroll root metrics (#app; fallback document). */
async function getAppScrollMetrics(page) {
  return page.evaluate(() => {
    const app = document.querySelector('#app')
    if (app && app.scrollHeight > app.clientHeight + 8) {
      return {
        kind: 'app',
        scrollTop: app.scrollTop,
        clientHeight: app.clientHeight,
        scrollHeight: app.scrollHeight,
        maxScroll: Math.max(0, app.scrollHeight - app.clientHeight),
      }
    }
    const se = document.scrollingElement || document.documentElement
    return {
      kind: 'document',
      scrollTop: se.scrollTop,
      clientHeight: se.clientHeight || window.innerHeight,
      scrollHeight: se.scrollHeight,
      maxScroll: Math.max(0, se.scrollHeight - (se.clientHeight || window.innerHeight)),
    }
  })
}

async function setAppScrollTop(page, y) {
  await page.evaluate((top) => {
    const app = document.querySelector('#app')
    if (app && app.scrollHeight > app.clientHeight + 8) {
      app.scrollTop = top
    } else {
      const se = document.scrollingElement || document.documentElement
      se.scrollTop = top
      window.scrollTo(0, top)
    }
  }, y)
  await sleep(180)
}

/**
 * Offsets (px) for overlapping viewport slices covering the tall demo page.
 * First shot is always y=0 (header + title). Last shot reaches the bottom.
 */
function computeScrollOffsets(metrics, { overlap = 0.18, maxShots = 8 } = {}) {
  const view = Math.max(200, metrics.clientHeight || VIEW_H)
  const maxScroll = Math.max(0, metrics.maxScroll || 0)
  if (maxScroll < 40) return [0]

  const step = Math.max(120, Math.round(view * (1 - Math.min(0.45, Math.max(0, overlap)))))
  const offsets = []
  let y = 0
  while (y < maxScroll - 8 && offsets.length < maxShots - 1) {
    offsets.push(y)
    y += step
  }
  // Always include the bottom
  const bottom = maxScroll
  if (!offsets.length || offsets[offsets.length - 1] < bottom - 24) {
    offsets.push(bottom)
  } else {
    offsets[offsets.length - 1] = bottom
  }
  // Cap length
  if (offsets.length > maxShots) {
    const trimmed = [offsets[0]]
    const mid = offsets.slice(1, -1)
    const take = maxShots - 2
    for (let i = 0; i < take; i++) {
      const idx = Math.round((i + 1) * (mid.length + 1) / (take + 1)) - 1
      if (mid[idx] != null) trimmed.push(mid[idx])
    }
    trimmed.push(bottom)
    return [...new Set(trimmed)].sort((a, b) => a - b)
  }
  return offsets
}

/** Small placeholder image so the gallery image block is not huge. */
function demoImageDataUrl() {
  const alt = DEMO_COPY.imageAlt || 'Image block'
  const caption = DEMO_COPY.imageCaption || 'caption example'
  return (
    'data:image/svg+xml,'
    + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="120">'
      + '<rect width="280" height="120" rx="12" fill="#e8f0fe"/>'
      + '<rect x="24" y="28" width="64" height="64" rx="10" fill="#aecbfa"/>'
      + `<text x="108" y="58" font-family="Arad,Shabnam,sans-serif" font-size="16" fill="#174ea6">${alt}</text>`
      + `<text x="108" y="82" font-family="Arad,Shabnam,sans-serif" font-size="13" fill="#5f6368">${caption}</text>`
      + '</svg>',
    )
  )
}

/** Demo markdown covering every type the paste pipeline understands. */
function buildBlockGalleryMarkdown() {
  const gallery = DEMO_COPY.gallery || ''
  return gallery.replaceAll('IMAGE_PLACEHOLDER', demoImageDataUrl())
}

async function focusEditor(page) {
  await page.evaluate(() => {
    const ed =
      document.querySelector('.block-editor [contenteditable="true"]')
      || document.querySelector('.block-editor')
    ed?.focus?.()
  })
  await sleep(80)
}

/** Grant clipboard write so navigator.clipboard works in headless Chromium. */
async function grantClipboard(page) {
  try {
    const origin = await page.evaluate(() => window.location.origin)
    const client = await page.createCDPSession()
    await client.send('Browser.grantPermissions', {
      origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
  } catch {
    try {
      const origin = await page.evaluate(() => window.location.origin)
      await page.browserContext().overridePermissions(origin, [
        'clipboard-read',
        'clipboard-write',
      ])
    } catch {
      /* ignore */
    }
  }
}

/**
 * Paste markdown into the editor (clipboard + Ctrl+V).
 * Note: Ctrl+A then paste on an empty selection can wipe content — seed a
 * character first so the editor has a real selection target.
 */
async function pasteIntoEditor(page, text) {
  await grantClipboard(page)
  await focusEditor(page)

  // Ensure there is something to replace
  await page.keyboard.type('x', { delay: 10 })
  await sleep(40)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await sleep(60)

  let usedClipboard = false
  try {
    await page.evaluate(async (md) => {
      await navigator.clipboard.writeText(md)
    }, text)
    usedClipboard = true
  } catch (e) {
    console.warn(`  warn: clipboard.writeText failed: ${e.message || e}`)
  }

  if (usedClipboard) {
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyV')
    await page.keyboard.up('Control')
    await sleep(700)
  }

  // Verify markdown structure landed
  const ok = await page.evaluate((heading, bullet) => {
    const t = document.querySelector('.block-editor')?.innerText || ''
    return t.includes(heading) && t.includes(bullet)
  }, DEMO_COPY.headingNeedle || 'Heading 1', DEMO_COPY.bulletNeedle || 'bullet')
  if (!ok) {
    console.warn('  warn: markdown paste did not produce gallery blocks')
  }
  return ok
}

/**
 * Insert a block via `/` menu. Types query, confirms first match, optional body text.
 */
async function insertSlashBlock(page, query, bodyText = '') {
  // Assume caret is already where we want the new block
  await page.keyboard.press('Enter')
  await sleep(60)
  await page.keyboard.type('/', { delay: 20 })
  await page.keyboard.type(query, { delay: 25 })
  await sleep(280)
  await page.keyboard.press('Enter')
  await sleep(220)
  if (bodyText) {
    await page.keyboard.type(bodyText, { delay: 12 })
  }
  await sleep(120)
}

async function seedDemoContent(page) {
  const already = await page.evaluate((needles) => {
    const t = document.querySelector('.block-editor')?.innerText || ''
    return (
      t.includes(needles.already)
      && t.includes(needles.heading)
      && t.includes(needles.bullet)
      && t.includes(needles.table)
    )
  }, {
    already: DEMO_COPY.alreadySeededNeedle || 'block gallery',
    heading: DEMO_COPY.headingNeedle || 'Heading 1',
    bullet: DEMO_COPY.bulletNeedle || 'Bulleted list item',
    table: DEMO_COPY.tableNeedle || 'Feature',
  })
  if (already) {
    await ensurePageEmojiAndTitle(page)
    return
  }

  await ensurePageEmojiAndTitle(page)

  const md = buildBlockGalleryMarkdown()

  try {
    await pasteIntoEditor(page, md)
  } catch (e) {
    console.warn(`  warn: paste gallery failed: ${e.message || e}`)
  }

  // Types markdown cannot express — append via slash menu after the trailing marker line
  try {
    // Focus the last contenteditable paragraph (not a table cell)
    await page.evaluate((markerNeedle) => {
      const editables = [
        ...document.querySelectorAll(
          '.block-editor [contenteditable="true"]:not(td [contenteditable]):not(th [contenteditable])',
        ),
      ]
      // Prefer the marker line we pasted
      const marker = editables.find((el) =>
        (el.textContent || '').includes(markerNeedle)
          || /slash blocks follow|End of markdown/i.test(el.textContent || ''),
      )
      const last = marker || editables[editables.length - 1]
      if (!last) return
      last.focus()
      const sel = window.getSelection()
      if (sel) {
        const range = document.createRange()
        range.selectNodeContents(last)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      last.scrollIntoView({ block: 'center' })
    }, DEMO_COPY.galleryMarker || 'slash blocks follow')
    await sleep(150)
    await page.keyboard.press('Enter')
    await insertSlashBlock(page, 'toggle', DEMO_COPY.toggleBody || 'Toggle — click to expand nested notes')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type(DEMO_COPY.toggleDetail || 'Hidden detail inside the toggle', { delay: 10 })
    await page.keyboard.press('Enter')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Tab')
    await page.keyboard.up('Shift')
    await insertSlashBlock(page, 'callout', DEMO_COPY.calloutBody || 'Callout — highlighted tip for readers')
    await page.keyboard.press('Enter')
    await insertSlashBlock(page, 'poll')
    await sleep(250)
    const pollInputs = await page.$$(
      'input[placeholder*="question" i], input[placeholder*="Option" i], .editor-poll input, [class*="poll"] input',
    )
    if (pollInputs.length) {
      for (let i = 0; i < Math.min(pollInputs.length, 3); i++) {
        const labels = [
          DEMO_COPY.pollQuestion || 'Preferred sync mode?',
          DEMO_COPY.pollOption1 || 'Realtime sync',
          DEMO_COPY.pollOption2 || 'Local only',
        ]
        await pollInputs[i].click({ clickCount: 3 })
        await page.keyboard.type(labels[i] || `Option ${i}`, { delay: 6 })
      }
    }
  } catch (e) {
    console.warn(`  warn: slash gallery inserts failed: ${e.message || e}`)
  }

  // Blur menus without Escape (Escape closes the left sidebar)
  await page.evaluate(() => document.activeElement?.blur?.())
  await sleep(200)
  await ensureHeaderVisible(page)
  await sleep(200)
}

/** Add a couple of named pages so the left panel looks populated. */
async function seedExtraSidebarPages(page) {
  const count = await page.evaluate(
    () => document.querySelectorAll('.page-sidebar__item').length,
  )
  if (count >= 3) return

  for (const title of [DEMO_COPY.sidebarPage1 || 'Meeting notes', DEMO_COPY.sidebarPage2 || 'Ideas']) {
    const before = await page.evaluate(
      () => document.querySelectorAll('.page-sidebar__item').length,
    )
    await page.evaluate(() => {
      document.querySelector('.page-sidebar__new')?.click()
    })
    await sleep(400)
    const after = await page.evaluate(
      () => document.querySelectorAll('.page-sidebar__item').length,
    )
    if (after <= before) break
    // Rename the newly selected page via title input
    try {
      const titleEl = await page.$(
        '.xeditor-page-title-input, .page-title-shell input[type="text"]',
      )
      if (titleEl) {
        await titleEl.click({ clickCount: 3 })
        await page.keyboard.type(title, { delay: 8 })
        await page.evaluate(() => document.activeElement?.blur?.())
      }
    } catch {
      /* ignore */
    }
    await sleep(200)
  }

  // Select first page again for a consistent main view
  await page.evaluate(() => {
    document.querySelector('.page-sidebar__item-button')?.click()
  })
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
      await page.keyboard.type(DEMO_COPY.pageTitle || 'Product notes', { delay: 15 })
      // Blur title without Escape — Escape dismisses the left sidebar UI layer.
      await page.evaluate(() => {
        document.activeElement?.blur?.()
      })
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
      // Close icon picker only (avoid bare Escape which also closes the sidebar)
      await page.evaluate(() => {
        document.querySelector('.xpe-icon-popover button[aria-label*="close" i]')?.click()
        document.activeElement?.blur?.()
      })
    }
    await sleep(200)
  }

  // Scroll so topbar + page header (emoji + title) are in frame
  await ensureHeaderVisible(page)
}

/**
 * Desktop sidebar collapses with width:0 when closed (not only translateX).
 * Escape also closes it via the UI-layer stack — always open last after seeding.
 */
async function sidebarIsVisiblyOpen(page) {
  return page.evaluate(() => {
    const sb = document.querySelector('.page-sidebar')
    if (!sb) return false
    // Prefer the open class; also accept expanded geometry if class lags a frame.
    const r = sb.getBoundingClientRect()
    const wideEnough = r.width > 120
    const onStart =
      (r.left >= -8 && r.left < 40)
      || (r.right <= window.innerWidth + 8 && r.right > window.innerWidth - 40)
    return sb.classList.contains('page-sidebar--open') && wideEnough && onStart
  })
}

async function clickSidebarToggle(page) {
  const btn =
    (await page.$('button[aria-label="Toggle sidebar"]'))
    || (await page.$('.xeditor-topbar__island--left button.xeditor-icon-btn'))
    || (await page.$('.xeditor-topbar__island--left button'))
  if (btn) {
    await btn.click({ delay: 15 })
    return true
  }
  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Toggle sidebar"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  })
  return true
}

async function ensureSidebarOpen(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem('collab-editor-sidebar', 'open')
    } catch {
      /* ignore */
    }
  })

  if (await sidebarIsVisiblyOpen(page)) return

  for (let attempt = 0; attempt < 4; attempt++) {
    if (await sidebarIsVisiblyOpen(page)) return

    const btn =
      (await page.$('button[aria-label="Toggle sidebar"]'))
      || (await page.$('.xeditor-topbar__island--left button.xeditor-icon-btn'))
      || (await page.$('.xeditor-topbar__island--left button'))

    if (btn) {
      const pressed = await page.evaluate(
        (el) => el.getAttribute('aria-pressed') === 'true',
        btn,
      )
      if (!pressed) {
        await btn.click({ delay: 20 })
        await sleep(400)
        continue
      }
    } else {
      await clickSidebarToggle(page)
      await sleep(400)
    }
  }

  if (!(await sidebarIsVisiblyOpen(page))) {
    await page.evaluate(() => {
      const sb = document.querySelector('.page-sidebar')
      if (!sb) return
      sb.classList.add('page-sidebar--open')
      sb.style.width = 'var(--sidebar-width)'
      sb.style.minWidth = 'var(--sidebar-width)'
      sb.style.opacity = '1'
      sb.style.pointerEvents = 'auto'
      sb.style.transform = 'none'
      sb.style.borderRightWidth = '1px'
      sb.style.overflow = 'hidden'
    })
    await sleep(250)
  }

  if (!(await sidebarIsVisiblyOpen(page))) {
    console.warn('  warn: left sidebar still not visible after toggle')
  }
}

/** Prefer a closed left rail for most marketing shots (full editor width). */
async function ensureSidebarClosed(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem('collab-editor-sidebar', 'closed')
    } catch {
      /* ignore */
    }
  })

  if (!(await sidebarIsVisiblyOpen(page))) {
    // Clear any forced open styles from a prior stage
    await page.evaluate(() => {
      const sb = document.querySelector('.page-sidebar')
      if (!sb) return
      sb.classList.remove('page-sidebar--open')
      sb.style.removeProperty('width')
      sb.style.removeProperty('min-width')
      sb.style.removeProperty('opacity')
      sb.style.removeProperty('pointer-events')
      sb.style.removeProperty('transform')
      sb.style.removeProperty('border-right-width')
      sb.style.removeProperty('overflow')
    })
    return
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await sidebarIsVisiblyOpen(page))) return
    const btn =
      (await page.$('button[aria-label="Toggle sidebar"]'))
      || (await page.$('.xeditor-topbar__island--left button.xeditor-icon-btn'))
    if (btn) {
      const pressed = await page.evaluate(
        (el) => el.getAttribute('aria-pressed') === 'true',
        btn,
      )
      if (pressed) {
        await btn.click({ delay: 20 })
        await sleep(350)
        continue
      }
    }
    await clickSidebarToggle(page)
    await sleep(350)
  }

  if (await sidebarIsVisiblyOpen(page)) {
    await page.evaluate(() => {
      const sb = document.querySelector('.page-sidebar')
      if (!sb) return
      sb.classList.remove('page-sidebar--open')
      sb.style.width = '0'
      sb.style.minWidth = '0'
      sb.style.opacity = '0'
      sb.style.pointerEvents = 'none'
      sb.style.borderRightWidth = '0'
    })
    await sleep(200)
  }
}

/** Force real phone chrome (data-phone-ui), not just a narrow desktop viewport. */
async function applyPhoneUiMode(page, enabled) {
  // CDP only supports a few media features (not pointer/hover).
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'light' },
  ])
  await page.evaluate((on) => {
    if (on) {
      document.documentElement.setAttribute('data-phone-ui', '1')
      // Match tokens used under phone UI (see src/style.css)
      document.documentElement.style.setProperty('--page-width', '100%')
      document.documentElement.style.setProperty('--page-padding-x', '16px')
      document.documentElement.style.setProperty('--page-content-inset-start', '8px')
      document.documentElement.style.setProperty('--page-content-inset-end', '8px')
    } else {
      document.documentElement.removeAttribute('data-phone-ui')
      document.documentElement.style.removeProperty('--page-width')
      document.documentElement.style.removeProperty('--page-padding-x')
      document.documentElement.style.removeProperty('--page-content-inset-start')
      document.documentElement.style.removeProperty('--page-content-inset-end')
    }
    window.dispatchEvent(new Event('resize'))
  }, enabled)
  await sleep(150)
}

async function applyStageViewport(page, stage) {
  // Note: isMobile/hasTouch can force a reload that hangs under Vite HMR —
  // only change width/height/DPR for phone frames.
  if (stage.mobile) {
    const w = Number(stage.width || 390)
    const h = Number(stage.height || 844)
    const dpr = Number(stage.deviceScale || Math.min(DEVICE_SCALE, 3))
    await page.setViewport({
      width: w,
      height: h,
      deviceScaleFactor: dpr,
    })
    await applyPhoneUiMode(page, true)
    return { width: w, height: h, deviceScaleFactor: dpr, mobile: true }
  }
  await page.setViewport({
    width: VIEW_W,
    height: VIEW_H,
    deviceScaleFactor: DEVICE_SCALE,
  })
  await applyPhoneUiMode(page, false)
  return {
    width: VIEW_W,
    height: VIEW_H,
    deviceScaleFactor: DEVICE_SCALE,
    mobile: false,
  }
}

/** Open the sidebar Import / “Open / bind” dialog. */
async function openImportDialog(page) {
  if (await page.$('.import-panel, .import-root')) return

  // Import lives on the left rail — open briefly if needed
  const railOpen = await sidebarIsVisiblyOpen(page)
  if (!railOpen) await ensureSidebarOpen(page)

  const opened = await page.evaluate(() => {
    const sidebarImport =
      document.querySelector('.page-sidebar__import')
      || [...document.querySelectorAll('.page-sidebar button, .page-sidebar__nav button')].find(
        (b) => /^import$/i.test((b.textContent || '').trim()),
      )
    if (sidebarImport) {
      sidebarImport.click()
      return 'sidebar'
    }
    const any = [...document.querySelectorAll('button')].find((b) =>
      /import|open\s*\/\s*bind/i.test(
        `${b.textContent || ''} ${b.getAttribute('aria-label') || ''}`,
      ),
    )
    if (any) {
      any.click()
      return 'button'
    }
    return null
  })

  if (!opened) {
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyK')
    await page.keyboard.up('Control')
    await sleep(200)
    await page.keyboard.type('import', { delay: 20 })
    await sleep(200)
    await page.keyboard.press('Enter')
    await sleep(250)
  }

  await page.waitForSelector('.import-panel, .import-root', { timeout: 8000 })
  await page.evaluate(() => {
    document.querySelector('.import-panel')?.scrollIntoView({ block: 'center' })
  })
  await sleep(150)
}

/** Open the app command palette (Ctrl/Cmd+K). */
async function openCommandPalette(page) {
  if (await page.$('.palette-panel, .palette-root')) return

  // Ensure editor chrome has focus (not a floating input)
  await page.evaluate(() => {
    document.querySelector('.block-editor')?.focus?.()
    document.activeElement?.blur?.()
  })
  await sleep(80)

  // Ctrl+K (same chord as the app; also works as Ctrl+P fallback below)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyK')
  await page.keyboard.up('Control')
  await sleep(250)

  let opened = await page.$('.palette-panel, .palette-root, .palette-input')
  if (!opened) {
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyP')
    await page.keyboard.up('Control')
    await sleep(250)
    opened = await page.$('.palette-panel, .palette-root, .palette-input')
  }

  if (!opened) {
    // Last resort: dispatch the same keydown the app listens for
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'k',
          code: 'KeyK',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    await sleep(250)
  }

  await page.waitForSelector('.palette-panel, .palette-root', { timeout: 8000 })

  // Optional: type a short query so the list shows filtered commands (still open)
  const input = await page.$('.palette-input, .palette-panel input')
  if (input) {
    await input.click({ clickCount: 1 })
    // Leave empty to show the default command list (pages + actions)
    await sleep(100)
  }
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

/** Only reuse a process on the port if it actually serves this app. */
async function isXEditorServer(url) {
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!(res.ok || res.status === 304)) return false
    const html = await res.text()
    return (
      /XEditor|collab-markdown|webxdc\.js|block-editor|src\/main\.ts/i.test(html)
      && !/fakeshell|FakeShell/i.test(html)
    )
  } catch {
    return false
  }
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

  let port = process.env.VITE_DEV_PORT || '5173'
  let base = `http://127.0.0.1:${port}`

  // Probe existing server — reject foreign apps on the same port (common on 5173).
  if (await isXEditorServer(base)) {
    console.log(`Using existing XEditor server at ${base}`)
    return { base, appPath: process.env.APP_PATH || '/', child: null }
  }

  // If something else is on the default port, pick a free high port for Vite.
  try {
    const res = await fetch(base, { method: 'GET' })
    if (res.ok || res.status === 304) {
      port = process.env.VITE_DEV_PORT || String(5200 + Math.floor(Math.random() * 200))
      base = `http://127.0.0.1:${port}`
      console.log(`Port ${process.env.VITE_DEV_PORT || '5173'} is not XEditor; starting Vite on ${port}`)
    }
  } catch {
    // nothing listening — start on preferred port
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
  if (!(await isXEditorServer(base))) {
    child.kill('SIGTERM')
    throw new Error(`Started server at ${base} but response is not XEditor`)
  }
  return { base, appPath: process.env.APP_PATH || '/', child }
}

/** Fail (or warn) if we captured the wrong product UI. */
async function assertAppChrome(page, stageId) {
  if (!String(stageId).startsWith('app-')) return

  // Wait until the app is past the bare "Loading…" shell.
  try {
    await page.waitForFunction(
      () => {
        if (document.querySelector('.sync-setup-panel')) return true
        if (
          document.querySelector('.block-editor')
          && document.querySelector('.xeditor-topbar')
        ) {
          return true
        }
        // Still only the loading placeholder
        const text = document.body?.innerText || ''
        if (/^Loading/i.test(text.trim()) || text.includes('Loading…')) {
          const onlyLoading =
            !document.querySelector('.block-editor')
            && !document.querySelector('.sync-setup-panel')
          return !onlyLoading && !!document.querySelector('.xeditor-topbar')
        }
        return false
      },
      { timeout: 30000 },
    )
  } catch {
    /* fall through to final check */
  }

  const info = await page.evaluate(() => {
    const hasEditor = !!document.querySelector(
      '.block-editor, .xeditor-topbar, .page-sidebar, .sync-setup-panel',
    )
    const title = document.title || ''
    const body = document.body?.innerText?.slice(0, 400) || ''
    const stuckLoading =
      /Loading…/.test(body)
      && !document.querySelector('.block-editor')
      && !document.querySelector('.sync-setup-panel')
    const foreign =
      /FakeShell|fakeshell/i.test(title) || /FakeShell|fakeshell/i.test(body)
    return { hasEditor, foreign, stuckLoading, title, body: body.slice(0, 120) }
  })
  if (!info.hasEditor || info.foreign || info.stuckLoading) {
    throw new Error(
      `Stage ${stageId}: page is not XEditor app chrome (title=${JSON.stringify(info.title)} body=${JSON.stringify(info.body)})`,
    )
  }
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
  console.log(`Base URL: ${base}  app: ${appPath}  locale: ${LOCALE}`)
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

  // Prefer closed sidebar + light theme (open only for app-sidebar stage).
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('collab-editor-sidebar', 'closed')
      localStorage.setItem('collab-editor-theme', 'light')
    } catch {
      /* ignore */
    }
  })

  // Clipboard for markdown paste into the block editor
  try {
    await page.browserContext().overridePermissions(base.replace(/\/$/, ''), [
      'clipboard-read',
      'clipboard-write',
    ])
  } catch {
    /* CDP grant is retried per paste */
  }

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
    locale: LOCALE,
    targetKb: TARGET_KB,
    shots: [],
  }

  /** Avoid reloading the SPA for every app stage (goto often hangs under Vite HMR). */
  let lastAppUrl = null
  let lastMobile = null

  try {
    for (const stage of stages) {
      // Normalize: base + path
      const fullUrl =
        stage.path === 'APP'
          ? `${base.replace(/\/$/, '')}${appPath.startsWith('/') ? appPath : `/${appPath}`}`
          : `${base.replace(/\/$/, '')}${stage.path.startsWith('/') ? stage.path : `/${stage.path}`}`

      const vp = await applyStageViewport(page, stage)
      console.log(`\n→ ${stage.id}: ${stage.title}`)
      console.log(`  ${fullUrl}${vp.mobile ? `  [mobile ${vp.width}×${vp.height}]` : ''}`)

      // Always reload for first-open / sync modal so we don't stick on "Loading…"
      // after a prior stage left the app mid-setup. Reload on mobile switch too.
      const needNav =
        stage.path !== 'APP'
        || lastAppUrl !== fullUrl
        || stage.id === 'app-sync-setup'
        || stage.id === 'app-editor'
        // Reload when switching desktop ↔ mobile viewport (not every mobile stage)
        || lastMobile !== Boolean(stage.mobile)

      if (needNav) {
        // Vite HMR / IDB can prevent a clean 'load'/'networkidle' lifecycle.
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
        if (stage.path === 'APP') lastAppUrl = fullUrl
        lastMobile = Boolean(stage.mobile)
      } else {
        // Dismiss overlays that leak between stages
        await page.evaluate(() => {
          document.querySelector('.settings-panel [aria-label="Close"], .settings-panel button.close')?.click()
          document.querySelector('.import-close, .import-backdrop')?.click()
          document.querySelector('.palette-backdrop, .palette-root button[aria-label="Close"]')?.click()
        })
        await page.keyboard.press('Escape').catch(() => {})
        await sleep(150)
      }

      // Re-apply after navigation (SPA boot may clear attributes).
      if (stage.mobile) {
        await applyPhoneUiMode(page, true)
      } else if (stage.path === 'APP') {
        await applyPhoneUiMode(page, false)
      }

      // Unblock editor stages if the sync chooser is still up (e.g. after app-sync-setup).
      if (stage.id !== 'app-sync-setup') {
        await pickLocalSyncIfNeeded(page)
      }

      // After sync dismiss + editor paint, pin phone UI again
      if (stage.mobile) {
        await applyPhoneUiMode(page, true)
      }

      if (stage.waitFor) {
        await page.waitForSelector(stage.waitFor, { timeout: 25000 }).catch(() => {
          console.warn(`  warn: waitFor ${stage.waitFor} timed out`)
        })
      } else {
        await sleep(400)
      }

      if (stage.prepare) {
        try {
          await stage.prepare(page)
        } catch (e) {
          console.warn(`  warn: prepare failed: ${e.message || e}`)
        }
      }

      // Settle fonts / layout
      await sleep(350)

      try {
        await assertAppChrome(page, stage.id)
      } catch (e) {
        console.error(`  ${e.message || e}`)
        throw e
      }

      // Sidebar policy: only app-sidebar (or sidebar:'open') keeps the rail open.
      const wantSidebarOpen = stage.sidebar === 'open' || stage.id === 'app-sidebar'
      const isCommentsStage = /comments/i.test(stage.id)
      if (String(stage.id).startsWith('app-') || stage.mobile) {
        // Don't dismiss the comments panel we just seeded for comments shots
        if (!isCommentsStage) {
          await ensureCommentsClosed(page).catch(() => {})
        }
        if (wantSidebarOpen) {
          await ensureSidebarOpen(page)
          if (!(await sidebarIsVisiblyOpen(page))) {
            throw new Error(`${stage.id}: left sidebar expected open — aborting save`)
          }
        } else if (stage.id !== 'app-sync-setup') {
          await ensureSidebarClosed(page)
        }
      }

      const suffix = FULL_SCREEN ? '-full' : ''
      const ext = USE_PNG ? 'png' : 'jpg'
      // Prefer full viewport (includes topbar + page header/emoji). Optional crops only if set.
      const clip =
        FULL_SCREEN || FULL_PAGE || !stage.clipFrom
          ? stage.clip
          : await resolveClip(page, stage)

      // Tall demo page: multiple normal-height shots while scrolling (not one giant image).
      if (stage.scrollShots && !FULL_PAGE) {
        await ensureHeaderVisible(page)
        await ensureSidebarClosed(page)
        const metrics = await getAppScrollMetrics(page)
        const offsets = computeScrollOffsets(metrics, {
          overlap: stage.scrollOverlap ?? 0.18,
          maxShots: stage.maxScrollShots ?? 8,
        })
        console.log(
          `  scroll series: ${offsets.length} shot(s), maxScroll=${metrics.maxScroll}px, view=${metrics.clientHeight}px`,
        )
        for (let i = 0; i < offsets.length; i++) {
          await setAppScrollTop(page, offsets[i])
          await ensureSidebarClosed(page)
          // Part 1 keeps the plain stage id for docs; further parts are -2, -3, …
          const part = i === 0 ? '' : `-${i + 1}`
          const file = `${stage.id}${part}${suffix}.${ext}`
          const outPath = join(OUT_DIR, file)
          const bytes = await captureCompressed(page, outPath, clip, { fullPage: false })
          const kb = (bytes / 1024).toFixed(1)
          console.log(`  saved ${relative(root, outPath)} (${kb} KB) [scroll ${i + 1}/${offsets.length} y=${offsets[i]}]`)
          manifest.shots.push({
            id: `${stage.id}${part || ''}`,
            title: `${stage.title} (${i + 1}/${offsets.length})`,
            file,
            bytes,
            kb: Number(kb),
            url: fullUrl,
            fullScreen: FULL_SCREEN,
            fullPage: false,
            mobile: Boolean(stage.mobile),
            scrollIndex: i + 1,
            scrollTop: offsets[i],
          })
        }
        // Reset scroll for the next stage
        await setAppScrollTop(page, 0)
        continue
      }

      const file = `${stage.id}${suffix}.${ext}`
      const outPath = join(OUT_DIR, file)
      const useFullPage = FULL_PAGE || Boolean(stage.fullPage)
      if (useFullPage) {
        await expandScrollRootForFullPage(page)
      }
      const bytes = await captureCompressed(page, outPath, clip, {
        fullPage: useFullPage,
      })
      const kb = (bytes / 1024).toFixed(1)
      console.log(`  saved ${relative(root, outPath)} (${kb} KB)${useFullPage ? ' [full-page]' : ''}`)
      manifest.shots.push({
        id: stage.id,
        title: stage.title,
        file,
        bytes,
        kb: Number(kb),
        url: fullUrl,
        fullScreen: FULL_SCREEN,
        fullPage: useFullPage,
        mobile: Boolean(stage.mobile),
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

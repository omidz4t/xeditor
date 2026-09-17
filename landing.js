/**
 * XEditor landing interactions — reveal, marquee, carousel, parallax, partner trail.
 */
;(() => {
  const ASSET_BASE = document.documentElement.getAttribute('data-asset-base') || './'
  const SHOT_DIR = (document.documentElement.getAttribute('data-screenshot-dir') || 'screenshots').replace(/\/$/, '')

  // Desktop shots only (1280×800 / 16:10) — portrait mobile frames break marquee sizing
  const SHOTS = [
    `./${SHOT_DIR}/app-editor.jpg`,
    `./${SHOT_DIR}/app-editor-2.jpg`,
    `./${SHOT_DIR}/app-editor-3.jpg`,
    `./${SHOT_DIR}/app-editor-4.jpg`,
    `./${SHOT_DIR}/app-sidebar.jpg`,
    `./${SHOT_DIR}/app-comments.jpg`,
    `./${SHOT_DIR}/app-import.jpg`,
    `./${SHOT_DIR}/app-command-palette.jpg`,
    `./${SHOT_DIR}/app-settings.jpg`,
    `./${SHOT_DIR}/app-sync-setup.jpg`,
  ]

  const FEATURES = Array.isArray(window.LANDING_FEATURES)
    ? window.LANDING_FEATURES
    : [
    {
      title: 'Block canvas',
      body: 'Headings, lists, todos, code, tables, images, polls — the full editor in chat.',
      detail:
        'XEditor is a real block workspace, not a plain text box. Slash commands and Markdown paste help you structure writing the way you would in a modern doc app — then ship that same canvas inside Delta Chat as a .xdc.',
      points: [
        'Headings, lists, todos, toggles, quotes, and callouts',
        'Code blocks, tables, images, and polls',
        'Slash menu + Markdown paste for fast authoring',
        'Nested structure stays intact when you share the app',
      ],
      img: './screenshots/app-editor.jpg',
    },
    {
      title: 'Pages sidebar',
      body: 'Nested pages, search, and navigation that feels like a real workspace.',
      detail:
        'Organize a whole project as linked pages. The sidebar is your map: jump between notes, nest pages under pages, and keep everyone oriented in the same workspace.',
      points: [
        'Nested page tree with clear hierarchy',
        'Quick search across pages',
        'Stay on the same shared document set in chat',
        'Sidebar collapses on small screens',
      ],
      img: './screenshots/app-sidebar.jpg',
    },
    {
      title: 'Command palette',
      body: 'Ctrl+K for pages, theme, layout, and shortcuts without leaving the keyboard.',
      detail:
        'Power users stay in flow. Open the palette and jump to pages, switch themes, tweak layout, or run actions without hunting through menus.',
      points: [
        'Ctrl+K / ⌘K to open anytime',
        'Jump to any page by name',
        'Theme, layout, and app actions',
        'Keyboard-first — works great on desktop',
      ],
      img: './screenshots/app-command-palette.jpg',
    },
    {
      title: 'Comments',
      body: 'Page threads and replies so discussion stays next to the writing.',
      detail:
        'Discuss without leaving the doc. Page threads and replies live beside the content so feedback, decisions, and questions stay attached to what you wrote.',
      points: [
        'Page-level comment threads',
        'Replies keep context with the writing',
        'Side panel UI — no separate chat tab needed',
        'Works with multiplayer presence in chat',
      ],
      img: './screenshots/app-comments.jpg',
    },
    {
      title: 'Import / bind',
      body: 'Markdown, folders, ZIP, and workspace JSON from one Open / bind modal.',
      detail:
        'Bring existing notes in, or bind a folder so your filesystem and the editor stay aligned. One modal covers open, import, and bind flows for Markdown and workspace JSON.',
      points: [
        'Import Markdown files, folders, or ZIP archives',
        'Open workspace JSON backups',
        'Bind a folder for ongoing local workflows',
        'Same modal UX in browser demo and .xdc',
      ],
      img: './screenshots/app-import.jpg',
    },
  ]

  function assetUrl(path) {
    const raw = String(path || '')
    if (/^https?:\/\//.test(raw) || raw.startsWith('data:')) return raw
    const rel = raw.replace(/^\.\//, '')
    const base = ASSET_BASE.endsWith('/') ? ASSET_BASE : `${ASSET_BASE}`
    try {
      return new URL(rel, new URL(base, window.location.href)).href
    } catch {
      return `${base}${rel}`
    }
  }

  for (let i = 0; i < SHOTS.length; i += 1) SHOTS[i] = assetUrl(SHOTS[i])
  for (const f of FEATURES) f.img = assetUrl(f.img)

  // ── Reveal on scroll ─────────────────────────────────────────────────────
  const reveals = document.querySelectorAll('.reveal')
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const el = e.target
        const delay = el.getAttribute('data-delay') || '0'
        el.style.animationDelay = `${delay}s`
        el.classList.add('is-in')
        io.unobserve(el)
      }
    },
    { threshold: 0.1 },
  )
  reveals.forEach((el) => io.observe(el))

  // ── Hero typing (all copy blocks, height preserved) ──────────────────────
  const typeEls = [...document.querySelectorAll('.hero__copy .hero__type')]
  if (typeEls.length) {
    function formatTyped(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\.xdc/g, '<code>.xdc</code>')
    }

    // Reserve full height for every paragraph before typing starts
    for (const el of typeEls) {
      const full = el.getAttribute('data-text') || ''
      el.innerHTML = formatTyped(full)
      // force layout, lock height so typing doesn't collapse the block
      const h = el.getBoundingClientRect().height
      el.style.minHeight = `${Math.ceil(h)}px`
      el.textContent = ''
      el.classList.remove('is-done', 'is-typing')
    }

    function typeParagraph(el) {
      return new Promise((resolve) => {
        const full = el.getAttribute('data-text') || ''
        let i = 0
        el.classList.add('is-typing')
        el.classList.remove('is-done')

        const tick = () => {
          if (i >= full.length) {
            el.innerHTML = formatTyped(full)
            el.classList.remove('is-typing')
            el.classList.add('is-done')
            resolve()
            return
          }
          const step = full[i] === ' ' ? 1 : 1 + (Math.random() < 0.18 ? 1 : 0)
          i = Math.min(full.length, i + step)
          el.innerHTML = formatTyped(full.slice(0, i))
          const ch = full[i - 1]
          const pause = ch === '.' || ch === '—' || ch === ',' ? 70 : 16 + Math.random() * 26
          window.setTimeout(tick, pause)
        }
        tick()
      })
    }

    ;(async () => {
      await new Promise((r) => window.setTimeout(r, 380))
      for (const el of typeEls) {
        await typeParagraph(el)
        await new Promise((r) => window.setTimeout(r, 180))
      }
    })()

    // Re-measure reserved heights if the column width changes
    window.addEventListener(
      'resize',
      () => {
        for (const el of typeEls) {
          const full = el.getAttribute('data-text') || ''
          const prev = el.innerHTML
          const wasDone = el.classList.contains('is-done')
          el.style.minHeight = ''
          el.innerHTML = formatTyped(full)
          const h = el.getBoundingClientRect().height
          el.style.minHeight = `${Math.ceil(h)}px`
          if (!wasDone) el.innerHTML = prev
        }
      },
      { passive: true },
    )
  }

  // ── Presence cursors (page-absolute — scroll with the document) ──────────
  const presenceLayer = document.getElementById('presence-layer')
  if (presenceLayer && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const NAMES = ['Ada', 'Kai', 'Sam', 'Noor', 'Mila', 'Leo', 'Rae', 'Omar']
    const COLORS = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b', '#da77f2', '#74c0fc', '#ffa94d']
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
    const usedNames = new Set()
    const usedColors = new Set()
    /** @type {{ el: HTMLElement, x: number, y: number }[]} */
    const cursors = []

    function pageSize() {
      // Use layout width only — never scrollWidth (that creates horizontal scroll loops)
      const w = document.documentElement.clientWidth || window.innerWidth
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.querySelector('.page')?.scrollHeight || 0,
        window.innerHeight,
      )
      return { w, h }
    }

    function syncLayerSize() {
      const { h } = pageSize()
      presenceLayer.style.width = '100%'
      presenceLayer.style.maxWidth = '100%'
      presenceLayer.style.height = `${h}px`
    }

    function bounds() {
      const { w, h } = pageSize()
      const pad = 24
      return {
        minX: pad,
        minY: pad,
        maxX: Math.max(pad + 40, w - 140),
        maxY: Math.max(pad + 40, h - 80),
      }
    }

    function makeCursor() {
      let name = pick(NAMES)
      while (usedNames.has(name) && usedNames.size < NAMES.length) name = pick(NAMES)
      usedNames.add(name)
      let color = pick(COLORS)
      while (usedColors.has(color) && usedColors.size < COLORS.length) color = pick(COLORS)
      usedColors.add(color)

      const el = document.createElement('div')
      el.className = 'excal-cursor'
      el.style.setProperty('--cursor-color', color)
      el.innerHTML = `
        <svg class="excal-arrow" width="12" height="15" viewBox="0 0 12 15" fill="none" aria-hidden="true">
          <path d="M0 0 L0 14 L4 9 L11 8 Z" fill="#ffffff" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>
          <path d="M0 0 L0 14 L4 9 L11 8 Z" fill="${color}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        <span class="excal-name">${name}</span>
      `
      presenceLayer.appendChild(el)

      const b = bounds()
      const state = {
        el,
        x: b.minX + Math.random() * (b.maxX - b.minX),
        y: b.minY + Math.random() * Math.min(b.maxY - b.minY, window.innerHeight * 1.2),
      }
      const place = () => {
        el.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`
      }
      place()
      cursors.push(state)

      const wander = () => {
        syncLayerSize()
        const next = bounds()
        // Prefer points across the full page (not only the first screen)
        state.x = next.minX + Math.random() * (next.maxX - next.minX)
        state.y = next.minY + Math.random() * (next.maxY - next.minY)
        place()
        window.setTimeout(wander, 1600 + Math.random() * 2400)
      }
      window.setTimeout(wander, 700 + Math.random() * 1000)
      return state
    }

    // Ensure body is a positioning context for the absolute layer
    document.body.style.position = document.body.style.position || 'relative'

    syncLayerSize()
    makeCursor()
    makeCursor()

    // Keep layer height in sync when layout grows (images, fonts, etc.)
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => syncLayerSize())
        : null
    ro?.observe(document.documentElement)
    const pageEl = document.querySelector('.page')
    if (pageEl) ro?.observe(pageEl)

    window.addEventListener(
      'resize',
      () => {
        syncLayerSize()
        const next = bounds()
        for (const c of cursors) {
          c.x = Math.min(next.maxX, Math.max(next.minX, c.x))
          c.y = Math.min(next.maxY, Math.max(next.minY, c.y))
          c.el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`
        }
      },
      { passive: true },
    )
    window.addEventListener('load', syncLayerSize, { once: true })
  }

  // ── Marquee ──────────────────────────────────────────────────────────────
  const track = document.getElementById('marquee-track')
  if (track) {
    const strip = [...SHOTS, ...SHOTS]
    for (const src of strip) {
      const img = document.createElement('img')
      img.src = src
      img.alt = ''
      img.loading = 'eager'
      img.decoding = 'async'
      img.className = 'shot-img'
      track.appendChild(img)
    }
  }

  // ── Parallax ─────────────────────────────────────────────────────────────
  const parallax = document.getElementById('parallax-img')
  if (parallax) {
    let raf = 0
    const max = 200
    const tick = () => {
      const rect = parallax.getBoundingClientRect()
      const vh = window.innerHeight || 1
      const center = rect.top + rect.height / 2
      const progress = (vh / 2 - center) / vh
      const y = Math.max(-max, Math.min(max, progress * max))
      parallax.style.transform = `translate3d(0, ${y}px, 0)`
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    tick()
  }

  // ── Feature carousel ─────────────────────────────────────────────────────
  const carouselSection = document.getElementById('features')
  const carouselRoot = document.getElementById('feature-carousel')
  const carouselTrack = document.getElementById('carousel-track')
  const prevBtn = document.getElementById('carousel-prev')
  const nextBtn = document.getElementById('carousel-next')
  let index = 0
  let paused = false
  let morphOpen = false
  let cardW = 427.5
  const gap = 24
  /** @type {{ card: HTMLElement, rect: DOMRect, clone: HTMLElement, backdrop: HTMLElement } | null} */
  let morphState = null

  function measure() {
    cardW = window.innerWidth < 768 ? Math.max(260, window.innerWidth - 48) : 427.5
  }

  function featureFromCard(card) {
    const i = Number(card?.dataset?.featureIndex || 0)
    return FEATURES[((i % FEATURES.length) + FEATURES.length) % FEATURES.length]
  }

  function renderCarousel() {
    if (!carouselTrack) return
    if (morphOpen) return
    measure()
    carouselTrack.innerHTML = ''
    const loop = [...FEATURES, ...FEATURES, ...FEATURES]
    loop.forEach((f, i) => {
      const art = document.createElement('article')
      art.className = 'carousel-card'
      art.style.flex = `0 0 ${cardW}px`
      art.dataset.featureIndex = String(i % FEATURES.length)
      art.tabIndex = 0
      art.setAttribute('role', 'button')
      art.setAttribute('aria-label', `Open details: ${f.title}`)
      art.innerHTML = `
        <img src="${f.img}" alt="" draggable="false" />
        <h3>${f.title}</h3>
        <p>${f.body}</p>
        <span class="carousel-card__more">Learn more →</span>
      `
      art.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        openMorph(art)
      })
      art.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openMorph(art)
        }
      })
      carouselTrack.appendChild(art)
    })
    index = FEATURES.length
    applyTransform(false)
  }

  function applyTransform(smooth) {
    if (!carouselTrack || morphOpen) return
    carouselTrack.style.transition = smooth
      ? 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
      : 'none'
    carouselTrack.style.transform = `translate3d(${-(index * (cardW + gap))}px, 0, 0)`
  }

  function step(delta) {
    if (morphOpen) return
    index += delta
    if (index >= FEATURES.length * 2) index = FEATURES.length
    if (index < FEATURES.length) index = FEATURES.length * 2 - 1
    applyTransform(true)
  }

  const MORPH_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
  const MORPH_MS = 480

  function morphTargetBox() {
    const pad = window.innerWidth < 768 ? 16 : 32
    const width = Math.min(720, window.innerWidth - pad * 2)
    const maxH = window.innerHeight - pad * 2
    return { pad, width, maxH }
  }

  function buildMorphPanel(feature) {
    const panel = document.createElement('div')
    panel.className = 'feature-modal'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    panel.setAttribute('aria-label', feature.title)
    const points = (feature.points || [])
      .map((p) => `<li>${p}</li>`)
      .join('')
    panel.innerHTML = `
      <button type="button" class="feature-modal__close" aria-label="Close">×</button>
      <img class="feature-modal__img" src="${feature.img}" alt="" draggable="false" />
      <div class="feature-modal__body">
        <h3 class="feature-modal__title">${feature.title}</h3>
        <p class="feature-modal__lead">${feature.body}</p>
        <p class="feature-modal__detail">${feature.detail || ''}</p>
        ${points ? `<ul class="feature-modal__points">${points}</ul>` : ''}
      </div>
    `
    panel.querySelector('.feature-modal__close')?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      closeMorph()
    })
    panel.addEventListener('click', (e) => e.stopPropagation())
    return panel
  }

  /**
   * FLIP morph: card → centered modal with full explanation.
   */
  function openMorph(card) {
    if (morphOpen || !card) return
    const feature = featureFromCard(card)
    if (!feature) return

    paused = true
    morphOpen = true

    const first = card.getBoundingClientRect()
    card.classList.add('carousel-card--source-hidden')

    const backdrop = document.createElement('button')
    backdrop.type = 'button'
    backdrop.className = 'carousel-morph-backdrop'
    backdrop.setAttribute('aria-label', 'Close feature details')
    backdrop.addEventListener('click', () => closeMorph())

    const panel = buildMorphPanel(feature)
    const { width, maxH } = morphTargetBox()

    Object.assign(panel.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      width: `${width}px`,
      maxHeight: `${maxH}px`,
      margin: '0',
      zIndex: '96',
      transform: 'translate(-50%, -50%)',
      transition: 'none',
      transformOrigin: 'center center',
      willChange: 'transform, opacity',
    })

    document.body.appendChild(backdrop)
    document.body.appendChild(panel)
    document.body.classList.add('carousel-morph-open')

    // Measure final (centered) box
    const last = panel.getBoundingClientRect()
    const dx = first.left + first.width / 2 - (last.left + last.width / 2)
    const dy = first.top + first.height / 2 - (last.top + last.height / 2)
    const sx = Math.max(0.001, first.width / last.width)
    const sy = Math.max(0.001, first.height / last.height)

    panel.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
    panel.style.opacity = '1'
    panel.style.borderRadius = '20px'

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        backdrop.classList.add('is-visible')
        panel.style.transition = `transform ${MORPH_MS}ms ${MORPH_EASE}, border-radius ${MORPH_MS}ms ease, opacity ${MORPH_MS}ms ease`
        panel.style.transform = 'translate(-50%, -50%) scale(1)'
        panel.style.borderRadius = '24px'
      })
    })

    morphState = { card, panel, backdrop, closing: false }
    panel.querySelector('.feature-modal__close')?.focus()
  }

  function closeMorph() {
    if (!morphOpen || !morphState || morphState.closing) return
    morphState.closing = true
    const { card, panel, backdrop } = morphState

    const last = panel.getBoundingClientRect()
    const first = card.getBoundingClientRect()
    backdrop.classList.remove('is-visible')

    const dx = first.left + first.width / 2 - (last.left + last.width / 2)
    const dy = first.top + first.height / 2 - (last.top + last.height / 2)
    const sx = Math.max(0.01, first.width / Math.max(1, last.width))
    const sy = Math.max(0.01, first.height / Math.max(1, last.height))

    const offscreen =
      first.bottom < 0
      || first.top > window.innerHeight
      || first.right < 0
      || first.left > window.innerWidth

    panel.style.transition = `transform ${MORPH_MS}ms ${MORPH_EASE}, opacity ${MORPH_MS * 0.85}ms ease, border-radius ${MORPH_MS}ms ease`
    if (offscreen) {
      panel.style.opacity = '0'
      panel.style.transform = 'translate(-50%, -50%) scale(0.92)'
    } else {
      panel.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
      panel.style.opacity = '1'
      panel.style.borderRadius = '20px'
    }

    let done = false
    const finish = () => {
      if (done) return
      done = true
      panel.remove()
      backdrop.remove()
      card.classList.remove('carousel-card--source-hidden')
      document.body.classList.remove('carousel-morph-open')
      morphState = null
      morphOpen = false
      const over =
        carouselSection?.matches(':hover')
        || carouselRoot?.matches(':hover')
      paused = Boolean(over)
    }

    panel.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'transform' || e.propertyName === 'opacity') finish()
    })
    window.setTimeout(finish, MORPH_MS + 90)
  }

  if (carouselTrack) {
    renderCarousel()
    window.addEventListener('resize', () => {
      if (morphOpen) closeMorph()
      measure()
      renderCarousel()
    })
    prevBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (morphOpen) closeMorph()
      step(-1)
    })
    nextBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (morphOpen) closeMorph()
      step(1)
    })

    const hoverTargets = [carouselSection, carouselRoot].filter(Boolean)
    for (const el of hoverTargets) {
      el.addEventListener('mouseenter', () => {
        paused = true
      })
      el.addEventListener('mouseleave', () => {
        if (!morphOpen) paused = false
      })
    }

    setInterval(() => {
      if (!paused && !morphOpen) step(1)
    }, 3500)

    // Only Escape closes the modal (scroll/wheel no longer kill it)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && morphOpen) {
        e.preventDefault()
        closeMorph()
      }
    })
  }

  // ── Partner cursor trail (page icon emoji presets from IconEmojiPicker) ──
  // Keep in sync with packages/svelte/src/ui/emojiPresets.ts
  const PAGE_EMOJIS = [
    '💡',
    '📌',
    '📝',
    '✅',
    '⚠️',
    '❗',
    '❓',
    '🔥',
    '⭐',
    '🎯',
    '🚀',
    '💎',
    '📎',
    '🔖',
    '📋',
    '🗂️',
    '📦',
    '🔒',
    '🔑',
    '⚡',
    '🎨',
    '🧩',
    '🛠️',
    '🧪',
    '📊',
    '📈',
    '📉',
    '🗓️',
    '⏰',
    '🌟',
    '❤️',
    '💬',
    '📣',
    '🏆',
    '✨',
    '🎉',
    '🧠',
    '👀',
    '👍',
    '👎',
  ]
  const stage = document.getElementById('partner-stage')
  if (stage) {
    let last = 0
    let emojiCursor = Math.floor(Math.random() * PAGE_EMOJIS.length)
    stage.addEventListener('mousemove', (e) => {
      const now = performance.now()
      if (now - last < 70) return
      last = now
      const rect = stage.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const ghost = document.createElement('span')
      ghost.className = 'partner-ghost partner-ghost--emoji'
      ghost.setAttribute('aria-hidden', 'true')
      ghost.textContent = PAGE_EMOJIS[emojiCursor % PAGE_EMOJIS.length]
      emojiCursor += 1
      const rot = Math.random() * 28 - 14
      const size = 1.65 + Math.random() * 0.85
      ghost.style.left = `${x}px`
      ghost.style.top = `${y}px`
      ghost.style.fontSize = `${size}rem`
      ghost.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`
      stage.appendChild(ghost)
      window.setTimeout(() => ghost.remove(), 1000)
    })
  }

  // Mark images for lightbox (project + marquee + carousel)
  // lightbox.js listens for .shot img — also support .shot-img
  document.querySelectorAll('.shot-img, .project__img, .parallax-img').forEach((img) => {
    img.classList.add('shot-target')
  })

  // ── Bottom nav: clearance + hide when partner CTAs are on-screen ─────────
  const bottomNav = document.getElementById('bottom-nav')
  const partnerActions = document.getElementById('partner-actions')

  function syncBottomNavClearance() {
    if (!bottomNav) return
    // Temporarily show for accurate measure if hidden
    const wasHidden = bottomNav.classList.contains('is-hidden')
    if (wasHidden) {
      bottomNav.classList.remove('is-hidden')
      bottomNav.style.visibility = 'hidden'
      bottomNav.style.pointerEvents = 'none'
      bottomNav.style.opacity = '0'
    }
    const styles = window.getComputedStyle(bottomNav)
    const bottomOffset = parseFloat(styles.bottom) || 24
    const h = bottomNav.getBoundingClientRect().height || 56
    // bar height + distance from viewport bottom + small breathing room
    const clearance = Math.ceil(h + bottomOffset + 12)
    document.documentElement.style.setProperty('--bottom-nav-clearance', `${clearance}px`)
    if (wasHidden) {
      bottomNav.style.visibility = ''
      bottomNav.style.pointerEvents = ''
      bottomNav.style.opacity = ''
      bottomNav.classList.add('is-hidden')
    }
  }

  syncBottomNavClearance()
  window.addEventListener('resize', syncBottomNavClearance, { passive: true })
  window.addEventListener('load', syncBottomNavClearance, { once: true })

  if (bottomNav && partnerActions) {
    const setHidden = (hidden) => {
      bottomNav.classList.toggle('is-hidden', Boolean(hidden))
      bottomNav.setAttribute('aria-hidden', hidden ? 'true' : 'false')
    }

    // Hide floating bar whenever the in-page CTAs occupy the viewport
    // (same actions — avoid stacking two identical control groups).
    const ioNav = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        setHidden(entry.isIntersecting && entry.intersectionRatio > 0)
      },
      {
        root: null,
        rootMargin: '0px 0px -8% 0px',
        threshold: [0, 0.01, 0.1, 0.25, 0.5, 0.75, 1],
      },
    )
    ioNav.observe(partnerActions)
  }
})()

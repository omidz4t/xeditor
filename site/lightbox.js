/**
 * Landing screenshot lightbox — viewport-fit, centered, edge controls.
 */
;(() => {
  const root = document.getElementById('lightbox')
  if (!root) return

  const container = root.querySelector('.lb-container')
  const image = root.querySelector('.lb-image')
  const loader = root.querySelector('.lb-loader')
  const captionEl = root.querySelector('.lb-caption')
  const numberEl = root.querySelector('.lb-number')
  const btnPrev = root.querySelector('.lb-prev')
  const btnNext = root.querySelector('.lb-next')
  const btnClose = root.querySelector('.lb-close')

  if (!container || !image) return

  const SELECTOR =
    '.shot img, .shot-img, .project__img, .parallax-img, .marquee__track img, .carousel-card img'

  const opts = {
    fadeDuration: 280,
    imageFadeDuration: 280,
    wrapAround: true,
    albumLabel: 'Image %1 of %2',
  }

  /** @type {HTMLImageElement[]} */
  let gallery = []
  let index = 0
  let lastFocus = null
  let busy = false
  let loadToken = 0

  function collect() {
    gallery = [...document.querySelectorAll(SELECTOR)].filter(
      (el) => el instanceof HTMLImageElement && el.getAttribute('src'),
    )
  }

  function captionFor(el) {
    return (
      el.closest('figure')?.querySelector('figcaption')?.textContent?.trim()
      || el.getAttribute('data-title')
      || el.alt
      || ''
    )
  }

  function setNavVisibility() {
    const multi = gallery.length > 1
    if (btnPrev) btnPrev.hidden = !multi
    if (btnNext) btnNext.hidden = !multi
  }

  function updateMeta() {
    const source = gallery[index]
    if (!source) return
    const cap = captionFor(source)
    if (captionEl) {
      captionEl.textContent = cap
      captionEl.hidden = !cap
    }
    if (numberEl) {
      if (gallery.length > 1) {
        numberEl.hidden = false
        numberEl.textContent = opts.albumLabel
          .replace('%1', String(index + 1))
          .replace('%2', String(gallery.length))
      } else {
        numberEl.hidden = true
        numberEl.textContent = ''
      }
    }
    setNavVisibility()
  }

  /** Max box the image may occupy (centered in viewport). */
  function maxBox() {
    const vw = window.innerWidth || document.documentElement.clientWidth || 320
    const vh = window.innerHeight || document.documentElement.clientHeight || 480
    // Small screens: tight side padding (controls are smaller / overlay). Desktop: room for edge arrows.
    const narrow = vw < 720
    const padX = narrow ? 20 : 96
    const padY = narrow ? 88 : 120
    return {
      maxW: Math.max(160, Math.min(1100, vw - padX)),
      maxH: Math.max(140, vh - padY),
      vw,
      vh,
    }
  }

  function fitSize(natW, natH) {
    const { maxW, maxH } = maxBox()
    if (!natW || !natH) return { w: Math.min(280, maxW), h: Math.min(180, maxH) }
    const scale = Math.min(maxW / natW, maxH / natH, 1)
    return {
      w: Math.max(1, Math.round(natW * scale)),
      h: Math.max(1, Math.round(natH * scale)),
    }
  }

  function applySize(w, h) {
    // Hard-clamp again in case of orientation / layout race
    const { maxW, maxH } = maxBox()
    if (w > maxW || h > maxH) {
      const s = Math.min(maxW / w, maxH / h, 1)
      w = Math.max(1, Math.round(w * s))
      h = Math.max(1, Math.round(h * s))
    }
    container.style.width = `${w}px`
    container.style.height = `${h}px`
    container.style.maxWidth = `${maxW}px`
    container.style.maxHeight = `${maxH}px`
    // Fill the box; CSS object-fit keeps aspect without overflowing
    image.style.width = '100%'
    image.style.height = '100%'
    image.style.maxWidth = '100%'
    image.style.maxHeight = '100%'
    image.style.objectFit = 'contain'
  }

  function showLoader(on) {
    if (!loader) return
    loader.classList.toggle('lb-loader--on', on)
    loader.setAttribute('aria-hidden', on ? 'false' : 'true')
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () =>
        resolve({
          w: img.naturalWidth || img.width,
          h: img.naturalHeight || img.height,
        })
      img.onerror = reject
      img.src = src
    })
  }

  async function showImage(i) {
    if (!gallery.length) return
    const token = ++loadToken
    busy = true
    index = ((i % gallery.length) + gallery.length) % gallery.length
    const source = gallery[index]
    const src = source.currentSrc || source.src

    showLoader(true)
    image.style.opacity = '0'
    updateMeta()

    try {
      const nat = await loadImage(src)
      if (token !== loadToken) return
      const size = fitSize(nat.w, nat.h)
      applySize(size.w, size.h)
      image.src = src
      image.alt = source.alt || ''
      showLoader(false)
      // fade in
      image.style.transition = `opacity ${opts.imageFadeDuration}ms ease`
      void image.offsetWidth
      image.style.opacity = '1'
    } catch {
      if (token !== loadToken) return
      showLoader(false)
      image.style.opacity = '1'
    } finally {
      if (token === loadToken) busy = false
    }
  }

  function openAt(i) {
    collect()
    if (!gallery.length) return
    lastFocus = document.activeElement

    root.hidden = false
    // reset to a small centered shell while loading
    applySize(120, 80)
    image.style.opacity = '0'
    image.removeAttribute('src')

    document.body.classList.add('lightbox-open')
    root.classList.remove('lb--visible')
    void root.offsetWidth
    requestAnimationFrame(() => root.classList.add('lb--visible'))

    showImage(i)
    btnClose?.focus()
  }

  function close() {
    if (root.hidden) return
    loadToken += 1
    root.classList.remove('lb--visible')
    window.setTimeout(() => {
      root.hidden = true
      document.body.classList.remove('lightbox-open')
      image.removeAttribute('src')
      image.style.opacity = '0'
      image.style.width = ''
      image.style.height = ''
      container.style.width = ''
      container.style.height = ''
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus()
    }, opts.fadeDuration)
  }

  function step(delta) {
    if (root.hidden || gallery.length < 2) return
    let next = index + delta
    if (opts.wrapAround) {
      next = (next + gallery.length) % gallery.length
    } else {
      next = Math.max(0, Math.min(gallery.length - 1, next))
      if (next === index) return
    }
    showImage(next)
  }

  document.addEventListener(
    'click',
    (event) => {
      const t = event.target
      if (!(t instanceof Element)) return
      if (t.closest('.carousel-card') && !t.closest('.carousel-card--morph')) return
      const img = t.closest(SELECTOR)
      if (!img || !(img instanceof HTMLImageElement)) return
      event.preventDefault()
      event.stopPropagation()
      collect()
      const i = gallery.indexOf(img)
      openAt(i >= 0 ? i : 0)
    },
    true,
  )

  document.addEventListener('keydown', (event) => {
    if (root.hidden) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      step(1)
    }
  })

  root.querySelectorAll('[data-lb-close]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault()
      close()
    })
  })
  btnClose?.addEventListener('click', (e) => {
    e.preventDefault()
    close()
  })
  btnPrev?.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    step(-1)
  })
  btnNext?.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    step(1)
  })

  // ── Touch swipe → prev / next (single finger; leave multi-touch for pinch) ─
  const swipe = {
    active: false,
    id: null,
    x0: 0,
    y0: 0,
    x: 0,
    y: 0,
    t0: 0,
  }
  const SWIPE_MIN_PX = 56
  const SWIPE_MAX_OFF_AXIS = 72
  const SWIPE_MAX_MS = 700

  function swipeTargetIsControl(target) {
    return (
      target instanceof Element
      && Boolean(target.closest('.lb-prev, .lb-next, .lb-close, [data-lb-close]'))
    )
  }

  function resetSwipeVisual() {
    if (!container) return
    container.style.transition = 'transform 0.22s ease, opacity 0.22s ease'
    container.style.transform = ''
    container.style.opacity = ''
    window.setTimeout(() => {
      if (container) container.style.transition = ''
    }, 240)
  }

  root.addEventListener(
    'touchstart',
    (e) => {
      if (root.hidden || busy || e.touches.length !== 1) {
        swipe.active = false
        return
      }
      if (swipeTargetIsControl(e.target)) return
      const t = e.touches[0]
      swipe.active = true
      swipe.id = t.identifier
      swipe.x0 = t.clientX
      swipe.y0 = t.clientY
      swipe.x = t.clientX
      swipe.y = t.clientY
      swipe.t0 = performance.now()
      if (container) {
        container.style.transition = 'none'
      }
    },
    { passive: true },
  )

  root.addEventListener(
    'touchmove',
    (e) => {
      if (!swipe.active || root.hidden) return
      // Pinch / multi-touch → cancel swipe so zoom can work
      if (e.touches.length !== 1) {
        swipe.active = false
        resetSwipeVisual()
        return
      }
      let t = null
      for (const touch of e.touches) {
        if (touch.identifier === swipe.id) {
          t = touch
          break
        }
      }
      if (!t) return
      swipe.x = t.clientX
      swipe.y = t.clientY
      const dx = swipe.x - swipe.x0
      const dy = swipe.y - swipe.y0
      // Only drag horizontally once intent is clear
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15 && container) {
        const damp = Math.max(-120, Math.min(120, dx * 0.35))
        container.style.transform = `translate3d(${damp}px, 0, 0)`
        container.style.opacity = String(Math.max(0.55, 1 - Math.abs(damp) / 280))
      }
    },
    { passive: true },
  )

  root.addEventListener(
    'touchend',
    (e) => {
      if (!swipe.active) return
      swipe.active = false
      const dt = performance.now() - swipe.t0
      const dx = swipe.x - swipe.x0
      const dy = swipe.y - swipe.y0
      const horizontal = Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.2
      const quick = dt <= SWIPE_MAX_MS
      const notMostlyVertical = Math.abs(dy) <= SWIPE_MAX_OFF_AXIS || Math.abs(dx) > Math.abs(dy)

      if (horizontal && quick && notMostlyVertical && !busy && gallery.length > 1) {
        // Swipe left → next; swipe right → previous
        if (dx < 0) step(1)
        else step(-1)
      }
      resetSwipeVisual()
      // Ignore leftover changedTouches if multi-finger ended
      void e
    },
    { passive: true },
  )

  root.addEventListener(
    'touchcancel',
    () => {
      if (!swipe.active) return
      swipe.active = false
      resetSwipeVisual()
    },
    { passive: true },
  )

  function refitCurrent() {
    if (root.hidden || !image.src) return
    const natW = image.naturalWidth
    const natH = image.naturalHeight
    if (!natW || !natH) return
    const size = fitSize(natW, natH)
    applySize(size.w, size.h)
  }

  window.addEventListener('resize', refitCurrent, { passive: true })
  window.addEventListener('orientationchange', () => {
    window.setTimeout(refitCurrent, 120)
  })
  // Mobile browser chrome show/hide changes visual viewport without a full resize
  window.visualViewport?.addEventListener('resize', refitCurrent, { passive: true })
})()

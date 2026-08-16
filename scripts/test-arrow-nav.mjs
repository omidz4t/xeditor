#!/usr/bin/env node
/**
 * Smoke test: ArrowDown with no selection selects first block (with highlight),
 * further ArrowDown moves selection to the next block.
 *
 * Usage: node scripts/test-arrow-nav.mjs [baseUrl]
 */
import puppeteer from 'puppeteer'

const base = process.argv[2] || 'http://127.0.0.1:4173/'

async function selectedIds(page) {
  return page.$$eval('.ebi-selected', (els) =>
    els.map((el) => el.getAttribute('data-block-id')).filter(Boolean),
  )
}

async function blockCount(page) {
  return page.$$eval('.block-editor [data-block-id]', (els) => els.length)
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)

  try {
    await page.goto(base, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.block-editor [contenteditable="true"]', { timeout: 10000 })

    // Seed multiple blocks via paste (more reliable than key typing in CE under puppeteer).
    await page.click('.block-editor [contenteditable="true"]')
    await page.evaluate(() => {
      const el = document.querySelector('.block-editor [contenteditable="true"]')
      el?.focus()
      const dt = new DataTransfer()
      dt.setData('text/plain', 'First line\n\nSecond line\n\nThird line')
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      )
    })
    await page.waitForFunction(
      () => document.querySelectorAll('.block-editor [data-block-id]').length >= 3,
      { timeout: 5000 },
    )
    const n = await blockCount(page)
    console.log('block count after paste:', n)

    // Clear caret + focus editor root (no block selection).
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges()
      document.activeElement?.blur?.()
      document.querySelector('.block-editor')?.focus()
    })

    let sel = await selectedIds(page)
    console.log('before arrows, selected:', sel)

    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(
      () => document.querySelectorAll('.ebi-selected').length >= 1,
      { timeout: 3000 },
    )
    sel = await selectedIds(page)
    console.log('after 1st ArrowDown, selected:', sel)
    if (sel.length !== 1) {
      throw new Error(`Expected 1 selected block after first ↓, got ${JSON.stringify(sel)}`)
    }
    const first = sel[0]

    const bg = await page.$eval('.ebi-selected', (el) => getComputedStyle(el).backgroundColor)
    console.log('selected background:', bg)
    if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
      throw new Error(`Selected block has no visible background: ${bg}`)
    }

    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(
      (prev) => {
        const ids = [...document.querySelectorAll('.ebi-selected')].map((el) =>
          el.getAttribute('data-block-id'),
        )
        return ids.length === 1 && ids[0] && ids[0] !== prev
      },
      { timeout: 3000 },
      first,
    )
    const second = (await selectedIds(page))[0]
    console.log('after 2nd ArrowDown, selected:', second)
    if (!second || second === first) {
      throw new Error('ArrowDown did not move selection to the next block')
    }

    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(
      (prev) => {
        const ids = [...document.querySelectorAll('.ebi-selected')].map((el) =>
          el.getAttribute('data-block-id'),
        )
        return ids.length === 1 && ids[0] && ids[0] !== prev
      },
      { timeout: 3000 },
      second,
    )
    const third = (await selectedIds(page))[0]
    console.log('after 3rd ArrowDown, selected:', third)
    if (!third || third === second) {
      throw new Error('Third ArrowDown did not advance selection')
    }

    // Typing while a block is selected must insert into that block.
    await page.keyboard.type('Z')
    await new Promise((r) => setTimeout(r, 200))
    const typed = await page.evaluate((id) => {
      const el = document.querySelector(`[data-block-id="${id}"]`)
      return (el?.innerText || '').trim()
    }, third)
    console.log('after typing Z into selected block:', JSON.stringify(typed))
    if (!typed.includes('Z')) {
      throw new Error(`Expected selected block to contain "Z", got ${JSON.stringify(typed)}`)
    }
    // Selection chrome should clear once editing
    const stillSelected = await selectedIds(page)
    console.log('selected after type:', stillSelected)

    console.log('OK: arrow block selection + type-into-selected works')
    await browser.close()
    process.exit(0)
  } catch (err) {
    console.error('FAIL:', err.message || err)
    await page.screenshot({ path: 'arrow-nav-fail.png', fullPage: true }).catch(() => {})
    await browser.close()
    process.exit(1)
  }
}

main()

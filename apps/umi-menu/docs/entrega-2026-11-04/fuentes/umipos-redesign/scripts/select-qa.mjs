import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

// locator.click() may auto-scroll immediately before pointerdown. Its queued
// scroll event then reaches RAC's close-on-scroll listener after the menu opens.
// Finish scrolling first, then send exactly one physical click to the visible
// trigger. Never retry a click or alter production focus/dismissal behavior.
export async function clickSelectTrigger(page, trigger) {
  await trigger.evaluate(element => new Promise(resolve => {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    let previous = '', stableFrames = 0
    const settled = () => {
      const rect = element.getBoundingClientRect()
      const positions = [rect.x, rect.y, window.scrollX, window.scrollY]
      for (let parent = element.parentElement; parent; parent = parent.parentElement) positions.push(parent.scrollTop, parent.scrollLeft)
      const current = positions.join(',')
      stableFrames = current === previous ? stableFrames + 1 : 0
      previous = current
      if (stableFrames >= 2) resolve()
      else requestAnimationFrame(settled)
    }
    requestAnimationFrame(settled)
  }))
  assert.ok(await trigger.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  }), 'Select trigger must be visible and unobstructed before the physical click')
  const rect = await trigger.boundingBox()
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2)
}

async function run() {
  const browser = await chromium.launch({ executablePath: '/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' })
  const results = [], errors = []
  const check = (name, value) => { assert.ok(value, name); results.push(name); console.log('PASS', name) }
  try {
    for (const device of ['windows', 'iphone', 'ipad', 'galaxy']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1750 } })
      page.setDefaultTimeout(7000)
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:56452/?app=dashboard&view=products&device=${device}`)
      await page.locator('.d-table tbody tr, .d-mobile-records > button').first().click()
      await page.getByRole('button', { name: 'Editar producto', exact: true }).click()
      const trigger = page.getByRole('button', { name: /Disponibilidad/ })
      const expanded = () => trigger.getAttribute('aria-expanded')
      const waitClosed = () => page.waitForFunction(() => !document.querySelector('[data-trigger="Select"]'))
      const waitOpen = async () => {
        await page.getByRole('listbox').waitFor({ state: 'visible' })
        await page.waitForFunction(() => {
          const popup = document.querySelector('[data-trigger="Select"]')
          return popup && !popup.hasAttribute('data-entering') && !popup.hasAttribute('data-exiting')
        })
      }
      await trigger.evaluate(element => {
        window.selectPointerDowns = 0
        element.addEventListener('pointerdown', () => window.selectPointerDowns++)
      })
      await clickSelectTrigger(page, trigger)
      await waitOpen()
      check(`${device}: primer clic abre sin reintento`, await expanded() === 'true' && await page.evaluate(() => window.selectPointerDowns) === 1)
      check(`${device}: menú dentro del dispositivo`, await page.evaluate(() => {
        const menu = document.querySelector('[data-trigger="Select"]').getBoundingClientRect()
        const app = document.querySelector('.d-app').getBoundingClientRect()
        return menu.left >= app.left - 1 && menu.right <= app.right + 1 && menu.top >= app.top - 1 && menu.bottom <= app.bottom + 1
      }))
      await page.getByRole('option', { name: 'Agotado', exact: true }).click()
      check(`${device}: selección actualiza valor y cierra`, /Agotado/.test(await trigger.innerText()) && await expanded() === 'false')
      await waitClosed()
      await clickSelectTrigger(page, trigger)
      await waitOpen()
      await page.keyboard.press('Escape')
      await waitClosed()
      await page.waitForFunction(id => document.activeElement?.id === id, await trigger.getAttribute('id'))
      check(`${device}: Escape cierra y restaura foco`, await expanded() === 'false' && await trigger.evaluate(element => element === document.activeElement))
      await trigger.press('ArrowDown')
      await waitOpen()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      check(`${device}: teclado selecciona última opción`, /No disponible/.test(await trigger.innerText()) && await expanded() === 'false')
      await waitClosed()
      await clickSelectTrigger(page, trigger)
      await waitOpen()
      const outside = await page.locator('.d-topbar').boundingBox()
      await page.mouse.click(outside.x + outside.width / 2, outside.y + outside.height / 2)
      check(`${device}: clic exterior cierra`, await expanded() === 'false')
      await waitClosed()
      await clickSelectTrigger(page, trigger)
      await waitOpen()
      const rect = await trigger.boundingBox()
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2)
      check(`${device}: segundo clic intencional alterna cierre`, await expanded() === 'false')
      await page.close()
    }
    check('Sin errores de navegador', errors.length === 0)
    await writeFile('shots/select-qa.json', JSON.stringify({ results, errors }, null, 2))
  } finally {
    await browser.close()
  }
}

if (process.argv.includes('--select-qa')) await run()

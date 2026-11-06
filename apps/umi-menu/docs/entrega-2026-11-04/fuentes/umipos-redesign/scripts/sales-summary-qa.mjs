import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { clickSelectTrigger } from './select-qa.mjs'

const browser = await chromium.launch({executablePath: '/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page = await browser.newPage({viewport: {width: 1440, height: 1750}})
const results = [], errors = []
page.setDefaultTimeout(7000)
page.on('pageerror', error => errors.push(error.message))
const check = (name, value) => { assert.ok(value, name); results.push(name); console.log('PASS', name) }
const open = async (device = 'windows', extra = '') => {
  await page.goto(`http://127.0.0.1:56452/?app=dashboard&view=sales&device=${device}${extra}`)
  await page.locator('.d-sales-summary').waitFor()
}
const pick = async (label, value) => {
  await clickSelectTrigger(page, page.getByRole('button', {name: new RegExp(label)}))
  await page.getByRole('option', {name: value, exact: true}).click()
}
const narrative = () => page.getByRole('region', {name: 'Resumen del periodo', exact: true})
const shot = async name => {
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.d-main').evaluate(el => el.scrollTop = 0)
  await page.locator('.study-stage').screenshot({path: `shots/sales-summary-${name}.png`})
}

try {
  await open()
  check('Ventas recupera el resumen narrativo original', await narrative().isVisible())
  for (const [period, total, orders, units, opening] of [
    ['Hoy', '$6,840.00', 48, 91, 'Hoy'],
    ['Ayer', '$13,680.00', 96, 182, 'Ayer'],
    ['7 días', '$47,880.00', 336, 637, 'En los últimos 7 días'],
    ['30 días', '$205,200.00', 1440, 2730, 'En los últimos 30 días'],
  ]) {
    await pick('Periodo del reporte', period)
    const text = await narrative().innerText()
    check(`${period}: resumen corresponde al periodo`, text.includes(opening) && text.includes(total) && text.includes(`${orders.toLocaleString('es-MX')} pedidos`) && text.includes(`${units.toLocaleString('es-MX')} unidades`))
    const sum = await page.locator('.d-table tbody tr').evaluateAll(rows => rows.reduce((sum, row) => sum + Number(row.querySelectorAll('td')[2].textContent.replace(/[^0-9.]/g, '')), 0))
    check(`${period}: texto, indicador y tabla comparten el total`, sum === Number(total.replace(/[^0-9.]/g, '')) && Number((await page.locator('.d-sales-summary strong').first().innerText()).replace(/[^0-9.]/g, '')) === sum)
  }
  await pick('Periodo del reporte', 'Hoy')
  const today = await narrative().innerText()
  await pick('Agrupar ventas por', 'Categoría')
  await page.getByRole('textbox', {name: 'Buscar en ventas', exact: true}).fill('Pan')
  check('Agrupación y búsqueda no cambian el resumen completo del periodo', await narrative().innerText() === today)
  await page.getByRole('button', {name: 'Actualizar', exact: true}).click()
  check('Actualizar conserva el resumen del periodo seleccionado', await narrative().innerText() === today)
  await pick('Sucursal', 'Malecón')
  check('Una sucursal sin datos no hereda el resumen ni los importes de Centro', await narrative().count() === 0 && await page.locator('.d-sales-summary strong').first().innerText() === '$0' && await page.locator('.d-table tbody tr[data-target]').count() === 0)
  await pick('Sucursal', 'Centro')
  check('Volver a Centro recupera su resumen', await narrative().innerText() === today)
  await pick('Negocio', 'Bruma Café')
  await page.locator('[data-target=d-nav-reports]').click()
  await page.locator('[data-target=d-subnav-sales]').click()
  check('Otro negocio no recibe el resumen de ONCA', await narrative().count() === 0 && await page.locator('.d-sales-summary strong').first().innerText() === '$0')

  for (const [device, extra] of [['windows', ''], ['iphone', ''], ['android', ''], ['ipad', ''], ['galaxy', ''], ['galaxy', '&orientation=landscape'], ['iphone', '&theme=dark']]) {
    await open(device, extra)
    await narrative().scrollIntoViewIfNeeded()
    const geometry = await narrative().evaluate(el => {
      const box = el.getBoundingClientRect(), main = el.closest('.d-main').getBoundingClientRect(), text = el.querySelector('p').getBoundingClientRect()
      return {fits: box.left >= main.left - 1 && box.right <= main.right + 1 && text.bottom <= box.bottom, overflow: el.scrollWidth > el.clientWidth + 1, clamped: getComputedStyle(el.querySelector('p')).webkitLineClamp !== 'none'}
    })
    check(`${device}${extra}: resumen completo, legible y sin recortes`, geometry.fits && !geometry.overflow && !geometry.clamped)
    if (['windows', 'iphone'].includes(device) && !extra) await shot(device)
    await pick('Periodo del reporte', 'Ayer')
    check(`${device}${extra}: el control actualiza el texto`, (await narrative().innerText()).includes('Ayer se registraron $13,680.00'))
  }
  check('Sin errores de navegador', errors.length === 0)
  await writeFile('shots/sales-summary-qa.json', JSON.stringify({results, errors}, null, 2))
} catch (error) {
  await page.screenshot({path: 'shots/sales-summary-failure.png', fullPage: true}).catch(() => {})
  await writeFile('shots/sales-summary-qa.json', JSON.stringify({results, errors, failure: String(error)}, null, 2))
  throw error
} finally {
  await browser.close()
}

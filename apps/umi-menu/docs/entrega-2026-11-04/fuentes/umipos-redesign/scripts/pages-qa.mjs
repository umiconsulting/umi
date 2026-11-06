import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { clickSelectTrigger } from './select-qa.mjs'

const base = process.argv[2] || 'https://umi-stageshow.pages.dev'
const browser = await chromium.launch({executablePath: '/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page = await browser.newPage({viewport: {width: 1440, height: 1500}})
page.setDefaultTimeout(15000)
const checks = [], errors = [], missing = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) missing.push({url: response.url(), status: response.status()}) })
const check = (name, result) => { assert.ok(result, name); checks.push(name); console.log('PASS', name) }
const pick = async (label, option) => {
  await clickSelectTrigger(page, page.getByRole('button', {name: new RegExp(label)}))
  await page.getByRole('option', {name: option, exact: true}).click()
}
try {
  await page.goto(`${base}/?screen=sale`)
  await page.locator('.u-app').waitFor()
  check('POS publicado con catálogo', await page.locator('.u-product').count() > 0)
  for (const name of ['Recorrido Menú digital', 'Recorrido Comer aquí', 'Recorrido Para llevar']) {
    await page.getByRole('button', {name, exact: true}).click()
    check(name, await page.locator('.u-app').isVisible())
  }
  await page.goto(`${base}/?app=dashboard&view=sales`)
  await page.getByRole('region', {name: 'Resumen del periodo'}).waitFor()
  check('Resumen de Ventas publicado', (await page.getByRole('region', {name: 'Resumen del periodo'}).innerText()).includes('$6,840.00'))
  await pick('Periodo del reporte', 'Ayer')
  check('Periodo interactivo en Cloudflare', (await page.getByRole('region', {name: 'Resumen del periodo'}).innerText()).includes('$13,680.00'))
  await pick('Dispositivo de vista previa', 'iPhone 17 Pro · iOS')
  check('Vista móvil conserva los datos', await page.locator('.d-app').getAttribute('data-phone') === 'true' && (await page.getByRole('region', {name: 'Resumen del periodo'}).innerText()).includes('$13,680.00'))
  check('Móvil sin desbordamiento', await page.locator('.d-main').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
  await page.goto(`${base}/?app=dashboard&view=login`)
  await page.getByRole('textbox', {name: 'Correo', exact: true}).waitFor()
  check('Acceso y pescado disponibles', await page.locator('.d-auth-image img').evaluate(async image => { await image.decode(); return image.naturalWidth > 0 && image.src.endsWith('/dashboard-login-bg.jpg') }))
  await page.goto(`${base}/?app=dashboard&chapter=products&device=galaxy`)
  await page.getByRole('button', {name: 'Paso siguiente', exact: true}).click()
  check('Recorrido y detalle disponibles', (await page.locator('.d-detail').innerText()).includes('Variantes y opciones'))
  await page.getByRole('button', {name: 'Horizontal', exact: true}).click()
  check('Giro de tablet conserva detalle', (await page.locator('.d-detail').innerText()).includes('Variantes y opciones'))
  await page.getByRole('button', {name: 'Explorar pantalla', exact: true}).click()
  await page.getByRole('button', {name: 'Editar producto', exact: true}).click()
  check('Explorar abre el formulario', await page.getByRole('textbox', {name: /Nombre del producto/}).isVisible())
  await page.screenshot({path: 'shots/cloudflare-pages.png', fullPage: true})
  check('Recursos y navegador sin errores', errors.length === 0 && missing.length === 0)
  await writeFile('shots/cloudflare-pages-qa.json', JSON.stringify({base, checks, errors, missing}, null, 2))
} catch (error) {
  await page.screenshot({path: 'shots/cloudflare-pages-failure.png', fullPage: true}).catch(() => {})
  await writeFile('shots/cloudflare-pages-qa.json', JSON.stringify({base, checks, errors, missing, failure: String(error)}, null, 2))
  throw error
} finally { await browser.close() }

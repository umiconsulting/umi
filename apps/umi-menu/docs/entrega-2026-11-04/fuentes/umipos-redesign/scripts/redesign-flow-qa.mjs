import { configureDirection, qaOutput } from './qa-direction.mjs'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ executablePath: '/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
const results = [], errors = []
await configureDirection(page)
page.on('pageerror', e => errors.push(e.message))
page.on('console', e => { if (e.type() === 'error' || e.text().includes('[stageshow]')) errors.push(e.text()) })
const check = (name, value) => { assert.ok(value, name); results.push(name); console.log('PASS', name) }
const shot = async name => { await page.waitForTimeout(350); await page.locator('.study-stage').screenshot({ path: qaOutput(`${name}.png`) }) }
const login=async (pin='2580')=>{await page.getByLabel('PIN',{exact:true}).fill(pin);await page.getByRole('button',{name:'Ingresar',exact:true}).click()}
const role = async name => {await page.getByRole('button', { name: `Vista de ${name}`, exact: true }).click();await login(name==='Caja'?'2580':name==='Barra'?'3690':'1470')}
try {
  await page.goto('http://127.0.0.1:56452/?screen=kitchen&role=bar')
  check('KDS sin navegación de caja', await page.locator('.u-app .u-rail').count() === 0)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1200 })
    await page.goto('http://127.0.0.1:56452/?screen=incoming')
    await role('Barra')
    check(`${width}: no se envía a KDS antes de confirmar en caja`, await page.locator('.u-active-order').count() === 0)
    check(`${width}: vacío sin acciones de caja`, !(await page.locator('.u-kitchen').innerText()).includes('Volver a la cuenta'))
    await shot(`role-empty-${width}`)
    await role('Caja')
    await page.getByRole('button', { name: 'Pedidos', exact: true }).click()
    await page.getByRole('button', { name: 'Atender en cuenta 043' }).click()
    if (width === 390) await page.locator('.u-mobile-cart').click()
    await page.locator('[data-target=send]').click()
    check(`${width}: envío no inicia preparación`, await page.locator('.u-app').getAttribute('data-kitchen') === 'sent')
    await role('Barra')
    for (const [station, item, excluded] of [['Barra','latte','Concha'],['Cocina','concha','Latte']]) {
      if (station === 'Cocina') await role(station)
      const order = page.locator('.u-active-order')
      check(`${width} ${station}: mismo folio y tipo de servicio`, /043/.test(await order.innerText()) && /Para llevar/.test(await order.innerText()))
      check(`${width} ${station}: solo productos asignados`, !(await order.innerText()).includes(excluded))
      check(`${width} ${station}: sin cobro, importes o cuentas`, !/Cobrar|Cobro|\$|Ver cuenta|Volver a la cuenta|Entregar/.test(await page.locator('.u-kitchen').innerText()) && await page.locator('.u-app .u-rail').count() === 0)
      await shot(`role-${station}-${width}`)
      if (station === 'Barra') {
        await page.getByRole('button', { name: 'Usar tema oscuro' }).click()
        await shot(`role-dark-${width}`)
        await page.getByRole('button', { name: 'Usar tema claro' }).click()
      }
      await page.locator('[data-target=kitchen-receive]').click()
      await page.locator('[data-target=kitchen-start]').click()
      check(`${width} ${station}: exige terminar productos`, await page.locator('[data-target=kitchen-ready]').isDisabled())
      await page.locator(`[data-target=ready-${item}]`).click()
      await page.locator('[data-target=kitchen-ready]').click()
      check(`${width} ${station}: no ofrece cobrar ni entregar al terminar`, await page.locator('[data-target=kitchen-pay],[data-target=kitchen-deliver]').count() === 0)
      await shot(`role-${station}-ready-${width}`)
      if (station === 'Barra') {
        await role('Caja')
        if (width === 390) await page.locator('.u-mobile-cart').click()
        check(`${width}: barra lista no completa la cocina`, await page.locator('.u-app').getAttribute('data-kitchen') === 'preparing')
        check(`${width}: caja no entrega un pedido incompleto`, await page.locator('[data-target=deliver]').count() === 0)
      }
    }
    await role('Caja')
    if (width === 390) await page.locator('.u-mobile-cart').click()
    check(`${width}: ambas estaciones listas habilitan entrega en caja`, await page.locator('[data-target=deliver]').isVisible())
    await shot(`role-cashier-ready-${width}`)
    await page.locator('[data-target=deliver]').click()
    await page.locator('[data-target=pay]').click()
    check(`${width}: cobro conserva cuenta y total`, (await page.locator('.u-payment-left').innerText()).includes('043') && await page.locator('.u-payment-left .ss-count').getAttribute('aria-label') === '$135.00')
    await page.locator('[data-target=cash-200]').click()
    await page.locator('[data-target=confirm]').click()
    check(`${width}: entregada y cobrada`, (await page.locator('.u-done-state').innerText()).includes('Pedido entregado') && (await page.locator('.u-done-change').innerText()).includes('$65.00'))
    await page.getByRole('button', { name: 'Imprimir ticket', exact: true }).click()
    await shot(`flow-complete-${width}`)
    await page.getByRole('button', { name: 'Venta', exact: true }).last().click()
    if (width === 390) await page.locator('.u-mobile-cart').click()
    check(`${width}: no permite cobrar dos veces`, await page.locator('[data-target=pay]').isDisabled())
  }
  await page.goto('http://127.0.0.1:56452/')
  await login()
  await page.locator('.u-mobile-cart').click()
  await page.locator('[data-target=send]').click()
  await page.locator('[data-target=pay]').click()
  await page.locator('[data-target=cash-200]').click()
  await page.locator('[data-target=confirm]').click()
  check('Cobrar antes no termina la preparación', (await page.locator('.u-done-state').innerText()).includes('Esperando recepción'))
  await page.goto('http://127.0.0.1:56452/?play=1')
  await page.locator('.ss-stage[data-mark=barra]').waitFor({timeout:22000})
  check('Animación móvil: barra solo recibe sus productos', await page.locator('.u-app').getAttribute('data-role') === 'bar' && !(await page.locator('.u-active-order').innerText()).includes('Concha'))
  await page.locator('.ss-stage[data-mark=cocina]').waitFor({timeout:22000})
  check('Animación móvil: cambia al usuario de cocina', await page.locator('.u-app').getAttribute('data-role') === 'kitchen' && !(await page.locator('.u-active-order').innerText()).includes('Latte'))
  await page.locator('.ss-stage[data-mark=comprobante]').waitFor({timeout:30000})
  check('Animación móvil: caja termina cobro y ticket', await page.locator('.u-app').getAttribute('data-role') === 'cashier' && await page.getByRole('button', {name:'Ticket listo'}).isVisible())
  await page.getByRole('button', {name:'Explorar', exact:true}).click()
  check('Explorar conserva el resultado del recorrido', await page.locator('.u-done-title').isVisible())
  check('Sin errores de navegador', errors.length === 0)
  await writeFile(qaOutput('flow-qa.json'), JSON.stringify({ results, errors, browser: await browser.version() }, null, 2))
} catch (e) { await page.screenshot({ path: qaOutput('flow-qa-failure.png'), fullPage: true }); throw e }
finally { await browser.close() }

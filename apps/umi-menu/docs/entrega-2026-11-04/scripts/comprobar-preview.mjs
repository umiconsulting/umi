// Comprueba la carga del paquete y un pedido simulado. No valida la integración real.
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({ options: {
  base: {type:'string', default:'http://127.0.0.1:56454'},
  browser: {type:'string'},
  'deps-root': {type:'string', default:resolve(root,'fuentes/umipos-redesign')},
  out: {type:'string', default:resolve(root,'evidencia/comprobacion-local')},
}})
const { chromium } = await import(pathToFileURL(resolve(values['deps-root'],'node_modules/playwright-core/index.mjs')).href)
const browser = await chromium.launch(values.browser ? {executablePath:values.browser} : {})
const page = await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'})
page.setDefaultTimeout(15000)
const report = {date:new Date().toISOString(),base:values.base,checks:[],errors:[],missing:[]}
page.on('pageerror', e=>report.errors.push(e.message))
page.on('response', r=>{if(r.url().startsWith(values.base)&&r.status()>=400)report.missing.push({url:r.url(),status:r.status()})})
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('OK',name)}
await mkdir(values.out,{recursive:true})
async function capture(name){await page.screenshot({path:resolve(values.out,name+'.png'),fullPage:true})}
try {
  await page.goto(values.base+'/?app=menu',{waitUntil:'networkidle'})
  const menu=page.frameLocator('iframe[title="Menú digital interactivo"]')
  await menu.locator('.menu-product').first().waitFor()
  check('Menú integrado carga desde la copia entregada',await menu.locator('.menu-product').count()===4)
  await capture('visor-escritorio')
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===390?844:1100})
    await page.goto(values.base+'/menu-digital/menu.html',{waitUntil:'networkidle'})
    await page.locator('.menu-product').first().waitFor()
    check('Fotos cargadas '+width,await page.locator('.menu-product img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)))
    check('Sin desbordamiento horizontal '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await capture('menu-'+width)
    await page.locator('[data-product=toast]').click()
    await page.locator('#add-to-cart').click()
    await page.locator('[data-product=latte]').click()
    await page.locator('#add-to-cart').click()
    check('Total simulado de 210 '+width,await page.locator('#mobile-total').textContent()==='$210')
    if(width===390)await page.locator('#mobile-cart-button').click()
    await page.locator(width===390?'#cart-dialog [data-checkout]':'#cart-content [data-checkout]').click()
    await page.locator('#checkout-dialog[open]').waitFor()
    await page.locator('#customer-name').fill('Ana de ejemplo')
    await page.locator('#customer-phone').fill('6690000000')
    report.emailFieldPresent=await page.locator('#checkout-dialog input[type=email]').count()>0
    await capture('confirmacion-'+width)
    await page.locator('#confirm-order').click()
    await page.locator('#status-dialog[open]').waitFor()
    check('Pedido simulado pendiente '+width,(await page.locator('#status-dialog-title').textContent())==='Pedido recibido')
  }
  await page.setViewportSize({width:1440,height:1100})
  for(const chapter of ['config','kitchen']){
    await page.goto(values.base+'/?app=menu&menuView=tour&menuChapter='+chapter,{waitUntil:'networkidle'})
    const scene=page.frameLocator('iframe[title="Recorrido del menú digital"]')
    await scene.frameLocator('iframe[title="Redesign de Umi para el personal"]').locator('[data-redesign]').waitFor()
    check('Escena del personal carga '+chapter,true)
    await capture('recorrido-'+chapter)
  }
  check('Sin errores de página',report.errors.length===0)
  check('Sin recursos locales faltantes',report.missing.length===0)
} catch(error) {
  report.failure=String(error)
  process.exitCode=1
  await capture('fallo').catch(()=>{})
} finally {
  await writeFile(resolve(values.out,'resultado.json'),JSON.stringify(report,null,2)+'\n')
  await browser.close()
  console.log(JSON.stringify(report))
}

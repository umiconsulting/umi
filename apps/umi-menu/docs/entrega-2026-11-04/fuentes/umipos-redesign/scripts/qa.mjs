import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const browser = await chromium.launch({ executablePath: '/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' })
const base = 'http://127.0.0.1:56451/'
const errors = [], results = [], external = []
const page = await browser.newPage({ viewport: { width: 1440, height: 1250 } })
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error' || message.text().includes('[stageshow]')) errors.push(message.text()) })
page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url()) })
const check = (name, value) => { assert.ok(value, name); results.push(name); console.log('PASS', name) }
const notificationFits = async root => root.evaluate(el => {
  const notice=el.querySelector('.pos-order-notice').getBoundingClientRect()
  const header=el.querySelector('.pos-header').getBoundingClientRect()
  const panel=el.querySelector('.pos-modifier-panel').getBoundingClientRect()
  return notice.top>=header.top && notice.bottom<=header.bottom && notice.right<=header.right && notice.bottom<panel.top
})
try {
  for (const width of [1440,390]) {
    await page.setViewportSize({ width, height: 1300 })
    for (const chapter of ['incoming','products','kitchen','payment','receipt']) {
      await page.goto(base+`?capture=umipos&chapter=${chapter}&still=1`)
      await page.locator('.ss-stage').waitFor()
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(400)
      const visible = page.locator('.pos-screen[data-active=true]')
      check(`${width} ${chapter} pantalla visible`, await visible.isVisible())
      check(`${width} ${chapter} sin desbordamiento de página`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      const fits = await visible.evaluate(root => {
        const stage = document.querySelector('.ss-stage').getBoundingClientRect()
        return [...root.querySelectorAll('[data-target]')].filter(el => {
          const cs = getComputedStyle(el)
          return cs.visibility !== 'hidden' && el.getBoundingClientRect().width > 0 && (el.closest('[data-open]')?.getAttribute('data-open') !== 'false')
        }).map(el => ({target:el.getAttribute('data-target'), rect:el.getBoundingClientRect()})).filter(({rect:r}) => r.left < stage.left - 1 || r.top < stage.top - 1 || r.right > stage.right + 1 || r.bottom > stage.bottom + 1).map(x=>x.target)
      })
      check(`${width} ${chapter} acciones dentro de escena: ${fits.join(', ')}`, fits.length===0)
      if(chapter==='receipt') {
        check(`${width} ticket y borde completos`,await page.locator('.pos-ticket').evaluate(el=>el.getBoundingClientRect().bottom+10<=document.querySelector('.ss-stage').getBoundingClientRect().bottom))
      }
      if(chapter==='payment') {
        check(`${width} confirmación sin superposición`,await page.locator('.pos-review-note').evaluate(el=>{
          const note=el.getBoundingClientRect(),button=document.querySelector('[data-target=confirm]').getBoundingClientRect()
          return note.bottom<=button.top || note.right<=button.left || note.left>=button.right
        }))
      }
      await page.screenshot({ path: `shots/${chapter}-${width}.png`, fullPage:true })
    }
    await page.goto(base+'?chapter=products')
    await page.locator('.transport-play:not(:disabled)').waitFor()
    await page.getByRole('checkbox',{name:'Sin animación'}).check()
    await page.frameLocator('iframe').locator('.ss-stage[data-still]').waitFor()
    await page.waitForTimeout(400)
    await page.screenshot({path:`shots/viewer-${width}.png`,fullPage:true})
    check(`${width} visor sin desbordamiento`, await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  }
  if (!process.argv.includes('--stills')) {
    await page.setViewportSize({width:1440,height:1250})
    await page.goto(base+'?origin=counter')
    await page.locator('.transport-play:not(:disabled)').waitFor()
    await page.waitForTimeout(1000)
    await page.getByRole('button',{name:'Pausar',exact:true}).click()
    await page.waitForTimeout(200)
    const paused=await page.locator('output').innerText()
    await page.waitForTimeout(600)
    check('Pausa conserva el tiempo', paused===await page.locator('output').innerText())
    await page.getByRole('button',{name:'Reproducir',exact:true}).click()
    await page.getByRole('combobox',{name:'Velocidad de reproducción'}).selectOption('2')
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=antes-del-aviso]').waitFor({timeout:12000})
    const beforeNotice=await page.frameLocator('iframe').locator('.pos-modifier-panel').boundingBox()
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=aviso-sin-interrumpir]').waitFor({timeout:5000})
    const afterNotice=await page.frameLocator('iframe').locator('.pos-modifier-panel').boundingBox()
    check('Aviso no mueve el selector abierto',Math.abs(beforeNotice.y-afterNotice.y)<1&&Math.abs(beforeNotice.x-afterNotice.x)<1)
    check('Aviso preserva presentación y producto sin agregar',await page.frameLocator('iframe').locator('[data-target=variant-nube][data-selected=true]').count()===1&&await page.frameLocator('iframe').locator('.pos-modifiers[data-open=true]').count()===1&&await page.frameLocator('iframe').locator('[data-target=product-latte][data-chosen=false]').count()===1)
    check('Aviso cabe en cabecera sin tapar modificadores',await notificationFits(page.frameLocator('iframe').locator('.pos-screen[data-active=true]')))
    await page.screenshot({path:'shots/notification-wide.png',fullPage:true})
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=latte-personalizado]').waitFor({timeout:12000})
    check('Latte seleccionado desde tarjeta de catálogo',await page.frameLocator('iframe').locator('.pos-frequent').count()===0)
    check('Opciones elegidas antes de agregar',await page.frameLocator('iframe').locator('[data-target=milk-skim][data-selected=true]').count()===1)
    await page.frameLocator('iframe').locator('.pos-modifier-panel').screenshot({path:'shots/modifiers-wide.png'})
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=latte-agregado]').waitFor({timeout:6000})
    check('Agregar después del aviso conserva leche y precio',(await page.frameLocator('iframe').locator('.pos-cart').innerText()).includes('Leche deslactosada')&&(await page.frameLocator('iframe').locator('.pos-cart').innerText()).includes('$90.00'))
    check('Pedido pendiente sigue separado de la comanda',await page.frameLocator('iframe').locator('.pos-screen[data-active=true] .pos-order-notice[data-pending="1"]').isVisible())
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=fin]').waitFor({timeout:35000})
    const completed=page.frameLocator('iframe').locator('.pos-screen[data-active=true]')
    check('Recorrido completo llega al ticket', (await completed.innerText()).includes('Ticket impreso'))
    check('Resultado mantiene total y cambio', (await completed.innerText()).includes('$135.00') && (await completed.innerText()).includes('$65.00'))
    check('Guion termina',await page.frameLocator('iframe').locator('.ss-stage').getAttribute('data-mark')==='fin')
    await page.screenshot({path:'shots/finished-wide.png',fullPage:true})
    await page.getByRole('button',{name:'Repetir recorrido'}).click()
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=products]').waitFor()
    check('Repetir vuelve al primer paso',await page.frameLocator('iframe').locator('.pos-surfaces').getAttribute('data-phase')==='products')
    for(const [id,label] of [['kitchen','Comanda'],['payment','Cobro'],['receipt','Ticket'],['products','Productos']]){
      await page.getByRole('navigation',{name:'Pasos de la venta'}).getByRole('button',{name:new RegExp(label)}).click()
      await page.frameLocator('iframe').locator(`.pos-surfaces[data-phase=${id}]`).waitFor()
      check(`Acceso directo ${id}`,new URL(page.url()).searchParams.get('chapter')===id)
    }
    await page.getByRole('button',{name:'Vista de detalle'}).click()
    await page.frameLocator('iframe').locator('.ss-stage[data-layout=compact]').waitFor()
    check('Vista de detalle cambia composición',await page.frameLocator('iframe').locator('.pos-screen[data-active=true] .pos-sidebar').isHidden())
    await page.getByRole('button',{name:'Vista amplia'}).click()
    await page.frameLocator('iframe').locator('.ss-stage[data-layout=wide]').waitFor()
    check('Vista amplia restaura composición',await page.frameLocator('iframe').locator('.pos-screen[data-active=true] .pos-sidebar').isVisible())
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.goto(base+'?origin=counter')
    await page.frameLocator('iframe').locator('.ss-stage[data-still]').waitFor()
    check('Movimiento reducido muestra resultado completo',await page.frameLocator('iframe').locator('.pos-surfaces').getAttribute('data-phase')==='receipt')
    await page.emulateMedia({reducedMotion:'no-preference'})
    await page.setViewportSize({width:390,height:1250})
    await page.goto(base+'?capture=umipos&origin=counter')
    await page.locator('.ss-stage[data-mark=fin]').waitFor({timeout:55000})
    check('Recorrido compacto completo llega al ticket',await page.locator('.pos-screen[data-active=true] [data-target=print]').innerText()==='Ticket impreso')
    await page.screenshot({path:'shots/finished-mobile.png',fullPage:true})
    await page.goto(base+'?capture=umipos&origin=counter&chapter=products')
    await page.locator('.ss-stage[data-mark=aviso-sin-interrumpir]').waitFor({timeout:15000})
    check('Aviso compacto no cubre modificadores',await notificationFits(page.locator('.pos-screen[data-active=true]')))
    await page.screenshot({path:'shots/notification-mobile.png',fullPage:true})
    await page.locator('.ss-stage[data-mark=latte-personalizado]').waitFor({timeout:15000})
    await page.screenshot({path:'shots/modifiers-mobile.png',fullPage:true})
    const modifierBox=await page.locator('.pos-modifier-panel').boundingBox()
    check('Modificadores completos en compacto',modifierBox.y>=0&&modifierBox.x>=0&&modifierBox.x+modifierBox.width<=390&&modifierBox.y+modifierBox.height<=720)
    await page.goto(base+'?origin=menu')
    await page.locator('.transport-play:not(:disabled)').waitFor()
    check('Menú empieza en recepción',await page.frameLocator('iframe').locator('.pos-surfaces').getAttribute('data-phase')==='incoming')
    await page.getByRole('combobox',{name:'Velocidad de reproducción'}).selectOption('2')
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=pedido-recibido]').waitFor({timeout:8000})
    check('Aviso de nuevo pedido visible',await page.frameLocator('iframe').locator('.incoming-notification[data-visible=true]').isVisible())
    await page.screenshot({path:'shots/incoming-arrival-mobile.png',fullPage:true})
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=revisar-pedido]').waitFor({timeout:10000})
    check('Recepción conserva los modificadores', (await page.frameLocator('iframe').locator('.incoming-detail').innerText()).includes('Leche deslactosada'))
    await page.screenshot({path:'shots/incoming-review-mobile.png',fullPage:true})
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=kitchen]').waitFor({timeout:10000})
    check('Pedido aceptado se conserva en la comanda',(await page.frameLocator('iframe').locator('.pos-cart .pos-total strong').textContent()).trim()==='$135.00')
    check('No se vuelven a agregar productos del pedido recibido',await page.frameLocator('iframe').locator('.pos-surfaces').getAttribute('data-origin')==='menu'&&(await page.frameLocator('iframe').locator('.pos-order-lines').innerText()).includes('Leche deslactosada'))
    await page.frameLocator('iframe').locator('.ss-stage[data-mark=fin]').waitFor({timeout:25000})
    check('Pedido recibido termina con ticket correcto',(await page.frameLocator('iframe').locator('.pos-ticket').innerText()).includes('$65.00'))
    await page.screenshot({path:'shots/finished-incoming-mobile.png',fullPage:true})
  }
  check('Sin errores del navegador o del guion',errors.length===0)
  check('Recursos y datos solo locales',external.length===0)
  await writeFile('shots/qa.json',JSON.stringify({passed:results.length,results,errors,external,browser:browser.version()},null,2))
} catch(error) {
  await page.screenshot({path:'shots/qa-failure.png',fullPage:true})
  await writeFile('shots/qa-failure.json',JSON.stringify({results,errors,external,error:String(error)},null,2))
  throw error
} finally {await browser.close()}

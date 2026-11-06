import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
if(process.argv.includes('--sales-summary')){await import('./sales-summary-qa.mjs');process.exit(0)}
if(process.argv.includes('--dashboard-tour')){await import('./dashboard-tour-qa.mjs');process.exit(0)}
if(process.argv.includes('--dashboard-regression')){await import('./dashboard-regression-qa.mjs');process.exit(0)}
if(process.argv.includes('--select-qa')){await import('./select-qa.mjs');process.exit(0)}
if(process.argv.includes('--floor-editor')){await import('./floor-editor-qa.mjs');process.exit(0)}
if(process.argv.includes('--interface')){await import('./interface-qa.mjs');process.exit(0)}
if(process.argv.includes('--dashboard-auth')){await import('./dashboard-auth-qa.mjs');process.exit(0)}
if(process.argv.includes('--dashboard-mobile')){await import('./dashboard-mobile-qa.mjs');process.exit(0)}
if(process.argv.includes('--dashboard')){await import('./dashboard-qa.mjs');process.exit(0)}
if(process.argv.includes('--tablet-audit')){await import('./tablet-qa.mjs');process.exit(0)}
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1900}}),results=[],errors=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('console',e=>{if(e.type()==='error')errors.push(e.text())})
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const button=name=>page.getByRole('button',{name,exact:true})
const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);await page.locator('.study-stage').screenshot({path:`shots/${name}.png`})}
try {
 await page.goto('http://127.0.0.1:56452/?screen=sale')
 for(const [device,label,width,height] of [['windows','PC · Windows',1280,780],['mac','Mac · macOS',1280,780],['iphone','iPhone 17 Pro · iOS',402,874],['android','Pixel 8 · Android',412,915],['ipad','iPad Air 11″ · iPadOS',820,1180],['galaxy','Galaxy Tab A11 · Android',800,1340]]){
  await page.getByRole('button',{name:/Dispositivo de vista previa/}).click()
  await page.getByRole('option',{name:label,exact:true}).click()
  const tablet=['ipad','galaxy'].includes(device),phone=['iphone','android'].includes(device)
  if(tablet)await button('Vertical').click()
  check(`${device}: selección conserva artículos`,await page.locator('.u-product[data-in-order=true]').count()===2)
  check(`${device}: formato identifica dimensiones`,(await page.locator('.study-device-caption').innerText()).includes(`${width} × ${height}`))
  if(phone||tablet){
   check(`${device}: pantalla mantiene la proporción`,await page.locator('.ss-phone__screen').evaluate((el,size)=>el.style.width===`${size[0]}px`&&el.style.height===`${size[1]}px`,[width,height]))
   const app=await page.locator('.u-app').boundingBox(),status=await page.locator('.ss-phone__status').boundingBox(),home=await page.locator('.ss-phone__home').boundingBox()
   check(`${device}: respeta zonas seguras`,app.y>=status.y+status.height-1&&app.y+app.height<=home.y)
  }else check(`${device}: controles de ventana correctos`,await page.locator(device==='mac'?'.ss-window__lights':'.ss-window__windows-controls').isVisible())
  check(`${device}: catálogo sin desbordamiento horizontal`,await page.locator('.u-products').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  await shot(`device-${device}-portrait`)
  if(tablet){
   await button('Horizontal').click()
   check(`${device}: giro intercambia dimensiones`,(await page.locator('.study-device-caption').innerText()).includes(`${height} × ${width}`))
   check(`${device}: giro conserva el pedido`,await page.locator('.u-product[data-in-order=true]').count()===2)
   await shot(`device-${device}-landscape`)
   await button('Caja').click()
   await button('Iniciar conteo ciego').click()
   await page.getByLabel('Billetes de $500',{exact:true}).fill('2')
   await button('Vertical').click()
   check(`${device}: rotar conserva conteo en curso`,(await page.locator('.u-count-total').innerText()).includes('1,000.00'))
   check(`${device}: denominaciones no desbordan`,await page.locator('.u-count-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
   await shot(`device-${device}-count`)
   await button('Venta').click()
   const before=await page.locator('.u-ticket').boundingBox()
   await page.locator('[data-target=pay]').click()
   const after=await page.locator('.u-payment-left').boundingBox()
   check(`${device}: cuenta mantiene posición al cobrar en vertical`,Math.abs(before.x-after.x)<2)
   await shot(`device-${device}-payment`)
   await button('Venta').click()
  }
 }
 await page.getByRole('button',{name:/Dispositivo de vista previa/}).click()
 await page.getByRole('option',{name:'iPhone 17 Pro · iOS',exact:true}).click()
 await page.locator('.u-mobile-cart').click()
 await shot('device-iphone-account')
 await page.locator('[data-target=pay]').click()
 const pay=await page.locator('[data-target=confirm]').boundingBox(),rail=await page.locator('.u-rail').boundingBox()
 check('iPhone: cobro completo sobre la navegación',pay.y+pay.height<=rail.y)
 await shot('device-iphone-payment')
 await button('Usar tema oscuro').click()
 await button('Caja').click()
 await page.getByRole('tab',{name:'Cierre',exact:true}).click()
 await button('Iniciar conteo ciego').click()
 await shot('device-iphone-count-dark')
 check('Sin errores de navegador',errors.length===0)
 await writeFile('shots/device-qa.json',JSON.stringify({results,errors},null,2))
} catch(error) {await page.screenshot({path:'shots/device-failure.png',fullPage:true}).catch(()=>{});throw error} finally {await browser.close()}

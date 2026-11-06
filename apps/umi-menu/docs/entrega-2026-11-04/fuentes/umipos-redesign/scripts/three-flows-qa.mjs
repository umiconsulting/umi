import { configureDirection, qaOutput } from './qa-direction.mjs'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1200}}), results=[], errors=[]
await configureDirection(page)
page.on('pageerror',e=>errors.push(e.message))
page.on('console',e=>{if(e.type()==='error'||e.text().includes('[stageshow]'))errors.push(e.text())})
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const login=async (pin='2580')=>{await page.getByLabel('PIN',{exact:true}).fill(pin);await page.getByRole('button',{name:'Ingresar',exact:true}).click()}
const flows=[{id:'digital',name:'Menú digital',account:'043',service:'takeaway',identity:'Lucía Hernández'},{id:'here',name:'Comer aquí',account:'042',service:'here',identity:'Mesa 03'},{id:'takeaway',name:'Para llevar',account:'044',service:'takeaway',identity:'Mostrador'}]
try{
 await page.goto('http://127.0.0.1:56452/')
 check('Tres recorridos disponibles',await page.getByRole('button',{name:/^Recorrido /}).count()===3)
 await page.getByRole('button',{name:'Recorrido Comer aquí',exact:true}).click()
 await login()
 await page.locator('.u-service-options').getByRole('button',{name:'Para llevar',exact:true}).click()
 check('Cambiar el servicio conserva el folio', (await page.locator('.u-account-head').innerText()).includes('042'))
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1200})
  for(const flow of flows){
   await page.getByRole('button',{name:`Recorrido ${flow.name}`,exact:true}).click()
   await login()
   if(flow.id==='digital')await page.locator('[data-target=accept-order]').click()
   if(width===390)await page.locator('.u-mobile-cart').click()
   check(`${width} ${flow.id}: identidad y servicio de origen`,(await page.locator('.u-account-head').innerText()).includes(flow.account)&&(await page.locator('.u-account-head').innerText()).includes(flow.identity)&&await page.locator(`.u-service-tag[data-service=${flow.service}]`).count()>0)
   await page.locator('[data-target=send]').click()
   for(const [role,item] of [['Barra','latte'],['Cocina','concha']]){
    await page.getByRole('button',{name:`Vista de ${role}`,exact:true}).click()
    await login(role==='Barra'?'3690':'1470')
    check(`${width} ${flow.id} ${role}: conserva folio y servicio`,(await page.locator('.u-active-order').innerText()).includes(flow.account)&&await page.locator(`.u-active-order .u-service-tag[data-service=${flow.service}]`).count()===1)
    await page.locator('[data-target=kitchen-receive]').click()
    await page.locator('[data-target=kitchen-start]').click()
    await page.locator(`[data-target=ready-${item}]`).click()
    await page.locator('[data-target=kitchen-ready]').click()
   }
   await page.getByRole('button',{name:'Vista de Caja',exact:true}).click()
   await login()
   if(width===390)await page.locator('.u-mobile-cart').click()
   await page.locator('[data-target=deliver]').click()
   await page.locator('[data-target=pay]').click()
   await page.locator('[data-target=cash-200]').click()
   await page.locator('[data-target=confirm]').click()
   check(`${width} ${flow.id}: resultado correcto`,(await page.locator('.u-done-state').innerText()).includes('Pedido entregado')&&(await page.locator('.u-done-change').innerText()).includes('$65.00'))
   await page.locator('.study-stage').screenshot({path:qaOutput(`${flow.id}-complete-${width}.png`)})
  }
 }
 for(const [flow,width] of [['here',1440],['takeaway',390]]){
  await page.setViewportSize({width,height:1200})
  await page.goto(`http://127.0.0.1:56452/?play=1&flow=${flow}`)
  await page.locator('.ss-stage[data-mark=comprobante]').waitFor({timeout:65000})
  check(`${width} ${flow}: recorrido animado completo`,(await page.locator('.u-done-change').innerText()).includes('$65.00')&&await page.getByRole('button',{name:'Ticket listo'}).isVisible())
 }
 check('Sin errores de navegador',errors.length===0)
 await writeFile(qaOutput('three-flows-qa.json'),JSON.stringify({results,errors,browser:await browser.version()},null,2))
}finally{await browser.close()}

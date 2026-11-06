import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { clickSelectTrigger } from './select-qa.mjs'

const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1600}})
const results=[],errors=[],warnings=[]
const check=(name,ok)=>{assert.ok(ok,name);results.push(name);console.log('PASS',name)}
page.on('pageerror',e=>errors.push(e.message))
page.on('console',e=>{if(e.type()==='error')errors.push(e.text());if(e.text().includes('[stageshow]'))warnings.push(e.text())})
await page.addInitScript(()=>{
 window.__stageshow={slow:.06}
 window.tourPressIssues=[]
 new MutationObserver(records=>{
  for(const record of records){
   const el=record.target
   if(record.attributeName!=='data-pressed'||!el.matches('[data-target][data-pressed]'))continue
   const stage=el.closest('.ss-stage'),r=el.getBoundingClientRect(),frame=stage?.getBoundingClientRect()
   if(frame&&(r.left<frame.left-2||r.top<frame.top-2||r.right>frame.right+2||r.bottom>frame.bottom+2))window.tourPressIssues.push({target:el.dataset.target,issue:'fuera del marco'})
   for(let parent=el.parentElement;parent&&parent!==stage;parent=parent.parentElement){
    const css=getComputedStyle(parent)
    if(!['auto','scroll','hidden'].includes(css.overflowY))continue
    const p=parent.getBoundingClientRect()
    if(r.top<p.top-2||r.bottom>p.bottom+2){window.tourPressIssues.push({target:el.dataset.target,issue:'fuera de región visible',parent:parent.className});break}
   }
  }
 }).observe(document,{attributes:true,subtree:true,attributeFilter:['data-pressed']})
})
try {
 await page.goto('http://127.0.0.1:56452/?app=dashboard')
 await page.getByRole('button',{name:'Ver recorrido completo',exact:true}).waitFor({timeout:4000})
 await page.getByRole('button',{name:'Ver recorrido completo',exact:true}).click()
 assert.equal(await page.locator('.d-auth').getAttribute('data-auth-screen'),'login')
 await page.getByRole('button',{name:'Pausar recorrido',exact:true}).click()
 const before=await page.locator('[data-tour-step]').getAttribute('data-tour-step')
 await page.waitForTimeout(1800)
 assert.equal(await page.locator('[data-tour-step]').getAttribute('data-tour-step'),before)
 check('Inicio y pausa del recorrido',true)
 const chapter=async label=>{await clickSelectTrigger(page,page.getByRole('button',{name:/Capítulo del recorrido/}));await page.getByRole('option',{name:new RegExp(label+'$')}).click()}
 await chapter('Productos')
 check('Saltar a productos queda pausado',await page.locator('.d-app').getAttribute('data-view')==='products'&&await page.locator('.dashboard-show').getAttribute('data-tour-playing')==='false')
 await page.getByRole('button',{name:'Paso siguiente',exact:true}).click()
 check('Siguiente muestra detalle del producto',(await page.locator('.d-detail').innerText()).includes('Variantes y opciones'))
 await page.getByRole('button',{name:'Explorar pantalla',exact:true}).click()
 check('Explorar conserva detalle',(await page.locator('.d-detail').innerText()).includes('Variantes y opciones'))
 await page.getByRole('button',{name:'Editar producto',exact:true}).click()
 check('Explorar permite editar',await page.getByRole('textbox',{name:/Nombre del producto/}).isVisible())
 await page.goto('http://127.0.0.1:56452/?app=dashboard&chapter=products&device=ipad')
 await page.getByRole('button',{name:'Paso siguiente',exact:true}).click()
 await page.getByRole('button',{name:'Paso siguiente',exact:true}).click()
 const editingStep=await page.locator('[data-tour-step]').getAttribute('data-tour-step')
 await page.getByRole('button',{name:'Horizontal',exact:true}).click()
 await page.waitForTimeout(250)
 check('Girar tablet conserva el paso de edición',await page.locator('[data-tour-step]').getAttribute('data-tour-step')===editingStep&&await page.getByRole('textbox',{name:/Nombre del producto/}).isVisible())
 await page.getByRole('button',{name:'Paso siguiente',exact:true}).click()
 const reviewStep=await page.locator('[data-tour-step]').getAttribute('data-tour-step')
 await page.getByRole('button',{name:'Vertical',exact:true}).click()
 await page.waitForTimeout(250)
 check('Girar tablet conserva la revisión',await page.locator('[data-tour-step]').getAttribute('data-tour-step')===reviewStep&&await page.getByRole('button',{name:'Confirmar en la demo',exact:true}).isVisible())
 await page.getByRole('button',{name:'Paso anterior',exact:true}).click()
 await page.getByRole('button',{name:'Explorar pantalla',exact:true}).click()
 await page.getByRole('textbox',{name:/Nombre del producto/}).fill('Latte sin guardar')
 await page.getByRole('button',{name:'Horizontal',exact:true}).click()
 await page.waitForTimeout(250)
 check('Explorar y girar conserva el formulario sin guardar',await page.getByRole('textbox',{name:/Nombre del producto/}).inputValue()==='Latte sin guardar')
 await page.goto('http://127.0.0.1:56452/?app=dashboard&chapter=access&device=ipad')
 await page.getByRole('button',{name:'Paso siguiente',exact:true}).click()
 await page.getByRole('button',{name:'Horizontal',exact:true}).click()
 await page.waitForTimeout(250)
 check('Girar tablet conserva el segundo factor',await page.locator('.d-auth').getAttribute('data-auth-screen')==='mfa'&&await page.getByRole('textbox',{name:/Código de seis/}).isVisible())
 for(const [device,extra,width,height] of [['windows','&access=platform',1440,1600],['iphone','',390,1600]]){
  await page.setViewportSize({width,height})
  await page.goto('http://127.0.0.1:56452/?app=dashboard&play&device='+device+extra)
  const visited=[]
  let last=-1
  const deadline=Date.now()+140000
  while(true){
   await page.waitForTimeout(80)
   const state=await page.evaluate(()=>({i:Number(document.querySelector('.dashboard-show')?.dataset.tourStep),done:document.querySelector('.dashboard-show')?.dataset.tourComplete==='true',view:document.querySelector('.d-app')?.dataset.view,title:document.querySelector('.dashboard-tour-caption strong')?.textContent}))
   if(state.i!==last){visited.push(state);last=state.i}
   if(state.done)break
   if(errors.length||warnings.length)throw new Error(JSON.stringify({errors,warnings}))
   if(Date.now()>deadline)throw new Error('Timeout del recorrido '+device+' en '+JSON.stringify(state))
   if(visited.length>100)throw new Error('Recorrido no termina')
  }
  const expected=await page.evaluate(async platform=>{const m=await import('/src/dashboard/data.ts');return m.modules.filter(x=>platform||!x.platform).flatMap(x=>x.views.map(v=>v.id))},!!extra)
  check(device+': todas las vistas recorridas',expected.every(id=>visited.some(v=>v.view===id)))
  check(device+': cursor sólo presiona elementos visibles',await page.evaluate(()=>window.tourPressIssues.length===0).then(ok=>{if(!ok)page.evaluate(()=>window.tourPressIssues).then(console.log);return ok}))
  check(device+': llega al perfil',await page.locator('.d-app').getAttribute('data-view')==='profile')
  check(device+': sin desbordamiento del visor',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.locator('.dashboard-show').screenshot({path:'shots/dashboard-tour-'+device+'-end.png'})
  await writeFile('shots/dashboard-tour-'+device+'-coverage.json',JSON.stringify(visited,null,2))
  await page.getByRole('button',{name:'Repetir recorrido',exact:true}).click()
  await page.getByRole('button',{name:'Pausar recorrido',exact:true}).click()
  check(device+': repetir vuelve al acceso',await page.locator('.d-auth').isVisible())
  await chapter('Plano de mesas')
  await page.getByRole('button',{name:'Paso siguiente',exact:true}).click()
  check(device+': edición de plano visible',(await page.locator('[data-target=d-floor-edit]').innerText())==='Terminar edición')
  await page.waitForTimeout(250)
  await page.locator('.dashboard-show').screenshot({path:'shots/dashboard-tour-'+device+'-floor.png'})
 }
 await page.setViewportSize({width:1440,height:1800})
 await page.goto('http://127.0.0.1:56452/?app=dashboard&chapter=floor&device=ipad')
 await page.evaluate(()=>sessionStorage.setItem('umi-dashboard-floor-editor-v2','tour-must-not-overwrite'))
 await page.waitForTimeout(750)
 check('El recorrido no sobrescribe el plano guardado',await page.evaluate(()=>sessionStorage.getItem('umi-dashboard-floor-editor-v2'))==='tour-must-not-overwrite')
 await page.getByRole('button',{name:'Horizontal',exact:true}).click()
 await page.waitForTimeout(300)
 check('Girar tablet conserva capítulo y pausa',await page.locator('.d-app').getAttribute('data-view')==='floor'&&await page.locator('.dashboard-show').getAttribute('data-tour-playing')==='false')
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.waitForTimeout(200)
 check('Movimiento reducido conserva pantalla',await page.locator('.d-app').getAttribute('data-view')==='floor')
 await page.getByRole('button',{name:'Paso siguiente',exact:true}).click()
 check('Movimiento reducido permite pasos manuales',(await page.locator('[data-target=d-floor-edit]').innerText())==='Terminar edición')
 await page.emulateMedia({reducedMotion:'no-preference'})
 await page.waitForTimeout(250)
 check('Restaurar movimiento conserva capítulo pausado',await page.locator('.d-app').getAttribute('data-view')==='floor'&&await page.locator('.dashboard-show').getAttribute('data-tour-playing')==='false')
 await page.getByRole('button',{name:'Explorar pantalla',exact:true}).click()
 check('Explorar conserva edición del plano',(await page.locator('[data-target=d-floor-edit]').innerText())==='Terminar edición')
 await page.goto('http://127.0.0.1:56452/?app=dashboard&access=platform&chapter=cafes')
 await page.getByRole('button',{name:'Vista de plataforma',exact:true}).click()
 await page.waitForTimeout(250)
 check('Quitar plataforma no deja una pantalla restringida',await page.locator('.d-app').getAttribute('data-view')!=='cafes')
 await page.goto('http://127.0.0.1:56452/?app=dashboard&play&device=windows')
 await page.waitForFunction(()=>Number(document.querySelector('.dashboard-show')?.dataset.tourStep)>=2)
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
 await page.waitForTimeout(100)
 const hiddenStep=await page.locator('[data-tour-step]').getAttribute('data-tour-step')
 const hiddenPose=await page.locator('.ss-cursor').getAttribute('style')
 await page.waitForTimeout(1200)
 check('Ocultar la pestaña suspende escena y cursor',await page.locator('[data-tour-step]').getAttribute('data-tour-step')===hiddenStep&&await page.locator('.ss-cursor').getAttribute('style')===hiddenPose)
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))})
 await page.waitForFunction(step=>Number(document.querySelector('.dashboard-show')?.dataset.tourStep)>Number(step),hiddenStep)
 check('Volver a la pestaña continúa el recorrido',true)
 await page.evaluate(()=>document.querySelector('.dashboard-tour-stage').style.marginTop='3000px')
 await page.waitForTimeout(150)
 const outsideStep=await page.locator('[data-tour-step]').getAttribute('data-tour-step')
 await page.waitForTimeout(1200)
 check('Salir de la zona visible suspende el recorrido',await page.locator('[data-tour-step]').getAttribute('data-tour-step')===outsideStep)
 await page.evaluate(()=>document.querySelector('.dashboard-tour-stage').style.marginTop='')
 await page.waitForFunction(step=>Number(document.querySelector('.dashboard-show')?.dataset.tourStep)>Number(step),outsideStep)
 check('Volver a la zona visible continúa el recorrido',true)
 await page.getByRole('button',{name:'Pausar recorrido',exact:true}).click()
 check('Sin errores de navegador',errors.length===0)
 check('Sin blancos de cursor ausentes',warnings.length===0)
 await writeFile('shots/dashboard-tour-qa.json',JSON.stringify({results,errors,warnings},null,2))
} catch(error){await page.screenshot({path:'shots/dashboard-tour-failure.png',fullPage:true}).catch(()=>{});throw error} finally {await browser.close()}

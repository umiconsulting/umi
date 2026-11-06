import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { clickSelectTrigger } from './select-qa.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
const base=process.argv[2]||'http://127.0.0.1:56453'
const onlyChapter=process.argv[3]
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1100}})
const checks=[],errors=[],missing=[],styles=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('console',m=>{if(m.type()==='warning'&&/target.*missing|not found|no element with data-target/i.test(m.text()))errors.push(m.text())})
page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))missing.push(r.url())})
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name)}
await mkdir('shots/viewer-redesign',{recursive:true})
try{
 for(const app of ['pos','dashboard','menu']){
  await page.goto(`${base}/?app=${app}&screen=sale`)
  const apps=page.getByRole('group',{name:'Aplicación del prototipo'})
  await apps.waitFor()
  check(`Orden de aplicaciones en ${app}`,(await apps.innerText()).replace(/\s+/g,' ').trim()==='UMI POS Dashboard Menú digital')
  const active=apps.locator('[aria-pressed=true]')
  styles.push(await active.evaluate(el=>{const s=getComputedStyle(el);return{height:s.height,radius:s.borderRadius,font:s.fontSize,background:s.backgroundColor,border:s.borderColor}}))
  await page.screenshot({path:`shots/viewer-redesign/controls-${app}.png`,fullPage:true})
 }
 check('Un mismo estilo seleccionado en las tres aplicaciones',styles.every(s=>JSON.stringify(s)===JSON.stringify(styles[0])))
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:1100})
  for(const [chapter,mode] of [['config','pickup'],['accept','pickup'],['accept','table'],['accept','scheduled'],['kitchen','pickup'],['kitchen','scheduled'],['pay','pickup'],['cancel','pickup']]){
   if(onlyChapter&&chapter!==onlyChapter)continue
   await page.goto(`${base}/?app=menu&menuView=tour&menuChapter=${chapter}&menuMode=${mode}`)
   const pick=async(label,option)=>{await clickSelectTrigger(page,page.getByRole('button',{name:new RegExp(label)}));await page.getByRole('option',{name:option,exact:true}).click();await page.locator('[data-trigger="Select"]').waitFor({state:'detached'})}
   await pick('Velocidad','2×')
   if(chapter==='cancel')await pick('Estado al cancelar','En preparación')
   await page.locator('iframe[title="Recorrido del menú digital"]').scrollIntoViewIfNeeded()
   const stage=page.frameLocator('iframe[title="Recorrido del menú digital"]')
   if(chapter!=='cancel'){
    const staff=stage.frameLocator('iframe[title="Redesign de Umi para el personal"]')
    await staff.locator('[data-redesign]').waitFor({timeout:20000})
    check(`${width} ${chapter}/${mode} usa el componente del redesign`,await staff.locator(chapter==='config'?'.d-app':'.u-app').isVisible())
   }
   await stage.locator('.ss-stage[data-mark="fin"]').waitFor({timeout:35000})
   if(chapter==='cancel')check(`${width} cancelación conserva autorización`,(await stage.frameLocator('iframe').locator('#status-dialog').innerText()).includes('Pedido cancelado'))
   if(chapter==='pay'){
    const staff=stage.frameLocator('iframe')
    check(`${width} cobro muestra el total del menú`,(await staff.locator('.u-app').innerText()).includes('210.00'))
    check(`${width} ticket conserva el negocio`,await staff.locator('.u-receipt-brand').textContent()==='Bruma')
   }
   if(chapter==='config')check(`${width} sucursal visible`,(await stage.frameLocator('iframe').locator('.d-branch-picker').innerText()).includes('Centro'))
   if(chapter==='accept')check(`${width} aviso no tapa el contenido`,await stage.frameLocator('iframe').locator('.menu-staff-notice').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('.u-workspace').getBoundingClientRect().top+1))
   if(chapter==='accept'&&mode!=='table')check(`${width} confirmación completa tras aceptar`,await stage.frameLocator('iframe').locator('.u-inbox-empty>svg').evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('.u-workspace').getBoundingClientRect().top))
   await page.screenshot({path:`shots/viewer-redesign/${width}-${chapter}-${mode}.png`,fullPage:true})
  }
 }
 await page.setViewportSize({width:1280,height:1000})
 await page.goto(`${base}/?embed=menu-staff`)
 await page.locator('.menu-staff-root').waitFor()
 await page.evaluate(()=>window.postMessage({type:'umi-staff:render',command:{chapter:'accept',mode:'pickup',beat:0,cancelCase:'pending'}},location.origin))
 await page.locator('.u-incoming-card').waitFor()
 await page.screenshot({path:'shots/viewer-redesign/incoming-name.png',fullPage:true})
 check('Pedido entrante muestra Ana y no una expresión de código',(await page.locator('.u-incoming-card').innerText()).includes('Ana')&&!(await page.locator('.u-incoming-card').innerText()).includes('{'))
 check('Sin errores de página ni recursos faltantes',!errors.length&&!missing.length)
 await writeFile(`shots/viewer-redesign/qa${onlyChapter?'-'+onlyChapter:''}.json`,JSON.stringify({base,checks,styles,errors,missing},null,2))
}catch(error){
 await page.screenshot({path:'shots/viewer-redesign/failure.png',fullPage:true}).catch(()=>{})
 await writeFile(`shots/viewer-redesign/qa${onlyChapter?'-'+onlyChapter:''}.json`,JSON.stringify({base,checks,styles,errors,missing,failure:String(error)},null,2))
 throw error
}finally{await browser.close()}

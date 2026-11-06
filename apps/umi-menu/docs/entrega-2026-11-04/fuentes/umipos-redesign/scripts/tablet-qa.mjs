import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1900}}),results=[],errors=[]
page.on('pageerror',e=>errors.push(e.message))
const before=process.argv.includes('--before')
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const button=name=>page.getByRole('button',{name,exact:true})
const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.locator('.study-stage').screenshot({path:`shots/tablet-${before?'before-':''}${name}.png`})}
try{
 for(const device of (before?['galaxy']:['ipad','galaxy'])){
  for(const screen of ['login','sale','tables','incoming','cash','settings','kitchen','payment','done']){
   await page.goto(`http://127.0.0.1:56452/?screen=${screen}&device=${device}`)
   await page.locator('.u-app').waitFor()
   await shot(`${device}-${screen}`)
   if(!before&&screen==='tables'){
    check(`${device}: las seis mesas quedan visibles en el plano`,await page.locator('.u-plan-viewport').evaluate(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('.u-table')].every(t=>{const b=t.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1&&b.top>=r.top&&b.bottom<=r.bottom+1})}))
    await button('Mesa 06').click()
    check(`${device}: mesa libre muestra abrir cuenta`,await button('Abrir cuenta').isVisible())
    await button('Mesa 03').click()
    await button('Continuar cuenta').click()
    check(`${device}: mesa ocupada abre la cuenta`,await page.locator('.u-app').getAttribute('data-screen')==='sale')
    await button('Mesas').click()
   }
   if(!before&&screen==='payment'){
    check(`${device}: teclado de cobro con teclas de 56 px`,await page.locator('.u-keypad button').evaluateAll(items=>items.every(el=>el.clientHeight>=44&&el.clientHeight<=60)))
    await button('Tarjeta').click()
    check(`${device}: confirmación de tarjeta accesible`,await button('Registrar pago aprobado').isVisible())
    await button('Efectivo').click()
   }
   if(!before&&screen==='kitchen'){
    await button('Recibir comanda').click();await button('Comenzar preparación').click()
    await button('Marcar Latte listo').click();await button('Marcar estación lista').click()
    check(`${device}: estación completa preparación sin cobro`,await page.getByText('Preparación completada',{exact:true}).count()>0&&await page.locator('[data-target=pay]').count()===0)
   }
   const spills=await page.locator('.u-app').evaluate(root=>{
    const bounds=root.getBoundingClientRect()
    return [...root.querySelectorAll('button')].filter(el=>{
     const style=getComputedStyle(el),r=el.getBoundingClientRect()
     if(!r.width||style.visibility==='hidden'||el.closest('[aria-hidden=true]'))return false
     if(el.closest('.u-products,.u-ticket-body,.u-settings-content,.u-cash-content,.u-count-scroll,.u-kitchen,.u-account-list'))return false
     return r.right>bounds.right+1||r.left<bounds.left-1||r.bottom>bounds.bottom+1||r.top<bounds.top-1
    }).map(el=>el.textContent.trim())
   })
   if(before)console.log('BEFORE',screen,spills)
   else check(`${device} ${screen}: controles dentro de pantalla ${spills.join(',')}`,spills.length===0)
  }
 }
 if(!before){check('Sin errores de navegador',errors.length===0);await writeFile('shots/tablet-qa.json',JSON.stringify({results,errors},null,2))}
}finally{await browser.close()}

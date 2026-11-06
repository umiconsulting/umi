import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1750}}),results=[],errors=[],measurements=[]
page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const read=async selector=>page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el),t=getComputedStyle(el.querySelector('span')||el);return {height:el.offsetHeight,radius:s.borderRadius,font:s.fontFamily,textFont:t.fontFamily,size:t.fontSize,weight:t.fontWeight,color:t.color,background:s.backgroundColor}})
try{
 for(const dark of [false,true]){
  await page.goto('http://127.0.0.1:56452/?app=dashboard&view=login&device=windows'+(dark?'&theme=dark':''))
  if(dark&&await page.locator('.d-app').getAttribute('data-theme')!=='dark')await page.getByRole('button',{name:'Oscuro',exact:true}).click()
  await page.evaluate(()=>document.fonts.ready)
  const style=await read('.d-auth-form .bg-button-primary');measurements.push({screen:'dashboard-login',dark,...style});console.log(JSON.stringify(style))
  check(`${dark?'oscuro':'claro'}: conserva la acción de acceso original de 50px`,style.height===50&&style.radius==='999px')
  check(`${dark?'oscuro':'claro'}: botón y texto conservan Source Sans 3`,style.font.includes('Source Sans 3')&&style.textFont.includes('Source Sans 3'))
  const contrast=await page.locator('.d-auth-form .bg-button-primary').evaluate(el=>{const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);const lum=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const s=getComputedStyle(el),a=lum(getComputedStyle(el.querySelector('span')||el).color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})
  check(`${dark?'oscuro':'claro'}: contraste de botón mayor a 4.5`,contrast>=4.5)
  const fields=await page.locator('.d-auth-form .border-border-input-default').evaluateAll(elements=>elements.map(el=>{
   const s=getComputedStyle(el),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1
   const lum=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)}
   const a=lum(s.borderColor),b=lum(s.backgroundColor)
   return {height:el.offsetHeight,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
  }))
  console.log('FIELD',JSON.stringify(fields))
  check(`${dark?'oscuro':'claro'}: contornos de campos al menos 3:1`,fields.length===2&&fields.every(f=>f.ratio>=3))
  check(`${dark?'oscuro':'claro'}: campos mantienen altura 52px`,fields.every(f=>f.height===52))
  check(`${dark?'oscuro':'claro'}: un solo borde por campo`,await page.locator('.d-auth-credential').evaluateAll(elements=>elements.length===2&&elements.every(el=>getComputedStyle(el).borderTopWidth==='0px'&&el.querySelectorAll('.border-border-input-default').length===1)))
  check(`${dark?'oscuro':'claro'}: formulario integrado al fondo`,await page.locator('.d-auth-form').evaluate(el=>getComputedStyle(el).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(el).borderTopWidth==='0px'))
  measurements.push({dark,fields})
  await page.locator('.study-stage').screenshot({path:`shots/interface-login-${dark?'dark':'light'}.png`})
 }
 await page.goto('http://127.0.0.1:56452/?screen=payment&device=windows')
 await page.locator('.u-keypad').waitFor()
 const payment=await read('.u-keypad button');measurements.push({screen:'payment',...payment})
 check('Teclado de cobro 22px/500',payment.size==='22px'&&payment.weight==='500')
 await page.goto('http://127.0.0.1:56452/?device=windows')
 await page.locator('.u-pin-keypad').waitFor()
 const pin=await read('.u-pin-keypad button');measurements.push({screen:'pin',...pin})
 check('Teclados PIN y cobro coinciden',pin.size===payment.size&&pin.weight===payment.weight)
 check('Sin errores de navegador',errors.length===0)
 await writeFile('shots/interface-qa.json',JSON.stringify({results,errors,measurements},null,2))
}finally{await browser.close()}

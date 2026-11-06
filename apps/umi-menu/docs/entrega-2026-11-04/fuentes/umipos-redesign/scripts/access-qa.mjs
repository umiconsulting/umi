import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1200}}),results=[],errors=[]
page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const login=async pin=>{await page.getByLabel('PIN', {exact:true}).fill(pin);await page.getByRole('button',{name:'Ingresar',exact:true}).click()}
const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.locator('.study-stage').screenshot({path:`shots/${name}.png`})}
try{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1200})
  await page.goto('http://127.0.0.1:56452/')
  await page.locator('.u-app').waitFor()
  check(`${width}: comienza en acceso sin catálogo`,await page.locator('.u-login').count()===1&&await page.locator('.u-catalog').count()===0)
  check(`${width}: PIN incompleto no permite ingresar`,await page.getByRole('button',{name:'Ingresar',exact:true}).isDisabled())
  check(`${width}: PIN cabe en pantalla`,await page.getByLabel('PIN',{exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),s=el.closest('.u-app').getBoundingClientRect();return r.right<s.right&&r.left>s.left}))
  check(`${width}: resumen operativo visible`,await page.getByLabel('Resumen del negocio').isVisible())
  await shot(`login-${width}`)
  await login('0000')
  check(`${width}: rechaza PIN incorrecto`,await page.getByRole('alert').isVisible()&&await page.locator('.u-catalog').count()===0)
  await login('2580')
  await page.locator('[data-target=product-americano]').click()
  await page.getByRole('button',{name:'Configuración',exact:true}).click()
  await shot(`settings-${width}`)
  await page.getByRole('button',{name:'Pantalla',exact:true}).click()
  await page.getByText('Fotos de productos',{exact:true}).click()
  await page.getByRole('button',{name:'Sesión',exact:true}).click()
  await page.getByRole('button',{name:'Bloquear pantalla',exact:true}).click()
  check(`${width}: bloqueo oculta la cuenta`,await page.locator('.u-login').isVisible()&&await page.locator('.u-ticket').count()===0)
  await login('2580')
  check(`${width}: conserva preferencia al desbloquear`,await page.locator('.u-product-photo').count()===0)
  if(width===390)await page.locator('.u-mobile-cart').click()
  check(`${width}: conserva pedido al desbloquear`,(await page.locator('.u-ticket').innerText()).includes('Americano'))
  for(const [role,pin] of [['Barra','3690'],['Cocina','1470']]){
   await page.getByRole('button',{name:`Vista de ${role}`,exact:true}).click()
   await login('2580')
   check(`${width} ${role}: PIN de caja no abre estación`,await page.getByRole('alert').isVisible())
   await login(pin)
   check(`${width} ${role}: acceso exclusivo a preparación`,await page.locator('.u-kitchen').count()===1&&await page.locator('[data-target=pay],.u-rail').count()===0)
   await page.getByRole('button',{name:'Configuración',exact:true}).click()
   check(`${width} ${role}: configuración sin opciones de caja`,await page.getByRole('checkbox',{name:'Fotos de productos'}).count()===0&&await page.getByRole('button',{name:'Dispositivos',exact:true}).count()===0)
   await page.getByRole('button',{name:'Sesión',exact:true}).click()
   await page.getByRole('button',{name:'Bloquear pantalla',exact:true}).click()
   await login(pin)
   check(`${width} ${role}: desbloquea en su estación`,await page.locator('.u-kitchen').isVisible())
  }
 }
 check('Sin errores de navegador',errors.length===0)
 await writeFile('shots/access-qa.json',JSON.stringify({results,errors},null,2))
}catch(error){await page.screenshot({path:'shots/access-failure.png',fullPage:true});console.log(errors);throw error}finally{await browser.close()}

import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1750}}),results=[],errors=[]
page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const button=name=>page.getByRole('button',{name,exact:true})
const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);await page.locator('.study-stage').screenshot({path:`shots/dashboard-auth-${name}.png`})}
try{
 await page.goto('http://127.0.0.1:56452/?app=dashboard&view=login')
 await page.getByRole('textbox',{name:/Correo/}).fill('sofia@example.com');await page.getByLabel(/Contraseña/).fill('UmiDemo2026')
 await page.getByText('Recordar mi correo',{exact:true}).click();await button('Entrar').click()
 await page.reload()
 check('Recarga conserva el correo recordado',await page.getByRole('textbox',{name:/Correo/}).inputValue()==='sofia@example.com')
 check('Recarga conserva la opción de recordar',await page.getByRole('checkbox',{name:'Recordar mi correo',exact:true}).isChecked())
 await page.getByLabel(/Contraseña/).fill('UmiDemo2026');await button('Entrar').click()
 check('Acceso posterior conserva la preferencia',await page.evaluate(()=>localStorage.getItem('umi.redesign.demo.email'))==='sofia@example.com')
 for(const device of ['windows','iphone','android','ipad','galaxy']){
  await page.goto(`http://127.0.0.1:56452/?app=dashboard&view=login&device=${device}`)
  await page.locator('.d-auth').waitFor();await page.locator('.d-auth-image img').evaluate(img=>img.decode())
  check(`${device}: conserva el fondo original`,await page.locator('.d-auth-image img').evaluate(img=>img.complete&&img.naturalWidth>=2048))
  check(`${device}: acceso sin desbordamiento`,await page.locator('.d-auth').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  const geometry=await page.locator('.d-auth').evaluate(el=>{
   const a=el.getBoundingClientRect(),image=el.querySelector('.d-auth-image').getBoundingClientRect(),brand=el.querySelector('.d-auth-brand').getBoundingClientRect(),form=el.querySelector('.d-auth-form').getBoundingClientRect()
   return {full:Math.abs(a.x-image.x)<1&&Math.abs(a.y-image.y)<1&&Math.abs(a.width-image.width)<1&&Math.abs(a.height-image.height)<1,safe:brand.top>=a.top+16&&form.top>brand.bottom}
  })
  check(`${device}: pescado cubre todo el acceso sin panel dividido`,geometry.full)
  check(`${device}: marca y formulario dentro del área segura`,geometry.safe)
  check(`${device}: conserva el mensaje original de UMI`,await page.locator('.d-auth-story').innerText().then(t=>t.includes('Tu operación,')&&t.includes('en tiempo real.')&&t.includes('Supervisa la operación de tu negocio al momento, desde un solo panel.')))
  check(`${device}: mensaje y formulario no se superponen`,await page.locator('.d-auth').evaluate(el=>{const story=el.querySelector('.d-auth-story').getBoundingClientRect(),form=el.querySelector('.d-auth-form').getBoundingClientRect();return story.right<=form.left||story.bottom+16<=form.top}))
  await shot(device)
  await page.getByRole('textbox',{name:/Correo/}).fill('sofia@example.com');await page.getByLabel(/Contraseña/).fill('wrong')
  await button('Mostrar contraseña').click();check(`${device}: revelar contraseña`,await page.getByRole('textbox',{name:/Contraseña/}).getAttribute('type')==='text')
  await button('Entrar').click();check(`${device}: rechazo explícito`,await page.getByRole('alert').isVisible())
  await page.getByRole('textbox',{name:/Contraseña/}).fill('UmiDemo2026');await button('Entrar').click();check(`${device}: sesión abre resumen`,await page.locator('.d-app').getAttribute('data-view')==='overview')
 }
 await page.goto('http://127.0.0.1:56452/?app=dashboard&view=login&device=iphone&auth=mfa&method=totp')
 await page.getByRole('textbox',{name:/Correo/}).fill('sofia@example.com');await page.getByLabel(/Contraseña/).fill('UmiDemo2026');await button('Entrar').click()
 check('MFA identifica aplicación de autenticación',await page.getByText('Ingresa el código de tu aplicación de autenticación.',{exact:true}).isVisible())
 await page.getByRole('textbox',{name:/Código de seis/}).fill('111111');await button('Verificar').click();check('MFA rechaza código incorrecto',await page.getByRole('alert').isVisible())
 await page.getByRole('textbox',{name:/Código de seis/}).fill('135790');await shot('mfa');await button('Verificar').click();check('MFA completa acceso',await page.locator('.d-auth').count()===0)
 await page.goto('http://127.0.0.1:56452/?app=dashboard&view=login&device=iphone')
 await button('Olvidé mi contraseña').click();await page.getByRole('textbox',{name:/Correo/}).fill('sofia@example.com');await button('Enviar enlace').click();check('Recuperación informa simulación de envío',await page.getByText('Solicitud de ejemplo. No se envió un correo real.').isVisible())
 await button('Abrir enlace de ejemplo').click();await page.getByLabel(/Nueva contraseña/).fill('short');await page.getByLabel(/Confirmar contraseña/).fill('short');await button('Guardar contraseña').click();check('Restablecimiento rechaza contraseña corta',await page.getByRole('alert').innerText()==='Usa al menos ocho caracteres.')
 await page.getByLabel(/Nueva contraseña/).fill('OtraDemo2026');await page.getByLabel(/Confirmar contraseña/).fill('NoCoincide');await button('Guardar contraseña').click();check('Restablecimiento comprueba coincidencia',await page.getByRole('alert').innerText()==='Las contraseñas no coinciden.')
 await page.getByLabel(/Confirmar contraseña/).fill('OtraDemo2026');await button('Guardar contraseña').click();await shot('reset-done');await button('Volver al acceso').click();await page.getByLabel(/Contraseña/).fill('OtraDemo2026');await button('Entrar').click();check('La nueva contraseña local permite entrar',await page.locator('.d-auth').count()===0)
 check('Sin errores de navegador',errors.length===0);await writeFile('shots/dashboard-auth-qa.json',JSON.stringify({results,errors},null,2))
}finally{await browser.close()}

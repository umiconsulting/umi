import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1480,height:1800}}),results=[],errors=[]
page.setDefaultTimeout(7000)
page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const button=name=>page.getByRole('button',{name,exact:true})
const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);await page.locator('.study-stage').screenshot({path:`shots/dashboard-${name}.png`})}
const open=async(view,device='windows',extra='')=>{await page.goto(`http://127.0.0.1:56452/?app=dashboard&view=${view}&device=${device}${extra}`);await page.locator('.d-app').waitFor()}
try{
 if(process.argv.includes('--shots')){
  for(const [view,device] of [['overview','windows'],['products','windows'],['business','windows'],['overview','iphone'],['overview','ipad'],['business','galaxy'],['products','iphone'],['business','iphone'],['floor','iphone']]){await open(view,device);await shot(`${device}-${view}`)}
  process.exitCode=0
 }else{
 await open('overview')
 const modules=await page.evaluate(async()=>{const m=await import('/src/dashboard/data.ts');return m.modules})
 check('El dashboard conserva todos los módulos',modules.length>=19)
 check('Propietaria no ve módulos de plataforma',await page.getByRole('link',{name:'Cafés',exact:true}).count()===0)
 await button('Vista de propietaria').click()
 for(const module of modules.filter(m=>m.id!=='profile')){
  const nav=page.locator(`[data-target="d-nav-${module.id}"]`);if(['reports','cash','products','inventory','diagnostics'].includes(module.id)){if(await nav.getAttribute('aria-expanded')!=='true')await nav.click();await page.locator(`[data-target="d-subnav-${module.views[0].id}"]`).click()}else await nav.click()
  for(const view of module.views){
   if(module.views.length>1){if(module.views.length>6){await page.getByRole('button',{name:new RegExp('Sección de '+module.label.toLowerCase())}).click();await page.getByRole('option',{name:view.label,exact:true}).click()}else await page.getByRole('tab',{name:view.label,exact:true}).click()}
   check(`Navegación ${module.label} / ${view.label}`,await page.locator('.d-app').getAttribute('data-view')===view.id)
   check(`${view.id}: contenido sin desbordamiento horizontal`,await page.locator('.d-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  }
 }
 await open('products')
 await page.getByLabel('Buscar en catálogo',{exact:true}).fill('Latte')
 check('Búsqueda conserva el producto correcto',await page.locator('.d-table tbody tr').count()===1)
 await page.getByLabel('Buscar en catálogo',{exact:true}).fill('noexiste')
 check('Búsqueda vacía ofrece recuperación',await button('Limpiar filtros').isVisible())
 await button('Limpiar filtros').click()
 await page.locator('.d-table tbody tr').first().click()
 check('Fila abre detalle de producto',await page.getByRole('heading',{name:'Variantes y opciones',exact:true}).isVisible())
 await shot('product-detail')
 await open('preparation')
 await button('Nueva preparación').click()
 await shot('preparation-edit');await page.getByRole('spinbutton',{name:/Cantidad/}).fill('4')
 await button('Revisar').click()
 check('Preparación revisa consumo antes de confirmar',await page.getByRole('heading',{name:'Ingredientes a consumir'}).isVisible())
 await button('Confirmar en la demo').click()
 check('Preparación informa el alcance simulado',await page.getByText(/Lote registrado en el ejemplo/).isVisible())
 await shot('preparation-result')
 await open('customers')
 await page.locator('.d-table tbody tr').first().click()
 for(const tab of ['WhatsApp','Pedidos','Lealtad','Notas','Datos']){await page.getByRole('tab',{name:tab,exact:true}).click();check(`Cliente: pestaña ${tab}`,await page.getByRole('tab',{name:tab,exact:true}).getAttribute('aria-selected')==='true')}
 await open('business')
 const name=page.getByRole('textbox',{name:/Nombre del negocio/})
 if(await name.count()){await name.fill('ONCA Café');await button('Guardar cambios').click();check('Ajustes confirma guardado local',await page.getByRole('status').isVisible())}
 for(const device of ['windows','mac','iphone','android','ipad','galaxy']){
  for(const view of ['overview','products','floor','registers','business']){
   await open(view,device)
   check(`${device}/${view}: contenido cabe en ancho`,await page.locator('.d-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
   if(view==='overview'||device==='galaxy'||device==='iphone')await shot(`${device}-${view}`)
  }
  if(['ipad','galaxy'].includes(device)){await button('Horizontal').click();check(`${device}: rotación conserva pantalla`,await page.locator('.d-app').getAttribute('data-view')==='business');await shot(`${device}-landscape`)}
 }
 await open('overview','iphone')
 await button('Abrir menú').click()
 await page.locator('[data-target=d-nav-inventory]').click();await page.locator('[data-target=d-subnav-items]').click()
 check('Menú móvil abre módulo y se cierra',await page.locator('.d-app').getAttribute('data-view')==='items'&&await page.locator('.d-sidebar').count()===0)
 await open('login','iphone')
 await page.getByRole('textbox',{name:/Correo/}).fill('sofia@example.com');await page.getByLabel(/Contraseña/).fill('UmiDemo2026')
 await button('Entrar').click()
 check('Acceso dashboard abre resumen',await page.locator('.d-app').getAttribute('data-view')==='overview')
 await open('overview','windows','&theme=dark');await shot('dark-overview')
 await open('business','iphone','&theme=dark');await shot('dark-form')
 check('Sin errores de navegador',errors.length===0)
 await writeFile('shots/dashboard-qa.json',JSON.stringify({results,errors},null,2))
}
}finally{await browser.close()}

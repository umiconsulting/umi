import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const base='http://127.0.0.1:56452/'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1200}})
const errors=[],results=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('console',e=>{if(e.type()==='error'||e.text().includes('[stageshow]'))errors.push(e.text())})
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const login=async (pin='2580')=>{await page.getByLabel('PIN',{exact:true}).fill(pin);await page.getByRole('button',{name:'Ingresar',exact:true}).click()}
const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(450);await page.locator('.study-stage').screenshot({path:`shots/${name}.png`})}
if(process.argv.includes('--catalog-only')){
 try{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1200})
   await page.goto(base)
   await login()
   check(`${width} Todo conserva los 12 productos`,await page.locator('.u-product').count()===12)
   await shot(`sale-${width}`)
   check(`${width} los 12 productos tienen foto cargada`,await page.locator('.u-product-photo').evaluateAll(images=>images.length===12&&images.every(image=>image.complete&&image.naturalWidth>0)))
   await page.getByRole('button',{name:'Ocultar fotos',exact:true}).click()
   check(`${width} permite operar sin fotos`,await page.locator('.u-product-photo').count()===0)
   await page.getByRole('button',{name:'Mostrar fotos',exact:true}).click()
   if(width===1440){
    await page.getByRole('button',{name:/Dispositivo de vista previa/}).click()
    await page.getByRole('option',{name:'iPhone 17 Pro · iOS',exact:true}).click()
    await page.locator('.u-app.compact').waitFor()
    check('Vista móvil conserva el pedido en escritorio',await page.locator('.u-product[data-in-order=true]').count()===2)
    await shot('forced-mobile')
    await page.getByRole('button',{name:/Dispositivo de vista previa/}).click()
    await page.getByRole('option',{name:'PC · Windows',exact:true}).click()
    await page.locator('.u-app:not(.compact)').waitFor()
    check('Volver a escritorio conserva catálogo y cuenta',await page.locator('.u-product').count()===12)
    const positions=await Promise.all(['.u-catalog','.u-category-column','.u-ticket'].map(selector=>page.locator(selector).boundingBox()))
    check('Productos, categorías y cuenta ocupan columnas consecutivas',positions[0].x+positions[0].width<=positions[1].x+1&&positions[1].x+positions[1].width<=positions[2].x+1)
    check('Logo visible con navegación contraída',await page.locator('.u-rail .u-logo').isVisible())
    check('Control de menú contenido y separado dentro de la barra',await page.locator('.u-rail-toggle').evaluate(button=>{const b=button.getBoundingClientRect(),rail=button.closest('.u-rail').getBoundingClientRect(),logo=document.querySelector('.u-logo').getBoundingClientRect();return b.x>=rail.x&&b.right<=rail.right&&b.top>logo.bottom&&getComputedStyle(button).backgroundColor!=='rgba(0, 0, 0, 0)'}))
    await page.getByRole('button',{name:'Expandir navegación',exact:true}).click()
    check('Navegación desplegada muestra nombres y logo',await page.locator('.u-nav button').first().locator('span').isVisible()&&await page.locator('.u-rail .u-logo').isVisible())
    await shot('catalog-navigation-expanded')
    await page.getByRole('button',{name:'Contraer navegación',exact:true}).click()
    check('Navegación contraída conserva iconos y oculta nombres',await page.locator('.u-nav button').first().locator('svg').isVisible()&&!await page.locator('.u-nav button').first().locator('span').isVisible())
   }
   await page.locator('[data-target=product-pizza]').scrollIntoViewIfNeeded()
   await shot(`all-categories-end-${width}`)
   await page.locator('[data-target=product-pizza]').click()
   if(width===390)await page.locator('.u-mobile-cart').click()
   check(`${width} agrega Pizza desde Todo`,(await page.locator('.u-ticket').innerText()).includes('Pizza margarita'))
   if(width===390){
    await shot('mobile-account')
    const back=await page.locator('.u-account-back').boundingBox(),ticket=await page.locator('.u-ticket').boundingBox(),pay=await page.locator('[data-target=pay]').boundingBox(),rail=await page.locator('.u-rail').boundingBox()
    check('Móvil: regreso arriba y cobro antes de navegación',back.y<ticket.y+16&&pay.y+pay.height<=rail.y)
    await page.getByRole('button',{name:'Editar opciones',exact:true}).click()
    check('Móvil: editar desde cuenta ocupa el área de trabajo',await page.locator('.u-product-editor').isVisible()&&!await page.locator('.u-ticket').isVisible())
    await page.getByRole('button',{name:'Avena',exact:true}).click()
    await page.locator('[data-target=add-product]').click()
    check('Móvil: guardar opciones vuelve a la misma cuenta',(await page.locator('.u-ticket').innerText()).includes('Avena'))
    await page.locator('.u-mobile-cart').click()
   }
   await page.locator('[data-target=product-latte]').click()
   if(width===1440){
    const editor=await page.locator('.u-product-editor').boundingBox(),account=await page.locator('.u-ticket').boundingBox()
    check('Opciones integradas dejan la cuenta visible',editor.x+editor.width<=account.x&&await page.locator('.u-ticket').isVisible())
   }else check('Logo visible en móvil',await page.locator('.u-mobile-brand').isVisible())
   await shot(`modifiers-${width}`)
   await page.getByRole('button',{name:'Cerrar opciones',exact:true}).click()
   await page.getByPlaceholder('Buscar un producto').fill('concha')
   check(`${width} búsqueda identifica la categoría en el producto`,await page.locator('.u-product').count()===1&&await page.locator('.u-product').getAttribute('data-category')==='Pan')
   await page.getByPlaceholder('Buscar un producto').fill('')
   await page.getByRole('button',{name:'Usar tema oscuro',exact:true}).click()
   await shot(`dark-${width}`)
  }
  check('Sin errores de navegador',errors.length===0)
  await writeFile('shots/catalog-qa.json',JSON.stringify({results,errors,browser:await browser.version()},null,2))
 }finally{await browser.close()}
 process.exit(0)
}
if(process.argv.includes('--tables-only')){
 let desktopGeometry
 const sameGeometry=(actual,expected)=>actual.every((table,i)=>table.every((v,j)=>Math.abs(v-expected[i][j])<.01))
 const geometry=()=>page.locator('.u-plan-canvas').evaluate(canvas=>{const c=canvas.getBoundingClientRect();return [...canvas.querySelectorAll('.u-table')].map(table=>{const t=table.getBoundingClientRect();return [t.left-c.left,t.top-c.top,t.width,t.height].map(n=>n/c.width*1000)})})
 try{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1200})
   await page.goto(base+'?screen=tables')
   await shot(`tables-${width}`)
   if(width===1440)desktopGeometry=await geometry()
   else {
    check('Móvil conserva posiciones y proporciones del plano',sameGeometry(await geometry(),desktopGeometry))
    await page.getByRole('button',{name:'Ampliar plano',exact:true}).click()
    check('Ampliar conserva la distribución del salón',sameGeometry(await geometry(),desktopGeometry))
    await page.getByRole('button',{name:'Ajustar plano',exact:true}).click()
   }
   await page.getByRole('button',{name:'Mesa 02',exact:true}).click()
   check(`${width} selecciona mesa disponible sin cambiar su estado`,await page.getByRole('button',{name:'Mesa 02',exact:true}).getAttribute('aria-pressed')==='true'&&await page.getByRole('button',{name:'Mesa 02',exact:true}).getAttribute('data-state')==='free')
   await shot(`tables-free-selected-${width}`)
   await page.getByRole('button',{name:'Vista de lista',exact:true}).click()
   await shot(`tables-list-${width}`)
   await page.getByRole('button',{name:'Vista de mapa',exact:true}).click()
   await page.getByRole('button',{name:'Usar tema oscuro',exact:true}).click()
   await shot(`tables-dark-${width}`)
  }
  check('Sin errores de navegador',errors.length===0)
  await writeFile('shots/table-qa.json',JSON.stringify({results,errors,browser:await browser.version()},null,2))
 }finally{await browser.close()}
 process.exit(0)
}
try{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1200})
  for(const screen of ['login','settings','sale','tables','incoming','payment','kitchen','cash','done']){
   await page.goto(base+'?screen='+screen)
   await page.locator('.u-app').waitFor()
   await shot(`${screen}-${width}`)
   check(`${width} ${screen}: sin desbordamiento de página`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   const clipped=await page.locator('.u-app').evaluate(root=>{
    const stage=root.getBoundingClientRect()
    return [...root.querySelectorAll('button')].filter(el=>{
     const s=getComputedStyle(el),r=el.getBoundingClientRect()
     if(s.visibility==='hidden'||s.display==='none'||r.width===0||el.closest('[aria-hidden=true]'))return false
     if(el.closest('.u-products,.u-product-groups,.u-floor-main,.compact .u-table-detail,.u-kitchen,.u-cash,.u-cash-content,.u-settings-content,.u-payment,.u-ticket-body'))return false
     return r.left<stage.left-1||r.right>stage.right+1||r.top<stage.top-1||r.bottom>stage.bottom+1
    }).map(el=>el.textContent.trim())
   })
   check(`${width} ${screen}: acciones fijas dentro de pantalla ${clipped.join(',')}`,clipped.length===0)
  }
  await page.goto(base)
   await login()
  for(const category of ['Bebidas','Pan','Pizzas']){
   await page.locator(`.u-categories button[data-category=${category}]`).click()
   await shot(`category-${category}-${width}`)
  }
  await page.locator('.u-categories button[data-category=Todo]').click()
  await shot(`category-Todo-${width}`)
  await page.getByPlaceholder('Buscar un producto').fill('latte')
  check(`${width} búsqueda filtra catálogo`,await page.locator('.u-product').count()===1)
  await page.locator('[data-target=product-latte]').click()
  await page.locator('.u-modifier-overlay[data-open=true]').waitFor()
  await page.getByRole('button',{name:'Entera',exact:true}).click()
  await shot(`modifiers-${width}`)
  await page.locator('[data-target=add-product]').click()
  if(width===390)await page.locator('.u-mobile-cart').click()
  check(`${width} personalización visible en cuenta`,(await page.locator('.u-ticket').innerText()).includes('Nube · Entera'))
  const accountBefore=await page.locator('.u-ticket').boundingBox()
  await page.locator('[data-target=send]').click()
  await page.locator('[data-target=pay]').click()
  check(`${width} conserva mesa y folio en cobro`,(await page.locator('.u-payment-left').innerText()).includes('Cuenta 042')&&(await page.locator('.u-payment-left').innerText()).includes('Mesa 03'))
  check(`${width} muestra importe faltante`,(await page.locator('.u-change').innerText()).includes('Faltan'))
  check(`${width} división del cobro visible`,await page.locator('.u-split').isVisible())
  if(width===1440){const after=await page.locator('.u-payment-left').boundingBox();check('Cuenta mantiene la posición lateral al cobrar',Math.abs(accountBefore.x-after.x)<2)}
  check(`${width} impide confirmar efectivo insuficiente`,await page.locator('[data-target=confirm]').isDisabled())
  await page.getByRole('button',{name:'Tarjeta',exact:true}).click()
  await shot(`card-${width}`)
  await page.getByRole('button',{name:'Efectivo',exact:true}).click()
  await page.locator('[data-target=cash-200]').click()
  check(`${width} calcula cambio 65`,(await page.locator('.u-change').innerText()).includes('$65.00'))
  await shot(`cash-ready-${width}`)
  await page.locator('[data-target=confirm]').click()
  check(`${width} resultado conserva cambio`,(await page.locator('.u-done-change').innerText()).includes('$65.00'))
  await page.getByRole('button',{name:'Imprimir ticket',exact:true}).click()
  check(`${width} impresión simulada confirma acción`,await page.getByRole('button',{name:'Ticket listo'}).isVisible())
  await page.goto(base+'?screen=incoming')
  await page.getByRole('button',{name:'Atender en cuenta 043'}).click()
  if(width===390)await page.locator('.u-mobile-cart').click()
  check(`${width} entrante abre cuenta con identidad propia`,(await page.locator('.u-ticket').innerText()).includes('Cuenta 043'))
  await page.goto(base+'?theme=dark')
  await login()
  await shot(`dark-${width}`)
 }
 await page.setViewportSize({width:1440,height:1200})
 await page.goto(base+'?play=1')
 await page.locator('.ss-stage[data-mark=resultado]').waitFor({timeout:65000})
 check('Recorrido animado llega al resultado correcto',(await page.locator('.u-done-change').innerText()).includes('$65.00'))
 await page.getByRole('button',{name:'Ver recorrido completo'}).click()
 await page.locator('.ss-stage[data-mark=acceso]').waitFor({timeout:8000})
 check('Repetir reinicia el recorrido',await page.locator('.u-login').isVisible())
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.goto(base+'?play=1')
 await page.locator('.ss-stage[data-still]').waitFor()
 check('Movimiento reducido muestra resultado completo',await page.locator('.u-done-title').isVisible())
 await shot('reduced-motion')
 check('Sin errores de navegador',errors.length===0)
 await writeFile('shots/qa.json',JSON.stringify({results,errors,browser:await browser.version()},null,2))
}catch(e){await page.screenshot({path:'shots/qa-failure.png',fullPage:true});await writeFile('shots/qa-failure.json',JSON.stringify({message:e.message,results,errors},null,2));throw e}finally{await browser.close()}

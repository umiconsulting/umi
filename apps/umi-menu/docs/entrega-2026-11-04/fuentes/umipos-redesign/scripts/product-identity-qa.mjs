import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile, copyFile } from 'node:fs/promises'

const output='shots/product-identity', base='http://127.0.0.1:56452/'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1200}}), results=[], errors=[], requests=[], metrics=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('request',r=>{if(/\/products\/.*\.jpg/.test(r.url()))requests.push(r.url())})
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const button=name=>page.getByRole('button',{name,exact:true})
const goto=async(design,device='windows',theme='light',orientation='portrait')=>{requests.length=0;await page.goto(`${base}?screen=sale&design=${design}&device=${device}&theme=${theme}&orientation=${orientation}`);await page.locator('.u-product').first().waitFor();await page.evaluate(()=>document.fonts.ready)}
const shot=async name=>{await page.waitForTimeout(200);await page.locator('.study-stage').screenshot({path:`${output}/${name}.png`})}
const noPhotos=async name=>check(name,await page.locator('.u-catalog img').count()===0&&await page.getByRole('button',{name:/^(Ocultar|Mostrar) fotos$/}).count()===0)
try {
 await mkdir(output,{recursive:true})
 if(process.argv.includes('--first-pass')){
  for(const design of ['2','3'])for(const device of ['windows','iphone'])for(const theme of ['light','dark']){
   await page.goto(`${base}?screen=login&design=${design}&device=${device}&theme=${theme}`);await page.evaluate(()=>document.fonts.ready);await shot(`first-pin${design}-${device}-${theme}`)
   await goto(design,device,theme);await shot(`first-sale${design}-${device}-${theme}`)
  }
  process.exitCode=0
 } else {
 await copyFile('shots/option2-revision/option1-before.png',`${output}/option1-before.png`)
 await goto('1');await shot('option1-after')
 const names=await page.locator('.u-product strong').allTextContents()
 check('Twelve original full product names',names.length===12)
 for(const preference of [false,true]){
  if(!preference)await button('Ocultar fotos').click();else await button('Mostrar fotos').click()
  const order=await page.locator('.u-ticket .u-lines').innerText()
  for(const design of ['2','3']){
   await button(`Rediseño ${design}`).click();await noPhotos(`${design}: catalogue and modifiers have no mounted images or toggle`)
   check(`${design}: design switch preserves order`,await page.locator('.u-ticket .u-lines').innerText()===order)
   await button('Configuración').click();await button('Pantalla').click()
   check(`${design}: settings cannot enable photos`,await page.getByRole('checkbox',{name:'Fotos de productos',exact:true}).count()===0)
   await button('Venta').click()
  }
  await button('Rediseño 1').click()
  check(`Photo1 preference ${preference} survives 1→2→3→1`,await page.locator('.u-product-photo').count()===(preference?12:0))
  await button('Configuración').click();await button('Pantalla').click()
  check(`Settings1 retains preference ${preference}`,await page.getByRole('checkbox',{name:'Fotos de productos',exact:true}).isChecked()===preference)
  await shot(`settings1-photos-${preference}`);await button('Venta').click()
 }
 for(const design of ['2','3']){
  for(const device of ['windows','iphone','ipad','galaxy'])for(const orientation of ['ipad','galaxy'].includes(device)?['portrait','landscape']:['portrait'])for(const theme of ['light','dark']){
   await goto(design,device,theme,orientation)
   await noPhotos(`${design}/${device}/${orientation}/${theme}: no product images or toggle`)
   check(`${design}/${device}/${orientation}/${theme}: no product image requests`,requests.length===0)
   assert.deepEqual(await page.locator('.u-product strong').allTextContents(),names)
   const geometry=await page.locator('.u-products').evaluate(root=>[...root.querySelectorAll('.u-product')].map(card=>{
    const name=card.querySelector('strong'),price=card.querySelector('.u-product-price'),category=card.querySelector('.u-product-category'),count=card.querySelector('.u-product-count')
    const c=card.getBoundingClientRect(),n=name.getBoundingClientRect(),p=price.getBoundingClientRect(),q=count?.getBoundingClientRect()
    const inside=r=>r.left>=c.left&&r.right<=c.right+1&&r.top>=c.top&&r.bottom<=c.bottom+1
    const overlap=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom
    return {name:name.textContent,width:card.offsetWidth,height:card.offsetHeight,font:parseFloat(getComputedStyle(name).fontSize),categoryFont:parseFloat(getComputedStyle(category).fontSize),priceFont:parseFloat(getComputedStyle(price).fontSize),fits:inside(n)&&inside(p)&&name.scrollHeight<=name.clientHeight+1&&name.scrollWidth<=name.clientWidth+1&&!overlap(n,p)&&(!q||!overlap(n,q)),category:category.textContent,price:price.textContent}
   }))
   metrics.push({design,device,orientation,theme,geometry})
   check(`${design}/${device}/${orientation}/${theme}: full names/prices/counts fit with 44px targets and 12px labels`,geometry.every(x=>x.fits&&x.width>=44&&x.height>=44&&x.categoryFont>=12&&x.priceFont>=12&&(design!=='3'||x.font===18)))
   await shot(`sale${design}-${device}-${orientation}-${theme}`)
  }
  for(const device of ['windows','iphone']){
   await goto(design,device)
   await button('Ver favoritos').click();check(`${design}/${device}: favorites retain four full names`,await page.locator('.u-product').count()===4)
   await button('Ver todos').click()
   await page.locator('.u-categories button[data-category=Pan]').click();check(`${design}/${device}: category filter`,await page.locator('.u-product').count()===4)
   await page.locator('.u-categories button[data-category=Todo]').click()
   await page.getByLabel('Buscar un producto',{exact:true}).fill('Americano limón');check(`${design}/${device}: search full name`,await page.locator('.u-product strong').innerText()==='Americano limón')
   await page.getByLabel('Buscar un producto',{exact:true}).fill('')
   await page.locator('[data-target=product-americano]').click();await page.keyboard.press('Tab');await page.locator('[data-target=product-americano]').focus()
   check(`${design}/${device}: product keyboard focus visible`,await page.locator('[data-target=product-americano]').evaluate(el=>getComputedStyle(el).outlineStyle!=='none'||getComputedStyle(el).boxShadow!=='none'))
   await page.locator('[data-target=product-latte]').click();await noPhotos(`${design}/${device}: modifier has no photo`)
   await shot(`modifiers${design}-${device}-light`)
   await button('Usar tema oscuro').click();await shot(`modifiers${design}-${device}-dark`);await button('Usar tema claro').click()
   await page.getByLabel('Cantidad',{exact:true}).fill('2');await page.getByLabel('Nota para preparación',{exact:true}).fill('Sin azúcar');await button('Avena').click();await page.locator('[data-target=add-product]').click()
   if(device==='iphone')await page.locator('.u-mobile-cart.u-primary').click()
   check(`${design}/${device}: options, quantity and note update order`,(await page.locator('.u-ticket').innerText()).includes('Sin azúcar')&&(await page.locator('.u-ticket').innerText()).includes('Avena'))
   await button('Editar opciones').click();check(`${design}/${device}: edit retains quantity`,await page.getByLabel('Cantidad',{exact:true}).inputValue()==='2')
   await page.getByLabel('Cantidad',{exact:true}).fill('1');await page.locator('[data-target=add-product]').click()
   await page.locator('[data-target=pay]').click();await button('Exacto').click();await page.locator('[data-target=confirm]').click();await page.locator('.u-app[data-screen=done]').waitFor()
   check(`${design}/${device}: edited order reaches paid result`,await page.locator('.u-done-main').isVisible()&&(await page.locator('.u-done-title').innerText()).includes('pagada'));await shot(`paid${design}-${device}`)
   await goto(design,device);await button('Configuración').click();await button('Pantalla').click()
   check(`${design}/${device}: settings no photo capability`,await page.getByRole('checkbox',{name:'Fotos de productos',exact:true}).count()===0)
   await shot(`settings${design}-${device}-light`);await button('Usar tema oscuro').click();await shot(`settings${design}-${device}-dark`)
  }
 }
 check('No browser errors',errors.length===0)
 }
} finally {await writeFile(`${output}/product-identity-results.json`,JSON.stringify({results,errors,metrics},null,2));await browser.close()}

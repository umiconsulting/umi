import {chromium} from 'playwright-core'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1200}}), results=[],errors=[],geometry=[]
const base='http://127.0.0.1:56452/',output='shots/product-identity'
page.on('pageerror',e=>errors.push(e.message))
const button=name=>page.getByRole('button',{name,exact:true})
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);await page.locator('.study-stage').screenshot({path:`${output}/${name}.png`})}
try{
 for(const design of ['2','3'])for(const device of (process.argv.includes('--landscape-only')?['ipad','galaxy']:process.argv.includes('--fit-regression')?['windows','iphone']:['windows','iphone','ipad','galaxy']))for(const theme of (process.argv.includes('--fit-regression')?['light']:['light','dark'])){
  await page.goto(`${base}?screen=login&design=${design}&device=${device}&theme=${theme}&orientation=${process.argv.includes('--landscape-only')?'landscape':'portrait'}`)
  await page.locator('.u-login').waitFor();await page.evaluate(()=>document.fonts.ready)
  const audit=await page.locator('.u-app').evaluate(root=>{
   const bounds=root.getBoundingClientRect(),visible=el=>el.checkVisibility({checkVisibilityCSS:true})&&el.getBoundingClientRect().height>0
   const controls=[...root.querySelectorAll('button,input')].filter(visible).map(el=>{const r=el.getBoundingClientRect();return {name:el.getAttribute('aria-label')||el.textContent,width:el.offsetWidth,height:el.offsetHeight,fits:r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1&&r.left>=bounds.left-1&&r.right<=bounds.right+1}})
   const labels=[...root.querySelectorAll('*')].filter(el=>visible(el)&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(el=>({text:el.textContent,size:parseFloat(getComputedStyle(el).fontSize)}))
   const summary=root.querySelector('.u-login-business').getBoundingClientRect(),footer=root.querySelector('.u-login-footer').getBoundingClientRect()
   return {height:bounds.height,footerExcess:footer.bottom-bounds.bottom,controls,labels,summaryFits:summary.bottom<=bounds.bottom+1,footerFits:footer.bottom<=bounds.bottom+1}
  })
  geometry.push({design,device,theme,...audit})
  if(process.argv.includes('--diagnose')) console.log(design,device,theme,audit.height,audit.footerExcess); else check(`${design}/${device}/${theme}: PIN controls visible >=44px`,audit.controls.every(c=>c.fits&&c.width>=44&&c.height>=44))
  if(!process.argv.includes('--diagnose'))check(`${design}/${device}/${theme}: labels >=12px and summary/footer fit`,audit.labels.every(l=>l.size>=12)&&audit.summaryFits&&audit.footerFits)
  await shot(`pin${design}-${device}-${process.argv.includes('--landscape-only')?'landscape-':''}${theme}`)
 }
 if(!process.argv.includes('--landscape-only')&&!process.argv.includes('--fit-regression')){
 for(const design of ['2','3'])for(const device of ['windows','iphone'])for(const [role,name,pin] of [['cashier','Ana · Caja','2580'],['bar','Luis · Barra','3690'],['kitchen','Marta · Cocina','1470']]){
  await page.goto(`${base}?screen=login&design=${design}&device=${device}`)
  if(design==='2')await button(name).click();else {await page.getByRole('button',{name:/Usuario/}).click();await page.getByRole('option',{name,exact:true}).click()}
  await page.locator('[data-target=pin-1]').click();await page.locator('[data-target=pin-2]').click();await button('Borrar último dígito').click()
  check(`${design}/${device}/${role}: delete`,await page.getByLabel('PIN',{exact:true}).inputValue()==='1')
  await button('Borrar PIN').click();check(`${design}/${device}/${role}: clear`,await page.getByLabel('PIN',{exact:true}).inputValue()==='')
  await page.getByLabel('PIN',{exact:true}).fill('0000');await button('Ingresar').click()
  check(`${design}/${device}/${role}: invalid PIN stays in login`,await page.locator('.u-app').getAttribute('data-screen')==='login'&&await page.getByRole('alert').isVisible())
  await page.getByLabel('PIN',{exact:true}).fill(pin);await button('Ingresar').click()
  check(`${design}/${device}/${role}: correct role route`,await page.locator('.u-app').getAttribute('data-role')===role&&(await page.locator('.u-app').getAttribute('data-screen'))===(role==='cashier'?'sale':'kitchen'))
 }
 await page.goto(`${base}?screen=sale&design=1&device=windows`)
 const order=await page.locator('.u-ticket .u-lines').innerText()
 await button('Rediseño 2').click();check('2 defaults compact after switch',await page.locator('.u-app').getAttribute('data-rail-expanded')==='false')
 await button('Rediseño 3').click();check('3 defaults expanded after switch',await page.locator('.u-app').getAttribute('data-rail-expanded')==='true')
 await button('Contraer navegación').click();await button('Rediseño 1').click();await button('Rediseño 3').click();check('3 explicit collapse persists',await page.locator('.u-app').getAttribute('data-rail-expanded')==='false')
 check('Rail preference switches preserve order',await page.locator('.u-ticket .u-lines').innerText()===order)
 check('Tour product targets remain unique',await page.locator('[data-target=product-latte]').count()===1&&await page.locator('[data-target=product-americano]').count()===1)
 await page.locator('[data-target=frequent-latte]').click();check('Frequent Latte uses existing editor',await page.locator('.u-product-editor').getAttribute('data-open')==='true');await button('Cerrar opciones').click()
 await page.locator('[data-target=frequent-americano]').click();check('Frequent Americano adds existing product',await page.locator('[data-target=product-americano] .u-product-count').innerText()==='1')
 await page.goto(`${base}?screen=login&design=2&device=windows`);await page.getByLabel('PIN',{exact:true}).fill('25')
 await button('Rediseño 3').click();await page.getByRole('button',{name:/Dispositivo de vista previa/}).click();await page.getByRole('option',{name:'iPhone 17 Pro · iOS',exact:true}).click()
 check('PIN persists across design and device',await page.getByLabel('PIN',{exact:true}).inputValue()==='25')
 }
 check('No browser errors',errors.length===0)
}finally{await writeFile(`${output}/login-identity${process.argv.includes('--landscape-only')?'-landscape':process.argv.includes('--fit-regression')?'-fit-regression':''}-results.json`,JSON.stringify({results,errors,geometry},null,2));await browser.close()}

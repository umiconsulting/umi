import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1200}})
const design=process.env.POS_DESIGN||'2', output=process.env.OPTION2_QA_OUTPUT||(design==='3'?'shots/option3':'shots/option2-revision')
assert.ok(['2','3'].includes(design),'Supported design')
const base=process.env.OPTION2_QA_URL||'http://127.0.0.1:56452/', results=[], errors=[]
page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const shot=async name=>{await page.waitForTimeout(400);await page.locator('.study-stage').screenshot({path:`${output}/${name}.png`})}
try{
 await mkdir(output,{recursive:true})
 await page.goto(base+'?screen=sale&device=windows')
 await page.waitForTimeout(600)
 if(process.argv.includes('--baseline')){await shot('option1-before');console.log('Baseline recorded');process.exitCode=0}
 else if((process.argv.includes('--matrix')||process.argv.includes('--audit'))){
 const audit=[]
 if(!process.argv.includes('--audit'))for(const device of ['windows','mac','iphone','android','ipad','galaxy'])for(const orientation of (['ipad','galaxy'].includes(device)?['portrait','landscape']:['portrait']))for(const theme of ['light','dark']){
  const mobile=['iphone','android'].includes(device)
  await page.goto(base+`?screen=sale&design=${design}&device=${device}&orientation=${orientation}&theme=${theme}`)
  await page.getByLabel('Buscar un producto',{exact:true}).fill('Americano limón')
  check(`${device}/${orientation}/${theme}: search and full product name`,await page.locator('.u-product').count()===1&&await page.locator('.u-product strong').innerText()==='Americano limón')
  await page.getByLabel('Buscar un producto',{exact:true}).fill('')
  check(`${device}/${orientation}/${theme}: text identity without images or photo toggle`,await page.locator('.u-catalog img').count()===0&&await page.getByRole('button',{name:/^(Ocultar|Mostrar) fotos$/}).count()===0)
  await page.locator('[data-target=product-americano]').click()
  await page.locator('[data-target=product-agua]').click()
  if(mobile)await page.locator('.u-mobile-cart.u-primary').click()
  const lines=page.locator('.u-ticket .u-line')
  await lines.last().getByRole('button',{name:'Agregar uno Agua mineral',exact:true}).click()
  check(`${device}/${orientation}/${theme}: last item controls reachable`,(await lines.last().innerText()).includes('$70.00'))
  if(mobile){
    check(`${device}/${theme}: ticket scroll advances`,await page.locator('.u-ticket-body').evaluate(e=>e.scrollTop>0))
    check(`${device}/${theme}: ticket fade visible`,Number(await page.locator('.u-ticket-scroll > [aria-hidden] > div').first().evaluate(e=>getComputedStyle(e).opacity))>0)
    await page.locator('.u-ticket-body').evaluate(e=>e.scrollTop=0);await page.waitForTimeout(50)
    check(`${device}/${theme}: ticket fade resets`,Number(await page.locator('.u-ticket-scroll > [aria-hidden] > div').first().evaluate(e=>getComputedStyle(e).opacity))===0)
  }
  await page.locator('[data-target=pay]').click()
  await page.locator('[data-target=cash-200]').click()
  check(`${device}/${orientation}/${theme}: payment reachable`,await page.locator('[data-target=confirm]').isVisible())
  check(`${device}/${orientation}/${theme}: design retained`,await page.getByRole('button',{name:`Rediseño ${design}`,exact:true}).getAttribute('aria-pressed')==='true')
 }
 for(const device of ['windows','iphone','ipad'])for(const theme of ['light','dark'])for(const screen of (process.argv.includes('--catalog-only')?['sale']:['sale','login','incoming','tables','kitchen','cash','settings','payment','done'])){
  await page.goto(base+`?screen=${screen}&design=${design}&device=${device}&theme=${theme}`)
  await page.locator('.u-app').waitFor();await page.waitForTimeout(150)
  audit.push({device,screen,theme,...await page.locator('.u-app').evaluate(root=>{
   const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&e.checkVisibility({checkVisibilityCSS:true})}
   const small=[...root.querySelectorAll('*')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>({class:e.className,text:e.textContent.trim().slice(0,60),size:getComputedStyle(e).fontSize}))
   const bounds=root.getBoundingClientRect();const overflow=[...root.querySelectorAll('button,input')].filter(e=>visible(e)&&e.getBoundingClientRect().right>bounds.right+1).map(e=>e.textContent.slice(0,30))
   const touch=[...root.querySelectorAll('button,input,summary')].filter(e=>visible(e)&&(e.offsetHeight<44||e.offsetWidth<44)).map(e=>({class:e.className,text:(e.textContent||e.getAttribute('aria-label')||'').slice(0,40),width:e.offsetWidth,height:e.offsetHeight}))
   return {small,overflow,touch}
  })})
 }
 await writeFile(`${output}/matrix-audit.json`,JSON.stringify(audit,null,2))
 check('All audited labels are at least 12px',audit.every(row=>row.small.length===0))
 check('No audited controls overflow horizontally',audit.every(row=>row.overflow.length===0))
 check('All audited touch targets are at least 44px',audit.every(row=>row.touch.length===0))
 check('No page errors in matrix',errors.length===0)
 }
 else if(process.argv.includes('--capture')){
 for(const device of ['windows','mac','iphone','android','ipad','galaxy'])for(const orientation of (['ipad','galaxy'].includes(device)?['portrait','landscape']:['portrait']))for(const theme of ['light','dark']){
  await page.goto(base+`?screen=sale&design=${design}&device=${device}&orientation=${orientation}&theme=${theme}`)
  await shot(`sale-${device}-${orientation}-${theme}`)
 }
 for(const screen of ['login','incoming','tables','kitchen','cash','settings','payment','done']){
  await page.goto(base+`?screen=${screen}&design=${design}&device=windows`);await shot(screen+'-windows')
  await page.goto(base+`?screen=${screen}&design=${design}&device=iphone`);await shot(screen+'-iphone')
 }
 for(const device of ['windows','iphone']){
  await page.goto(base+`?screen=sale&design=${design}&device=${device}`)
  await page.locator('[data-target=product-latte]').click();await shot('modifiers-'+device)
  await page.locator('[data-target=add-product]').click()
  if(device==='iphone')await page.locator('.u-mobile-cart.u-primary').click()
  await shot('account-'+device)
 }
 check('No page errors in matrix',errors.length===0)
 }
 else {
 check('Existing URLs retain option 1',await page.getByRole('group',{name:'Diseño del POS',exact:true}).getByRole('button',{name:'Rediseño 1',exact:true}).getAttribute('aria-pressed')==='true')
 await page.locator('[data-target=product-americano]').click()
 const before=await page.locator('.u-ticket .u-lines').innerText();const due=await page.locator('.u-ticket .u-total .ss-count').getAttribute('aria-label')
 await page.getByRole('button',{name:`Rediseño ${design}`,exact:true}).click()
 check('Variant switches without replacing the order',await page.locator('.u-ticket .u-lines').innerText()===before&&await page.locator('.u-ticket .u-total .ss-count').getAttribute('aria-label')===due)
 check('Direct share URL updated',new URL(page.url()).searchParams.get('design')===design)
 check('Variant scoped to workspace',await page.locator('.u-app').getAttribute('data-design')===design)
 await page.locator('[data-target=pay]').click()
 await page.getByRole('button',{name:'Dividir el cobro',exact:true}).click()
 await page.getByLabel('Importe parcial',{exact:true}).fill('50')
 await page.getByLabel('Efectivo recibido',{exact:true}).fill('100')
 await page.locator('[data-target=confirm]').click()
 const payment=await page.locator('.u-payment').innerText()
 await page.getByRole('button',{name:'Rediseño 1',exact:true}).click()
 await page.getByRole('button',{name:`Rediseño ${design}`,exact:true}).click()
 check('Switch preserves partial payment and payment screen',await page.locator('.u-payment').innerText()===payment)
 await shot('partial-payment')
 await page.goto(base+`?screen=sale&design=${design}&device=windows`)
 check(`Direct URL loads option ${design}`,await page.locator('.u-app').getAttribute('data-design')===design)
 await shot('sale-windows-light')
 await page.goto(base+'?screen=sale&design=invalid&device=windows')
 check('Invalid design defaults to 1',await page.locator('.u-app').getAttribute('data-design')==='1')
 await page.goto(base+`?design=${design}&device=windows`)
 await page.getByRole('button',{name:'Ver recorrido completo',exact:true}).click()
 await page.waitForTimeout(7000)
 const tourScreen=await page.locator('.u-app').getAttribute('data-screen')
 await page.getByRole('button',{name:'Rediseño 1',exact:true}).click()
 await page.getByRole('button',{name:`Rediseño ${design}`,exact:true}).click()
 check('Design switch preserves running tour screen',await page.locator('.u-app').getAttribute('data-screen')===tourScreen)
 await page.locator('.u-app[data-screen=done]').waitFor({timeout:90000})
 check('Tour reaches the paid receipt after design switch',await page.locator('.u-receipt').isVisible())
 await page.goto(base+'?screen=sale&device=windows')
 await page.getByRole('button',{name:'Rediseño 1',exact:true}).click();await shot('option1-after')
 await page.goto(base+`?screen=kitchen&role=bar&design=${design}&device=ipad&orientation=landscape&theme=dark`)
 await page.getByRole('button',{name:'Rediseño 1',exact:true}).click()
 await page.getByRole('button',{name:`Rediseño ${design}`,exact:true}).click()
 check('Switch preserves role, theme, device and orientation',await page.locator('.u-app').getAttribute('data-role')==='bar'&&await page.locator('.u-app').getAttribute('data-theme')==='dark'&&await page.locator('.study-stage').getAttribute('data-device')==='ipad'&&await page.getByRole('button',{name:'Horizontal',exact:true}).getAttribute('aria-pressed')==='true')
 check('No page errors',errors.length===0)
 }
}finally{await writeFile(`${output}/${process.argv.includes('--audit')?'audit':process.argv.includes('--matrix')?'matrix':process.argv.includes('--capture')?'capture':process.argv.includes('--baseline')?'baseline':'variant'}-results.json`,JSON.stringify({results,errors},null,2));await browser.close()}

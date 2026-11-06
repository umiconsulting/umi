import { chromium } from 'playwright-core'
import fs from 'node:fs/promises'
const base=process.env.POS_QA_URL||'http://127.0.0.1:56452/'
const out='shots/full-directions'
await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1600,height:1350}})
const metrics=[];const errors=[];page.on('pageerror',e=>errors.push(e.message))
const first=process.argv.includes('--first')
const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.split('=')[1]?.split(',')
if(process.argv.includes('--probe')){
 const checks=[]
 const check=(name,condition)=>{if(!condition)throw new Error(name);checks.push(name);console.log('PASS',name)}
 const go=async(design,screen='sale',device='windows',orientation='portrait')=>{await page.goto(`${base}?screen=${screen}&design=${design}&device=${device}&orientation=${orientation}`);await page.locator('.u-app').waitFor();await page.evaluate(()=>document.fonts.ready)}
 const switchTo=async design=>{await page.getByRole('button',{name:`Rediseño ${design}`,exact:true}).click()}
 const button=name=>page.getByRole('button',{name,exact:true})
 for(const design of ['2','3'])for(const [device,orientation] of [['windows','portrait'],['iphone','portrait'],['android','portrait'],['ipad','portrait'],['ipad','landscape'],['galaxy','portrait'],['galaxy','landscape']]){
  await go(design,'payment',device,orientation)
  const fit=await page.locator('.u-payment').evaluate(el=>{const keypad=el.querySelector('.u-keypad').getBoundingClientRect(),right=el.querySelector('.u-payment-right').getBoundingClientRect(),footer=el.querySelector('.u-payment-fixed-footer').getBoundingClientRect(),work=el.getBoundingClientRect();return{keypad:keypad.bottom<=right.bottom+1,footer:footer.bottom<=work.bottom+1,overflow:el.scrollWidth<=el.clientWidth+1}})
  check(`${design} ${device} ${orientation}: entire simple-cash keypad and confirm fit`,fit.keypad&&fit.footer&&fit.overflow)
  await go(design,'cash',device,orientation)
  if(['iphone','android'].includes(device)&&await page.getByRole('tab',{name:'Cierre',exact:true}).count())await page.getByRole('tab',{name:'Cierre',exact:true}).click()
  await button('Iniciar conteo ciego').click()
  const last=page.getByLabel('Monedas de $0.5',{exact:true});await last.fill('3')
  check(`${design} ${device} ${orientation}: last denomination reachable and decimal total`,(await page.locator('.u-count-total').innerText()).includes('$1.50'))
  check(`${design} ${device} ${orientation}: count footer inside workspace`,await page.locator('.u-count-footer').evaluate(el=>el.getBoundingClientRect().bottom<=el.closest('.u-workspace').getBoundingClientRect().bottom+1))
 }
 await go('2');await page.locator('[data-target=product-latte]').click();await page.getByLabel('Cantidad',{exact:true}).fill('3');await page.getByLabel('Nota para preparación',{exact:true}).fill('Sin azúcar')
 for(const design of ['3','1','2']){await switchTo(design);check(`${design}: modifier edit survives presentation switch`,await page.getByLabel('Cantidad',{exact:true}).inputValue()==='3'&&await page.getByLabel('Nota para preparación',{exact:true}).inputValue()==='Sin azúcar')}
 await go('2','payment');await button('Dividir el cobro').click();await page.getByLabel('Importe parcial',{exact:true}).fill('50');await button('Transferencia').click();await page.getByLabel('Folio del comprobante',{exact:true}).fill('BANK-50');await page.getByText('Confirmo que el banco recibió $50.00',{exact:true}).click()
 for(const design of ['3','1','2']){await switchTo(design);check(`${design}: partial draft and confirmation survive`,await page.getByLabel('Importe parcial',{exact:true}).inputValue()==='50'&&await page.getByLabel('Folio del comprobante',{exact:true}).inputValue()==='BANK-50'&&await page.getByRole('checkbox',{name:'Confirmo que el banco recibió $50.00'}).isChecked())}
 await page.locator('[data-target=confirm]').click()
 for(const design of ['3','1','2']){await switchTo(design);check(`${design}: recorded partial payment survives`,(await page.locator('.u-payment-left .u-total .ss-count').getAttribute('aria-label'))==='$85.00'&&await page.locator('.u-payment-ledger > div').count()===1)}
 await go('2','payment');await button('Tarjeta').click();await button('Terminal integrada').click();await page.locator('[data-target=confirm]').click();await button('Dejar de esperar').click();const attempt=await page.locator('.u-terminal-pending').innerText()
 for(const design of ['3','1','2']){await switchTo(design);check(`${design}: uncertain attempt remains locked and identical`,await page.locator('[data-target=confirm]').count()===0&&(await page.locator('.u-terminal-pending').innerText())===attempt)}
 await go('2','cash');await button('Entrada de efectivo').click();await page.getByLabel('Importe del movimiento',{exact:true}).fill('123.50');await page.getByLabel('Motivo del movimiento',{exact:true}).fill('Cambio')
 for(const design of ['3','1','2']){await switchTo(design);check(`${design}: cash movement draft survives`,await page.getByLabel('Importe del movimiento',{exact:true}).inputValue()==='123.50'&&await page.getByLabel('Motivo del movimiento',{exact:true}).inputValue()==='Cambio')}
 await button('Volver al turno').click();await button('Iniciar conteo ciego').click();await page.getByLabel('Monedas de $0.5',{exact:true}).fill('3')
 for(const design of ['3','1','2']){await switchTo(design);check(`${design}: denomination counts survive`,await page.getByLabel('Monedas de $0.5',{exact:true}).inputValue()==='3')}
 await go('2','settings');await button('Registrar dispositivo').click();await page.getByLabel('Fabricante',{exact:true}).fill('Epson');await page.getByLabel('Modelo',{exact:true}).fill('TM-T20')
 for(const design of ['3','1','2']){await switchTo(design);check(`${design}: device setup draft survives`,await page.getByLabel('Fabricante',{exact:true}).inputValue()==='Epson'&&await page.getByLabel('Modelo',{exact:true}).inputValue()==='TM-T20')}
 await go('2','tables');await button('Mesa 02').click()
 for(const design of ['3','1','2']){await switchTo(design);check(`${design}: selected table survives`,await page.locator('.u-table[data-number="2"]').getAttribute('aria-pressed')==='true')}
 await fs.writeFile(`${out}/state-geometry-probe.json`,JSON.stringify({checks,errors},null,2));await browser.close();process.exit(0)
}

for(const design of ['2','3']) for(const device of (option('devices')||(first?['windows','iphone']:['windows','iphone','android','ipad','galaxy']))) for(const theme of (option('themes')||(first?['light']:['light','dark']))) for(const orientation of (['ipad','galaxy'].includes(device)?['portrait','landscape']:['portrait'])) {
 for(const state of (option('states')||(first?['sale','modifiers','payment','done']:['sale','modifiers','payment','done','incoming','tables','kitchen','cash','count','settings','partial','unknown']))) {
 const screen=state==='modifiers'?'sale':state==='count'?'cash':['partial','unknown'].includes(state)?'payment':state
 await page.goto(`${base}?screen=${screen}&design=${design}&device=${device}&orientation=${orientation}&theme=${theme}${state==='kitchen'?'&role=bar':''}`)
 await page.locator('.u-app').waitFor();await page.evaluate(()=>document.fonts.ready)
 if(state==='modifiers')await page.locator('[data-target=product-latte]').click()
 if(state==='sale'&&['iphone','android'].includes(device))await page.locator('.u-mobile-cart.u-primary').click()
 if(state==='count'){if(['iphone','android'].includes(device)&&await page.getByRole('tab',{name:'Cierre',exact:true}).count())await page.getByRole('tab',{name:'Cierre',exact:true}).click();await page.getByRole('button',{name:'Iniciar conteo ciego',exact:true}).click()}
 if(state==='partial'){await page.getByRole('button',{name:'Dividir el cobro',exact:true}).click();await page.getByLabel('Importe parcial',{exact:true}).fill('50');await page.getByLabel('Efectivo recibido',{exact:true}).fill('100');await page.locator('[data-target=confirm]').click()}
 if(state==='unknown'){await page.getByRole('button',{name:'Tarjeta',exact:true}).click();await page.getByRole('button',{name:'Terminal integrada',exact:true}).click();await page.locator('[data-target=confirm]').click();await page.getByRole('button',{name:'Dejar de esperar',exact:true}).click()}
 await page.waitForTimeout(200)
 const name=`${design}-${device}-${orientation}-${theme}-${state}`
 const geometry=await page.locator('.u-app').evaluate(app=>{const ar=app.getBoundingClientRect();const band=app.querySelector('.u-payment-fixed-footer .u-change');const label=band?.querySelector(':scope > span')?.getBoundingClientRect(),amount=band?.querySelector(':scope > strong')?.getBoundingClientRect();return {changeBand:label&&amount?{width:band.getBoundingClientRect().width,labelRight:label.right,amountLeft:amount.left,gap:amount.left-label.right}:null,width:ar.width,height:ar.height,overflow:app.scrollWidth-app.clientWidth,footers:[...app.querySelectorAll('.u-payment-fixed-footer,.u-count-footer,.u-editor-footer')].filter(el=>el.getBoundingClientRect().height&& !el.closest('[aria-hidden=true]')).map(el=>{const r=el.getBoundingClientRect();return {bottom:r.bottom-ar.bottom,width:r.width,height:r.height}})}});metrics.push({name,...geometry});
 if(first || option('states') || device==='windows'&&theme==='light' || device==='iphone'&&theme==='dark' || ['ipad','galaxy'].includes(device)&&theme==='dark'&&['payment','count','tables'].includes(state))await page.locator('.u-app').screenshot({path:`${out}/${name}.png`})
 console.log(name)
 }
}
await fs.writeFile(`${out}/${first?'first':option('states')?'fit':'matrix'}-errors.json`,JSON.stringify(errors,null,2))
await fs.writeFile(`${out}/${first?'first':option('states')?'fit':'matrix'}-metrics.json`,JSON.stringify(metrics,null,2))
await browser.close()

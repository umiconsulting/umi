import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
const root='http://127.0.0.1:56450'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const errors=[],checks=[],shots='shots'
mkdirSync(shots,{recursive:true})
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1})
page.on('pageerror',e=>errors.push(e.message))
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning'&&/target|missing|failed/i.test(m.text()))errors.push(m.text())})
const assert=(v,message)=>{if(!v)throw new Error(message);checks.push(message)}
const pause=async()=>{
 await page.getByRole('button',{name:'Pausar',exact:true}).click()
 await page.waitForTimeout(180)
}
if(process.argv.includes('--review')){
 try{
  for(const chapter of ['config','accept','kitchen']){
   await page.goto(root+'/?capture=umi-flow&chapter='+chapter+'&mode=pickup&still=1')
   await page.locator('.ss-stage[data-still]').waitFor()
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200)
   await page.locator('#example').screenshot({path:shots+'/desktop-'+chapter+'.png'})
   if(chapter==='config')console.log('Sidebar',await page.locator('.side-item').first().evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color})))
   if(chapter==='accept')assert(await page.getByText('Rechazar',{exact:true}).count()===0,'Accepted order has no pending rejection action.')
  }
  await page.setViewportSize({width:390,height:1000})
  for(const chapter of ['config','kitchen']){
   await page.goto(root+'/?capture=umi-flow&chapter='+chapter+'&mode=scheduled&still=1')
   await page.locator('.ss-stage[data-still]').waitFor()
   await page.waitForTimeout(250)
   await page.locator('#example').screenshot({path:shots+'/mobile-'+chapter+'.png'})
  }
  await page.goto(root+'/?chapter=kitchen&mode=scheduled')
  await page.getByLabel('Velocidad').selectOption('2')
  const scene=page.frameLocator('iframe')
  await scene.locator('.ss-stage[data-mark="fin"]').waitFor({timeout:30000})
  const bounds=await scene.locator('.native-ticket:last-child .native-button').last().boundingBox()
  const nav=await scene.locator('.native-bottom').boundingBox()
  assert(bounds.y+bounds.height<=nav.y,'Final station action is above mobile navigation.')
  await page.screenshot({path:shots+'/host-mobile.png',fullPage:true})
  await page.goto(root+'/?chapter=menu&mode=pickup')
  await page.getByLabel('Velocidad').selectOption('2')
  await page.frameLocator('iframe').locator('.ss-stage[data-mark="fin"]').waitFor({timeout:35000})
  const menu=page.frames().find(f=>f.url().endsWith('/reference/menu.html'))
  assert(await menu.locator('#cart-dialog').isVisible(),'Mobile product selection reaches the approved cart.')
  if(errors.length)throw new Error(errors.join('\n'))
  writeFileSync(shots+'/fidelity-review.json',JSON.stringify({checks,errors},null,2))
  console.log(JSON.stringify({checks,errors},null,2))
 }finally{await browser.close()}
 process.exit(0)
}
try {
 await page.goto(root+'/?chapter=menu&mode=pickup')
 await pause()
 const frame=page.frames().find(f=>f.url().includes('embed='))
 const before=await frame.evaluate(()=>window.__stageshow.clock.now())
 await page.waitForTimeout(350)
 const after=await frame.evaluate(()=>window.__stageshow.clock.now())
 assert(Math.abs(before-after)<1,'Pause freezes the scene clock.')
 await page.screenshot({path:shots+'/host-menu-reference.png',fullPage:true})
 await page.getByLabel('Velocidad').selectOption('2')
 await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await frame.locator('.ss-stage[data-mark="fin"]').waitFor({timeout:35000})
 let menu=page.frames().find(f=>f.url().endsWith('/reference/menu.html'))
 assert(await menu.locator('#cart-dialog').isVisible(),'Menu reaches the original cart dialog.')
 assert((await menu.locator('#cart-dialog').innerText()).includes('$210'),'Original product prices produce $210.')
 await page.getByRole('button',{name:'Repetir escena'}).click()
 await page.frameLocator('iframe').locator('.ss-stage[data-mark="inicio"]').waitFor()
 checks.push('Replay returns to the opening beat.')
 for(const [chapter,mode,cancel] of [
  ['config','pickup'],['send','pickup'],['accept','pickup'],['kitchen','pickup'],['notify','pickup'],['pay','pickup'],['cancel','pickup'],
  ['send','table'],['accept','table'],['accept','scheduled'],['kitchen','scheduled'],['cancel','pickup','accepted'],['cancel','scheduled','accepted'],['cancel','table','preparing']
 ]) {
  await page.goto(root+'/?chapter='+chapter+'&mode='+mode)
  await page.getByLabel('Velocidad').selectOption('2')
  if(cancel&&mode!=='table')await page.getByLabel('Estado al cancelar').selectOption(cancel)
  const stage=page.frameLocator('iframe')
  await stage.locator('.ss-stage[data-mark="fin"]').waitFor({timeout:30000})
  if(chapter==='accept')assert(await stage.getByText(mode==='table'?'Ya se envió a cocina y barra.':mode==='scheduled'?'Horario reservado. Se enviará a preparación a las 17:10.':'Pedido aceptado. Cocina y barra pueden prepararlo.',{exact:true}).isVisible(),'Acceptance rule: '+mode)
  if(chapter==='kitchen')assert(await stage.getByText('Pedido #1042 listo para entregar.',{exact:true}).isVisible(),'Both stations finish: '+mode)
  if(chapter==='pay')assert(await stage.getByText('Entregado',{exact:true}).last().isVisible(),'Payment reaches delivery.')
  if(chapter==='send'){
   menu=page.frames().find(f=>f.url().endsWith('/reference/menu.html'))
   assert(await menu.locator('#status-dialog-title').textContent()===(mode==='table'?'En preparación':'Pedido recibido'),'Customer tracking after sending: '+mode)
  }
  if(chapter==='cancel') {
   menu=page.frames().find(f=>f.url().endsWith('/reference/menu.html'))
   assert(await menu.locator('#status-dialog-title').textContent()==='Pedido cancelado','Cancellation result: '+mode+'/'+(cancel||'pending'))
  }
  if(mode==='pickup')await page.screenshot({path:shots+'/host-'+chapter+'.png',fullPage:true})
  checks.push('Animated chapter completed: '+mode+'/'+chapter)
 }
 for(const mode of ['pickup','table','scheduled']){
  for(const chapter of ['config','menu','send','accept','kitchen','notify','pay','cancel']){
   await page.goto(root+'/?capture=umi-flow&chapter='+chapter+'&mode='+mode+'&still=1')
   await page.locator('.ss-stage[data-still]').waitFor()
   if(await page.locator('.approved-menu').count())await page.frameLocator('iframe').locator('#cart-dialog[open],#status-dialog[open]').waitFor()
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150)
   assert(await page.locator('#example').isVisible(),'Poster: '+mode+'/'+chapter)
   if(mode==='pickup')await page.locator('#example').screenshot({path:shots+'/desktop-'+chapter+'.png'})
  }
 }
 await page.setViewportSize({width:390,height:1000})
 for(const chapter of ['config','menu','send','accept','kitchen','notify','pay','cancel']){
  await page.goto(root+'/?capture=umi-flow&chapter='+chapter+'&mode=scheduled&still=1')
  await page.locator('.ss-stage[data-layout="compact"]').waitFor()
  if(await page.locator('.approved-menu').count())await page.frameLocator('iframe').locator('#cart-dialog[open],#status-dialog[open]').waitFor()
  await page.waitForTimeout(200)
  await page.locator('#example').screenshot({path:shots+'/mobile-'+chapter+'.png'})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=390),'No mobile overflow: '+chapter)
 }
 await page.goto(root+'/?chapter=kitchen&mode=scheduled')
 await page.getByLabel('Velocidad').selectOption('2')
 await page.frameLocator('iframe').locator('.ss-stage[data-mark="fin"]').waitFor({timeout:30000})
 await page.screenshot({path:shots+'/host-mobile.png',fullPage:true})
 assert(await page.locator('[aria-current="step"]').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),'Selected mobile chapter is visible.')
 if(errors.length)throw new Error(errors.join('\n'))
 writeFileSync(shots+'/qa.json',JSON.stringify({checks,errors},null,2))
 console.log(JSON.stringify({passed:checks.length,errors,screenshots:shots},null,2))
}finally{await browser.close()}

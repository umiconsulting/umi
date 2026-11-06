import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const out='shots/incoming3-followup'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1600,height:1400}})
const errors=[],results=[]
page.on('pageerror',error=>errors.push(error.message))
const first=process.argv.includes('--first')
const formats=[['windows','portrait'],['iphone','portrait'],['android','portrait'],['ipad','portrait'],['ipad','landscape'],['galaxy','portrait'],['galaxy','landscape']]
const cases=first?[['windows','portrait','light'],['iphone','portrait','dark'],['ipad','portrait','light']]:formats.flatMap(([d,o])=>['light','dark'].map(t=>[d,o,t]))
try{
for(const [device,orientation,theme] of cases){
 const name=`${device}-${orientation}-${theme}`
 await page.goto(`http://127.0.0.1:56452/?screen=incoming&design=3&device=${device}&orientation=${orientation}&theme=${theme}`)
 await page.locator('.u-incoming3-document').waitFor();await page.evaluate(()=>document.fonts.ready)
 await page.locator('.u-app').screenshot({path:`${out}/${name}-pending.png`})
 if(first){console.log('CAPTURE',name);continue}
 assert.equal(await page.locator('[data-target=accept-order]').count(),1)
 assert.equal(await page.getByText('Lucía Hernández',{exact:true}).count(),1)
 const metrics=await page.locator('.u-incoming3').evaluate(el=>{const app=el.closest('.u-app'),action=el.querySelector('[data-target=accept-order]'),rows=[...el.querySelectorAll('.u-incoming3-product')];const rr=el.getBoundingClientRect(),ar=action.getBoundingClientRect(),scale=app.getBoundingClientRect().width/app.offsetWidth;return {appOverflow:app.scrollWidth-app.clientWidth,documentOverflow:el.scrollWidth-el.clientWidth,actionInitiallyVisible:ar.bottom<=rr.bottom+1,actionHeight:ar.height/scale,rows:rows.map(row=>{const cells=row.children,q=cells[0].getBoundingClientRect(),p=cells[1].getBoundingClientRect(),v=cells[2].getBoundingClientRect();return{quantityProductGap:p.left-q.right,productAmountGap:v.left-p.right}})}})
 assert.ok(metrics.appOverflow<=1&&metrics.documentOverflow<=1,name+' contained')
 assert.ok(metrics.actionHeight>=44,name+' touch action')
 assert.ok(metrics.rows.every(r=>r.quantityProductGap>=7&&r.productAmountGap>=7),name+' columns separate')
 await page.locator('[data-target=accept-order]').scrollIntoViewIfNeeded()
 const reachable=await page.locator('[data-target=accept-order]').evaluate(el=>{const r=el.getBoundingClientRect(),work=el.closest('.u-incoming3').getBoundingClientRect();return r.top>=work.top&&r.bottom<=work.bottom+1})
 assert.ok(reachable,name+' attend reachable')
 await page.locator('[data-target=accept-order]').click()
 assert.equal(await page.locator('.u-app').getAttribute('data-screen'),'sale')
 await page.locator('.u-rail').getByRole('button',{name:'Pedidos',exact:true}).click()
 assert.equal(await page.locator('.u-incoming3-empty').count(),1)
 assert.equal(await page.locator('.u-incoming3-document,[data-target=accept-order]').count(),0)
 await page.locator('.u-app').screenshot({path:`${out}/${name}-empty.png`})
 await page.getByRole('button',{name:'Ver cuenta',exact:true}).click()
 if(['iphone','android'].includes(device)&&await page.locator('.u-mobile-cart.u-primary').isVisible())await page.locator('.u-mobile-cart.u-primary').click()
 assert.ok((await page.locator('.u-account-head').innerText()).includes('043'))
 results.push({name,...metrics,attendReachable:reachable,emptyState:true,resumedAccount:'043'})
 console.log('PASS',name)
}
assert.deepEqual(errors,[])
await writeFile(`${out}/${first?'first-captures':'focused-qa'}.json`,JSON.stringify({results,errors},null,2))
}finally{await browser.close()}

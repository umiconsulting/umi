import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
try {
 const page=await browser.newPage()
 const failures=[]
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1200})
  await page.goto('http://127.0.0.1:56452/?screen=payment')
  await page.locator('[data-target=confirm]').waitFor()
  await page.evaluate(()=>document.fonts.ready)
  await page.locator('.u-payment').evaluate(root=>Promise.allSettled(root.getAnimations().map(animation=>animation.finished)))
  await page.locator('.study-stage').evaluate(stage=>stage.scrollIntoView({block:'end'}))
  const geometry=await page.locator('.u-payment').evaluate(root=>{
   const target=root.querySelector('[data-target=confirm]'),button=target.getBoundingClientRect()
   const fields=root.querySelector('.u-payment-right').getBoundingClientRect(),footer=root.querySelector('.u-payment-fixed-footer').getBoundingClientRect()
   const app=root.closest('.u-app'),appBounds=app.getBoundingClientRect(),workspace=root.closest('.u-workspace').getBoundingClientRect()
   let visibleTop=Math.max(appBounds.top,workspace.top),visibleBottom=Math.min(appBounds.bottom,workspace.bottom)
   for(let ancestor=root.parentElement;ancestor;ancestor=ancestor.parentElement){
    if(['hidden','clip','auto','scroll'].includes(getComputedStyle(ancestor).overflowY)){
     const rect=ancestor.getBoundingClientRect();visibleTop=Math.max(visibleTop,rect.top);visibleBottom=Math.min(visibleBottom,rect.bottom)
    }
   }
   const rail=app.querySelector('.u-rail')?.getBoundingClientRect()
   if(rail&&rail.width>appBounds.width*.8)visibleBottom=Math.min(visibleBottom,rail.top)
   const hit=document.elementFromPoint(button.x+button.width/2,button.y+button.height/2)
   const lastKeyBottom=root.querySelector('.u-keypad button:last-child').getBoundingClientRect().bottom
   return {visibleTop,visibleBottom,fieldsTop:fields.top,fieldsBottom:fields.bottom,footerTop:footer.top,footerBottom:footer.bottom,buttonTop:button.top,buttonBottom:button.bottom,lastKeyBottom,gap:visibleBottom-button.bottom,hit:Boolean(hit&&(hit===target||target.contains(hit)))}
  })
  if(geometry.gap<12||geometry.buttonTop<geometry.visibleTop||geometry.footerTop<geometry.fieldsBottom-1||geometry.footerBottom>geometry.visibleBottom+1||!geometry.hit)failures.push({width,...geometry})
  if(width===1440&&geometry.lastKeyBottom>geometry.fieldsBottom-4)failures.push({width,reason:'El teclado de escritorio debe verse completo al abrir',...geometry})
  console.log('CHECK',width,'pie debajo de campos y dentro del área visible',geometry)
  await page.locator('.study-stage').screenshot({path:`shots/payment-${width}.png`})
  await page.locator('.u-keypad button').last().scrollIntoViewIfNeeded()
  const scrollCheck=await page.locator('.u-payment').evaluate(root=>{
   const button=root.querySelector('[data-target=confirm]').getBoundingClientRect(),last=root.querySelector('.u-keypad button:last-child'),key=last.getBoundingClientRect()
   const hit=document.elementFromPoint(key.x+key.width/2,key.y+key.height/2)
   return {buttonBottom:button.bottom,lastKeyReceivesPointer:Boolean(hit&&(hit===last||last.contains(hit)))}
  })
  if(Math.abs(scrollCheck.buttonBottom-geometry.buttonBottom)>1||!scrollCheck.lastKeyReceivesPointer)failures.push({width,reason:'El teclado no se puede recorrer conservando el pie fijo',...scrollCheck})
  await page.locator('[data-target=cash-200]').click()
  await page.waitForTimeout(350)
  await page.locator('.study-stage').screenshot({path:`shots/cash-ready-${width}.png`})
  await page.getByRole('button',{name:'Tarjeta',exact:true}).click()
  await page.waitForTimeout(300)
  await page.locator('.study-stage').screenshot({path:`shots/card-${width}.png`})
 }
 assert.equal(failures.length,0,JSON.stringify(failures))
} finally {await browser.close()}

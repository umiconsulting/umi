import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { clickSelectTrigger } from './select-qa.mjs'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1600}}),results=[],errors=[]
page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const button=name=>page.getByRole('button',{name,exact:true})
const open=async(view,device='iphone')=>{await page.goto(`http://127.0.0.1:56452/?app=dashboard&view=${view}&device=${device}&access=platform`);await page.locator('.d-app').waitFor()}
const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);await page.locator('.study-stage').screenshot({path:`shots/dashboard-mobile-${name}.png`})}
try{
 await open('overview')
 const views=await page.evaluate(async()=>{const m=await import('/src/dashboard/data.ts');return m.allViews.map(v=>({id:v.id,action:v.action,fields:v.fields}))})
 for(const device of ['iphone','android']){
  for(const view of views){await open(view.id,device);check(`${device}/${view.id}: ancho correcto`,await page.locator('.d-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1));if(view.action&&await button(view.action).count()){await button(view.action).click();check(`${device}/${view.id}: acción accesible`,await page.locator('.d-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1))}}
  await open('floor',device)
  check(`${device}: seis mesas completas`,await page.locator('.d-floor-map').evaluate(root=>{const r=root.getBoundingClientRect();const tables=[...root.querySelectorAll('.d-floor-table')];return tables.length===6&&tables.every(el=>{const t=el.getBoundingClientRect();return t.left>=r.left&&t.right<=r.right+1&&t.top>=r.top&&t.bottom<=r.bottom+1})}))
  await shot(`${device}-floor`)
  await open('business',device);await clickSelectTrigger(page,page.getByRole('button',{name:/Sección de ajustes/}));await shot(`${device}-section-menu`)
  check(`${device}: selector completo dentro del dispositivo`,await page.getByRole('listbox').evaluate(el=>{const r=el.getBoundingClientRect(),a=document.querySelector('.u-device-content').getBoundingClientRect();return r.left>=a.left-1&&r.right<=a.right+1&&r.bottom<=a.bottom+1}))
  await page.getByRole('option',{name:'Promoción',exact:true}).click();check(`${device}: cambia de sección`,await page.locator('.d-app').getAttribute('data-view')==='promotion')
  await shot(`${device}-promotion`)
  await button('Abrir menú').click();await shot(`${device}-navigation`)
  await page.locator('[data-target=d-nav-inventory]').click();await page.locator('[data-target=d-subnav-items]').click()
  await button('Contar existencias').click();await button('Comenzar conteo').click()
  check(`${device}: conteo ciego no muestra el esperado`,!await page.locator('.d-count-items').innerText().then(text=>text.includes('8.40')));
  for(const [name,value] of [['Café de la casa','8.4'],['Harina de fuerza','18'],['Leche deslactosada','2.5']])await page.getByRole('textbox',{name:`Cantidad de ${name}`,exact:true}).fill(value)
  await button('Revisar diferencias').click();check(`${device}: artículos omitidos permanecen sin contar`,await page.getByText('Sin contar',{exact:true}).count()>0);check(`${device}: diferencias del conteo`,await page.getByText('-0.5 L',{exact:true}).isVisible())
  await page.getByRole('textbox',{name:/Motivo de las diferencias/}).fill('Merma de la mañana');await button('Confirmar conteo de ejemplo').click();check(`${device}: conteo completo`,await page.getByRole('heading',{name:'Conteo registrado en el ejemplo'}).isVisible());await shot(`${device}-count`);await page.locator('.d-back').click();check(`${device}: conteo actualiza el artículo`,await page.locator('.d-mobile-records > button').filter({hasText:'Leche deslactosada'}).innerText().then(text=>text.includes('2.5 L')));await page.evaluate(()=>{sessionStorage.removeItem('umi-dashboard-demo-records')})
 }
 check('Sin errores de navegador móvil',errors.length===0)
 await writeFile('shots/dashboard-mobile-qa.json',JSON.stringify({results,errors},null,2))
}finally{await browser.close()}

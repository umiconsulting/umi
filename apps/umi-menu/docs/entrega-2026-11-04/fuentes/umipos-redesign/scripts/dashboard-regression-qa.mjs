import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile, readFile } from 'node:fs/promises'
import { clickSelectTrigger } from './select-qa.mjs'
const browser=await chromium.launch({executablePath:'/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:1750}}),results=[],errors=[]
page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name)}
const button=name=>page.getByRole('button',{name,exact:true})
const open=async view=>{await page.goto(`http://127.0.0.1:56452/?app=dashboard&view=${view}`);await page.locator('.d-app').waitFor()}
const confirm=async()=>{await button('Revisar').click();await button('Confirmar en la demo').click()}
const back=()=>page.locator('.d-back').click()
const pick=async(label,value)=>{
 const trigger=page.getByRole('button',{name:new RegExp(label)});await clickSelectTrigger(page,trigger)
 await page.getByRole('option',{name:value,exact:true}).click()
}
try{
 await open('registers');const count=await page.locator('.d-table tbody tr').count();await button('Configurar cobro').click();await confirm()
 check('Configurar cobro identifica simulación',await page.getByRole('heading',{name:'Simulación completada'}).isVisible());await back()
 check('Configurar cobro conserva los registros',await page.locator('.d-table tbody tr').count()===count)
 await open('team');await page.locator('.d-table tbody tr').filter({hasText:'Sofía Martínez'}).click()
 check('Owner no permite editar ni asignar PIN',await button('Editar persona').count()===0&&await button('Asignar PIN').count()===0);await back()
 await button('Añadir persona').click();await page.getByRole('textbox',{name:/Nombre completo/}).fill('Persona QA');await page.getByRole('textbox',{name:/Correo/}).fill('qa@example.com');await page.getByLabel('Asignar nuevo PIN',{exact:true}).fill('246810');await page.getByLabel('Confirmar el PIN',{exact:true}).fill('246800');await button('Revisar').click();check('PIN exige confirmación igual',await page.getByRole('alert').innerText().then(text=>text.includes('coincidir')));await page.getByLabel('Confirmar el PIN',{exact:true}).fill('246810');await button('Revisar').click()
 check('PIN de alta oculto en revisión',!await page.locator('.d-review').innerText().then(t=>t.includes('246810')))
 await button('Confirmar en la demo').click();await back();const person=page.locator('.d-table tbody tr').filter({hasText:'Persona QA'}),cells=await person.locator('td').allTextContents()
 check('PIN no se guarda en el almacenamiento del ejemplo',!await page.evaluate(()=>JSON.stringify(sessionStorage).includes('246810')));
 check('Alta se guarda al confirmar aunque vuelva por arriba',await person.count()===1)
 check('Alta coloca rol y sucursal en su columna',cells[1]==='Cajero'&&cells[2]==='ONCA · Centro'&&cells[3]==='Habilitado')
 await person.click();await button('Editar persona').click();check('Correo del alta conservado al editar',await page.getByRole('textbox',{name:/Correo/}).inputValue()==='qa@example.com')
 await pick('Acceso al POS','No');await confirm();await back();check('Editar acceso actualiza lista',(await page.locator('.d-table tbody tr').filter({hasText:'Persona QA'}).innerText()).includes('Deshabilitado'))
 await open('products');await page.locator('.d-table tbody tr').filter({hasText:'Latte'}).first().click();await button('Editar producto').click();await pick('Disponibilidad','Agotado');await page.getByRole('textbox',{name:'Opción 1.3',exact:true}).fill('Avena QA');await page.getByRole('spinbutton',{name:'Ajuste de variante 2 (MXN)',exact:true}).fill('20');await confirm()
 await page.getByRole('link',{name:'Resumen',exact:true}).click();const productsNav=page.locator('[data-target=d-nav-products]');if(await productsNav.getAttribute('aria-expanded')!=='true')await productsNav.click();await page.locator('[data-target=d-subnav-products]').click()
 const latte=page.locator('.d-table tbody tr').filter({hasText:'Latte'}).first()
 check('Confirmación persiste al cambiar de módulo',await latte.innerText().then(t=>t.includes('Agotado')))
 check('Estado de producto usa señal pendiente',await latte.locator('.d-status').getAttribute('data-status')==='pending')
 await latte.click();check('Detalle refleja disponibilidad editada',await page.locator('.d-detail-line').filter({hasText:'Centro'}).innerText().then(t=>t.includes('Agotado')));await button('Editar producto').click()
 check('Modificadores conservados al reabrir',await page.getByRole('textbox',{name:'Opción 1.3',exact:true}).inputValue()==='Avena QA'&&await page.getByRole('spinbutton',{name:'Ajuste de variante 2 (MXN)',exact:true}).inputValue()==='20')
 await open('locations');await button('Nueva sucursal').click();await page.getByRole('textbox',{name:/Nombre de la sucursal/}).fill('Sur');await page.getByRole('textbox',{name:/Dirección/}).fill('Av. del Mar 10');await page.getByRole('spinbutton',{name:'Latitud',exact:true}).fill('23.2');await page.getByRole('spinbutton',{name:'Longitud',exact:true}).fill('-106.4');await confirm();await back()
 check('Sucursal admite longitud negativa',await page.locator('.d-table tbody tr').filter({hasText:'Sur'}).count()===1)
 await open('sales');await pick('Periodo del reporte','7 días')
 const money=s=>Number(s.replace(/[^0-9.]/g,''));const summary=money(await page.locator('.d-sales-summary strong').first().innerText()),table=await page.locator('.d-table tbody tr').evaluateAll(rows=>rows.reduce((sum,row)=>sum+Number(row.querySelectorAll('td')[2].textContent.replace(/[^0-9.]/g,'')),0))
 check('Periodo comparte importe entre resumen y desglose',summary===table&&summary===47880)
 const downloaded=page.waitForEvent('download');await button('Exportar').click();const file=await downloaded,csv=await readFile(await file.path(),'utf8')
 check('CSV respeta el periodo visible',csv.includes('$14,490.00')&&csv.includes('168'))
 await open('routes');await page.locator('.d-table tbody tr').filter({hasText:'Pizza margarita'}).click();await button('Editar ruta').click()
 check('Editar ruta precarga tipo producto y objetivo original',await page.getByRole('button',{name:/Tipo de ruta/}).innerText().then(text=>text.includes('Producto'))&&await page.getByRole('spinbutton',{name:'Tiempo objetivo (minutos)',exact:true}).inputValue()==='12')
 await confirm();await back();check('Guardar ruta sin cambios conserva destino y tiempo',await page.locator('.d-table tbody tr').filter({hasText:'Pizza margarita'}).innerText().then(text=>text.includes('Horno')&&text.includes('12 min')))
 await open('devices');await page.locator('.d-table tbody tr').filter({hasText:'KDS Barra'}).click();await button('Editar dispositivo').click()
 check('Editar KDS precarga producto plataforma y estación',await page.locator('.d-edit-form').getByRole('button',{name:/Producto/}).innerText().then(text=>text.includes('KDS'))&&await page.locator('.d-edit-form').getByRole('button',{name:/Plataforma/}).innerText().then(text=>text.includes('Android'))&&await page.locator('.d-edit-form').getByRole('button',{name:/Estación/}).innerText().then(text=>text.includes('Barra')))
 await page.getByRole('textbox',{name:'Nombre del equipo',exact:true}).fill('KDS Barra QA');await confirm();await back();await page.locator('.d-table tbody tr').filter({hasText:'KDS Barra QA'}).click();await button('Editar dispositivo').click()
 check('Renombrar KDS conserva configuración al reabrir',await page.locator('.d-edit-form').getByRole('button',{name:/Producto/}).innerText().then(text=>text.includes('KDS'))&&await page.locator('.d-edit-form').getByRole('button',{name:/Estación/}).innerText().then(text=>text.includes('Barra')))
 check('Sin errores de navegador',errors.length===0);await writeFile('shots/dashboard-regression-qa.json',JSON.stringify({results,errors},null,2))
}finally{await browser.close()}

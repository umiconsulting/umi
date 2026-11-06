import { useEffect, useState, useMemo, useCallback, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Stage, Row, Count, Collapse, Roll, type Act } from '../kit'
import { ShoppingBag, LayoutGrid, Inbox, ChefHat, Wallet, Search, Plus, ArrowRight, ArrowLeft, Check, X, Minus, Users, Clock3, Wifi, ChevronDown, Coffee, Croissant, Pizza, Utensils, CreditCard, Banknote, Printer, Play, RotateCcw, Sun, Moon, CheckCircle2, Bell, CircleHelp, SlidersHorizontal, List, Map, Send, Table2, ReceiptText, PanelLeftOpen, PanelLeftClose, Settings as SettingsIcon, Monitor, Smartphone } from 'lucide-react'
import Gold from '../examples/table-edit'
import './style.css'
import './catalog.css'
import './floor-plan.css'
import './sale-layout.css'
import './product-options.css'
import './access.css'
import './boardui.css'
import { DirectionProvider } from '@/components/foundations/direction/direction'

import { demoPin, lockScene, initial, incomingScene, completedScene, latte, concha, kitchenCopy, accountId, orderIdentity, customerNote, roleName, flowName, sceneForFlow, resultForFlow, stationItems, type OrderFlow, type Role, type Scene, type Screen } from './order'
import { Kitchen, ServiceTag, stationLabel } from './Kitchen'
import { Payment } from './Payment'
import { TableIdentity } from './TableIdentity'
import { PosTables } from './PosTables'
import { IncomingOrder3 } from './IncomingOrder3'
import { PosReceipt, SentLineCancellation, voidReasons } from './PosOrderDetails'
import { acceptIncoming, accountList, addOrderItem, applyCashPostings, adjustItem, balanceDue, cashPostings, deliverRounds, lineIsSent, newAccount, orderTotal, paidPrincipal, paymentPending, pendingItems, resumeAccount, sendRound, snapshot, tipsPaid, type Item } from './order'
import { RiAddLine, RiSubtractLine, RiRepeatLine, RiCloseLine } from '@remixicon/react'
import { cx } from '@/utils/cx'
import { FloorPlan } from './FloorPlan'
import { ProductOptions } from './ProductOptions'
import { Login } from './Login'
import { Settings, initialSettings } from './Settings'
import './settings.css'
import { Cash, initialCash } from './Cash'
import { blindCashPolicy, visibleCashPolicy } from './CashCount'
import './cash.css'
import { DeviceFrame, DevicePicker, deviceFormat, devices, type Device, type Orientation } from './DevicePreview'
import './device-preview.css'
import './tablet-portrait.css'
import DashboardShow from './dashboard/DashboardShow'
import { modules as demoModules } from './dashboard/data'
import DigitalMenu from './DigitalMenu'
import DigitalMenuShow from './DigitalMenuShow'
import { PreviewChoices } from './PreviewChoices'
import MenuStaffPreview from './MenuStaffPreview'
import './interface-system.css'
import './pos-operations.css'
import './redesign-option2.css'
import './redesign-compositions.css'
import './full-directions.css'
import { Input } from '@/components/base/input/input'
import { ScrollFade, useScrollFade } from '@/components/foundations/scroll-fade/scroll-fade'
import { Button as BoardButton } from '@/components/base/buttons/button'
import { Badge } from '@/components/base/badges/badge'

const products = [
  {id:'latte',name:'Latte',price:80,category:'Bebidas',detail:'Elige presentación'},
  {id:'americano',name:'Americano',price:50,category:'Bebidas',detail:'Espresso + agua'},
  {id:'capuccino',name:'Capuccino',price:60,category:'Bebidas',detail:'Espuma de leche'},
  {id:'aeropress',name:'Aeropress',price:80,category:'Bebidas',detail:'Café de especialidad'},
  {id:'amanecer',name:'Amanecer',price:90,category:'Bebidas',detail:'Café de la casa'},
  {id:'limon',name:'Americano limón',price:90,category:'Bebidas',detail:'Con agua mineral'},
  {...concha,detail:'Vainilla o chocolate'},
  {id:'barra',name:'Barra de masa madre',price:130,category:'Pan',detail:'Horneada hoy'},
  {id:'pack',name:'Burgir pack',price:65,category:'Pan',detail:'Pan de la casa'},
  {id:'pizza',name:'Pizza margarita',price:190,category:'Pizzas',detail:'Salsa · mozzarella'},
  {id:'focaccia',name:'Focaccia',price:85,category:'Pan',detail:'Romero · aceite de oliva'},
  {id:'agua',name:'Agua mineral',price:35,category:'Bebidas',detail:'355 ml'},
]
const favoriteProductIds=['latte','concha','americano','capuccino']
// Illustrative sales already shown in the demo dashboard; fixed for this session.
// Filtering or adding items must not change which product IDs receive emphasis.
const mostOrderedProductIds = new Set((demoModules.find(module=>module.id==='reports')?.views.find(view=>view.id==='sales')?.rows ?? [])
  .map(entry=>({id:products.find(product=>product.name===entry.name)?.id,units:Number(entry.cells[0])}))
  .filter((entry):entry is {id:string;units:number}=>Boolean(entry.id)&&Number.isFinite(entry.units)&&entry.units>0)
  .sort((a,b)=>b.units-a.units)
  .slice(0,3).map(entry=>entry.id))
const productPhotos:Record<string,string>=Object.fromEntries(products.map(product=>[product.id,`/products/${product.id}.jpg`]))
const money = (n: number) => '$' + n.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})
const totalOf = orderTotal
const label:Record<Screen,string>={login:'Acceso',settings:'Configuración',sale:'Venta',tables:'Cuentas',incoming:'Pedidos entrantes',kitchen:'Cocina',cash:'Turno de caja',payment:'Cobrar cuenta',done:'Cobro completado'}
const seedFor = (screen:Screen):Scene => screen === 'incoming' ? incomingScene : screen === 'done' ? completedScene : ({...initial,screen,role:screen==='kitchen'?'bar':'cashier',kitchen:screen === 'kitchen' ? 'sent' : screen === 'payment' ? 'preparing' : 'draft',stations:screen==='payment'?{bar:'preparing',kitchen:'preparing'}:initial.stations})

async function story(a:Act<Scene>, flow:OrderFlow) {
  a.mark('acceso'); await a.wait(900)
  let pin=''
  for(const digit of demoPin.cashier){await a.click({at:`pin-${digit}`,x:.5,y:.5});pin+=digit;a.put({pin});await a.wait(180)}
  await a.click({at:'login-submit',x:.8,y:.5});a.put({screen:flow==='digital'?'incoming':'sale',pin:''});await a.wait(500)
  if(flow==='digital'){
    a.mark('recepcion'); await a.wait(1600)
    await a.click({at:'accept-order',x:.8,y:.5}); a.put({screen:'sale',incoming:false,ticket:true})
  }else{
    a.mark('tomar-pedido'); await a.wait(1100)
    await a.click({at:'product-latte',x:.85,y:.65}); a.put({editing:true}); a.mark('personalizar'); await a.wait(700)
    await a.click({at:'size-nube',x:.9,y:.5}); a.put({size:'Nube'}); await a.wait(300)
    await a.click({at:'milk',x:.9,y:.5}); a.put({milk:'Deslactosada'}); await a.wait(400)
    await a.click({at:'add-product',x:.8,y:.5}); a.put({editing:false,items:[latte,concha],ticket:true})
  }
  a.mark('cuenta'); await a.wait(1600)
  await a.click({at:'send',x:.8,y:.5}); a.put({kitchen:'sent'}); a.mark('enviada'); await a.wait(1100)
  a.put({role:'bar',screen:'kitchen',ticket:false}); a.mark('barra'); await a.wait(1600)
  await a.click({at:'kitchen-receive',x:.8,y:.5}); a.put({stations:{bar:'received',kitchen:'sent'},kitchen:'received'}); a.mark('barra-recibida'); await a.wait(900)
  await a.click({at:'kitchen-start',x:.8,y:.5}); a.put({stations:{bar:'preparing',kitchen:'sent'},kitchen:'preparing'}); a.mark('barra-preparando'); await a.wait(1100)
  await a.click({at:'ready-latte',x:.5,y:.5}); a.put({readyItems:['latte']}); await a.wait(700)
  await a.click({at:'kitchen-ready',x:.8,y:.5}); a.put({stations:{bar:'ready',kitchen:'sent'}}); a.mark('barra-lista'); await a.wait(1400)
  a.put({role:'kitchen'}); a.mark('cocina'); await a.wait(1500)
  await a.click({at:'kitchen-receive',x:.8,y:.5}); a.put({stations:{bar:'ready',kitchen:'received'}}); await a.wait(900)
  await a.click({at:'kitchen-start',x:.8,y:.5}); a.put({stations:{bar:'ready',kitchen:'preparing'}}); a.mark('cocina-preparando'); await a.wait(1100)
  await a.click({at:'ready-concha',x:.5,y:.5}); a.put({readyItems:['latte','concha']}); await a.wait(700)
  await a.click({at:'kitchen-ready',x:.8,y:.5}); a.put({stations:{bar:'ready',kitchen:'ready'},kitchen:'ready'}); a.mark('cocina-lista'); await a.wait(1400)
  a.put({role:'cashier',screen:'sale',ticket:true}); a.mark('caja-lista'); await a.wait(1700)
  await a.click({at:'deliver',x:.8,y:.5}); a.put({kitchen:'delivered'}); a.mark('entregada'); await a.wait(1000)
  await a.click({at:'pay',x:.8,y:.5}); a.put({screen:'payment'}); a.mark('cobro'); await a.wait(1100)
  await a.click({at:'cash-200',x:.8,y:.5}); a.put({received:'200'}); a.mark('cambio'); await a.wait(1200)
  await a.click({at:'confirm',x:.8,y:.5}); a.put({screen:'done',paid:true}); a.mark('resultado'); await a.wait(1500)
  await a.click({at:'print',x:.8,y:.5}); a.put({printed:true}); a.mark('comprobante'); await a.wait(2000)
}

function App(){
  const params = new URLSearchParams(location.search)
  const [app,setApp]=useState<'pos'|'dashboard'|'menu'>(params.get('app')==='menu'?'menu':params.get('app')==='dashboard'?'dashboard':'pos')
  const [platform,setPlatform]=useState(params.get('access')==='platform')
  const requested=params.get('screen') as Screen
  const requestedFlow=params.get('flow') as OrderFlow
  const [flow,setFlow]=useState<OrderFlow>(requestedFlow in flowName?requestedFlow:params.has('play')||requested==='incoming'||requested==='done'?'digital':'here')
  const storyInitial=useMemo(()=>lockScene(sceneForFlow(flow,true)),[flow])
  const storyPoster=useMemo(()=>resultForFlow(flow),[flow])
  const runStory=useCallback((act:Act<Scene>)=>story(act,flow),[flow])
  const [scene,setScene]=useState<Scene>(()=>{const seed=requestedFlow in flowName?sceneForFlow(requestedFlow):seedFor(requested in label?requested:'sale');const role=params.get('role');const result:Scene=role==='bar'||role==='kitchen'?{...seed,role,screen:'kitchen'}:seed;return requested in label&&requested!=='login'?result:lockScene({...result,screen:role==='bar'||role==='kitchen'?'kitchen':seed.source==='menu'?'incoming':'sale'})})
  const [auto,setAuto]=useState(params.has('play'))
  const [device,setDevice]=useState<Device>(()=>(params.get('device')||'') in devices?params.get('device') as Device:innerWidth<800?'iphone':'windows')
  const [deviceChosen,setDeviceChosen]=useState(params.has('device'))
  const [orientation,setOrientation]=useState<Orientation>(params.get('orientation')==='landscape'?'landscape':'portrait')
  useEffect(()=>{if(deviceChosen)return;const resize=()=>setDevice(innerWidth<800?'iphone':'windows');addEventListener('resize',resize);return()=>removeEventListener('resize',resize)},[deviceChosen])
  const format=deviceFormat(device,orientation)
  const [take,setTake]=useState(0)
  const [dark,setDark]=useState(params.get('theme')==='dark')
  useEffect(()=>{document.documentElement.classList.toggle('dark',dark)},[dark])
  const [original,setOriginal]=useState(false)
  const [design,setDesign]=useState<'1'|'2'|'3'>(params.get('design')==='1'?'1':params.get('design')==='3'?'3':'2')
  const selectDesign=(value:'1'|'2'|'3')=>{setDesign(value);const url=new URL(location.href);url.searchParams.set('design',value);history.replaceState(null,'',url)}
  const [previewNotice,setPreviewNotice]=useState('')
  const change=(patch:Partial<Scene>)=>setScene(s=>({...s,...patch}))
  const selectFlow=(next:OrderFlow)=>{setAuto(false);setOriginal(false);setPreviewNotice('');setFlow(next);setScene(lockScene(sceneForFlow(next)));setTake(t=>t+1)}
  const changeRole=(role:Role)=>{setAuto(false);setOriginal(false);setScene(s=>lockScene({...s,role,screen:role==='cashier'?'sale':'kitchen',ticket:false}));setTake(t=>t+1)}
  const selectApp=(next:'pos'|'dashboard'|'menu')=>{setApp(next);setAuto(false);setOriginal(false);const url=new URL(location.href);url.searchParams.set('app',next);history.replaceState(null,'',url)}
  const deviceControls=<div className="preview-control-row"><DevicePicker device={device} orientation={orientation} onDevice={value=>{setDevice(value);setDeviceChosen(true)}} onOrientation={setOrientation}/><div className="preview-actions"><BoardButton variant="ghost" aria-label={dark?'Usar tema claro':'Usar tema oscuro'} onClick={()=>setDark(!dark)}>{dark?'Tema claro':'Tema oscuro'}</BoardButton>{app==='dashboard'&&<><BoardButton variant="ghost" onClick={()=>{location.search=new URLSearchParams({app:'dashboard',view:'login',device,orientation,theme:dark?'dark':'light'}).toString()}}>Ver acceso</BoardButton><BoardButton variant="secondary" aria-pressed={platform} onClick={()=>setPlatform(!platform)}>{platform?'Vista de plataforma':'Vista de propietaria'}</BoardButton></>}</div></div>
  if(params.get('embed')==='menu-staff')return <MenuStaffPreview renderPos={props=><Workspace {...props}/>}/>
  if(params.has('menuFullscreen'))return <div className="study"><DigitalMenuShow device={device} orientation={orientation} onDevice={value=>{setDevice(value);setDeviceChosen(true)}} onOrientation={setOrientation}/></div>
  if(params.has('gold'))return <Gold/>
  return <div className="study" data-dark={dark}>
    <header className="study-head"><div><span className="study-eyebrow">Rediseño · Noviembre 2026</span><h1>{app==='menu'?'Menú digital':app==='dashboard'?'UMI Dashboard':'UMI POS'}</h1><p>{app==='menu'?'Del menú del cliente a la entrega del pedido.':app==='dashboard'?'Administración del negocio · Todas las secciones':'Propuesta de interfaz para Caja, Barra y Cocina.'}</p></div><span className="study-version">Prototipo interactivo</span></header>
    <div className="study-app-picker"><PreviewChoices label="Aplicación del prototipo" value={app} options={[{value:'pos',label:'UMI POS'},{value:'dashboard',label:'Dashboard'},{value:'menu',label:'Menú digital'}]} onChange={selectApp}/></div>
    {app==='pos'&&<div className="preview-controls">
      <PreviewChoices label="Diseño del POS" value={design} options={[{value:'1',label:'Rediseño 1'},{value:'2',label:'Rediseño 2 · Elegido',ariaLabel:'Rediseño 2'},{value:'3',label:'Rediseño 3'}]} onChange={selectDesign}/>
      <PreviewChoices label="Vista del POS" value={auto?'tour':'explore'} options={[{value:'explore',label:'Explorar'},{value:'tour',label:'Recorrido',ariaLabel:'Ver recorrido completo'}]} onChange={next=>{setAuto(next==='tour');setOriginal(false);if(next==='tour')setTake(t=>t+1)}}/>
      <PreviewChoices label="Recorrido del POS" value={original?'original':flow} options={[...(['digital','here','takeaway'] as const).map(value=>({value,label:flowName[value],ariaLabel:'Recorrido '+flowName[value]})),{value:'original',label:'Diseño actual'}]} onChange={next=>{if(next==='original'){setAuto(false);setOriginal(true)}else selectFlow(next as OrderFlow)}}/>
      {deviceControls}
    </div>}
    {app==='pos'&&!original&&<div className="study-roles"><div><span>Vistas por usuario</span><small>Selector de la maqueta</small></div><div>{(['cashier','bar','kitchen'] as Role[]).map(role=><button key={role} aria-label={'Vista de '+roleName[role]} aria-pressed={scene.role===role} onClick={()=>changeRole(role)}>{role==='cashier'?<Wallet size={16}/>:role==='bar'?<Coffee size={16}/>:<ChefHat size={16}/>} {roleName[role]}</button>)}</div></div>}
    {app==='pos'&&!original&&scene.screen==='login'&&<p className="study-access">PIN de prueba: Caja 2580 · Barra 3690 · Cocina 1470</p>}
    {previewNotice&&<div className="study-preview-note" role="status">{previewNotice}<button aria-label="Cerrar nota del prototipo" onClick={()=>setPreviewNotice('')}><X size={16}/></button></div>}
    {app==='menu'?<DigitalMenu device={device} orientation={orientation} onDevice={value=>{setDevice(value);setDeviceChosen(true)}} onOrientation={setOrientation}/>:<><main className="study-stage" data-device={original?undefined:device} style={{maxWidth:original||app==='dashboard'?1280:format.outerWidth}}>{app==='dashboard'?<DashboardShow device={device} orientation={orientation} dark={dark} platform={platform} controls={deviceControls}/>:original?<img className="original" src="/actual.png" alt="Captura nativa de UMI POS del 27 de octubre de 2026"/>:<Stage<Scene> key={`${auto}-${take}`} width={format.outerWidth} height={format.outerHeight} initial={storyInitial} poster={auto?storyPoster:scene} script={auto?runStory:undefined} play="once" cursor={auto?{at:{x:-30,y:-30},style:'arrow',ripple:true,idle:650}:undefined} fidelity="realistic" className="umi-study" theme={dark?'dark':'light'} tokens={{'--ss-font':'"IBM Plex Sans", sans-serif','--ss-text-strong':dark?'#edf1f8':'#172440','--ss-text':dark?'#d4dbea':'#33435c','--ss-text-faint':dark?'#a9b4c7':'#637189','--ss-accent':'#223979','--ss-row':'40px'}}>{(s,_rect,layout)=><Workspace design={design} s={auto?s:scene} set={auto?()=>{}:change} compact={format.kind==='phone'} device={device} orientation={orientation} dark={dark} setDark={setDark} report={auto?setScene:undefined} preview={setPreviewNotice}/>}</Stage>}</main>{!original&&<p className="study-device-caption">{app==='pos'?`Rediseño ${design} · `:''}{format.label} · Vista {format.width} × {format.height}{format.kind==='tablet'?orientation==='portrait'?' · Vertical':' · Horizontal':''}</p>}</>}
    {app==='dashboard'&&<p className="study-device-caption">Datos de ejemplo · Acceso: sofia@example.com / UmiDemo2026 · Código de verificación: 135790</p>}<footer className="study-footer">Prototipo local · Datos, plano y fotos ilustrativos · <a href="/products/SOURCES.txt" target="_blank" rel="noreferrer">Créditos de fotos</a></footer>
  </div>
}

function Workspace({s,set,compact,device,orientation,dark,setDark,report,preview,design='2',unframed=false,business='ONCA',demoNotice,demoAction}:{design?:'1'|'2'|'3';unframed?:boolean;business?:string;demoNotice?:string;demoAction?:ReactNode;s:Scene;set:(p:Partial<Scene>)=>void;compact:boolean;device:Device;orientation:Orientation;dark:boolean;setDark:(value:boolean)=>void;report?:(s:Scene)=>void;preview:(text:string)=>void}){
  useEffect(()=>{report?.(s)},[s,report])
  const tabletPortrait=devices[device].kind==='tablet'&&orientation==='portrait'
  const framed=(content:ReactNode)=>unframed?content:<DeviceFrame device={device} orientation={orientation} dark={dark}>{content}</DeviceFrame>
  const [category,setCategory]=useState('Todo')
  const catalogFade=useScrollFade()
  const ticketFade=useScrollFade()
  const [railPreferences,setRailPreferences]=useState<Partial<Record<'1'|'2'|'3',boolean>>>({})
  const railExpanded=railPreferences[design]??(design==='3'&&!compact&&!tabletPortrait)
  const setRailExpanded=(expanded:boolean)=>setRailPreferences(previous=>({...previous,[design]:expanded}))
  const [photos,setPhotos]=useState(true)
  const supportsProductPhotos=design==='1'
  const effectivePhotos=supportsProductPhotos&&photos
  const [config,setConfig]=useState({...initialSettings,appearance:dark?'Oscuro':'Claro'})
  const cashState=s.cashSession??initialCash
  const setCashState=(update:import('react').SetStateAction<typeof initialCash>)=>set({cashSession:typeof update==='function'?update(cashState):update})
  useEffect(()=>{setConfig(c=>['Sistema','Medianoche'].includes(c.appearance)?c:{...c,appearance:dark?'Oscuro':'Claro'})},[dark])
  useEffect(()=>{const next=applyCashPostings(s,cashState);if(next!==s)set({cashSession:next.cashSession,cashPostedIds:next.cashPostedIds})},[s.payments,s.paid,s.method,s.account,s.items,s.savedAccounts,s.cashPostedIds,cashState])
  const [search,setSearch]=useState('')
  const [cancelLine,setCancelLine]=useState<string|null>(null)
  const [newOrderOpen,setNewOrderOpen]=useState(false)
  const [notice,setNotice]=useState('')
  const total=totalOf(s)
  const sent=s.kitchen!=='draft'
  const pending=pendingItems(s)
  const due=balanceDue(s)
  const blocked=paymentPending(s)
  const productsLocked=blocked||Boolean(s.payments?.length)
  const run=(operation:()=>Scene)=>{try{set(operation());setNotice('')}catch(e){setNotice((e as Error).message)}}
  const startNew=()=>{setNewOrderOpen(true);set({screen:'sale',ticket:false,editing:false});setCategory('Todo');setSearch('')}
  const progress=kitchenCopy[s.kitchen]
  const go=(screen:Screen)=>{set({screen,editing:false,ticket:false,...(screen==='settings'?{resumeScreen:s.screen}:{})});setNotice('')}
  const settings=<Settings design={design} s={s} config={config} setConfig={setConfig} dark={dark} setDark={setDark} preview={preview} photos={effectivePhotos} supportsProductPhotos={supportsProductPhotos} setPhotos={setPhotos} expanded={railExpanded} setExpanded={setRailExpanded} onBack={()=>go(s.resumeScreen)} onLock={()=>set(lockScene(s))}/>
  const add=(p:typeof products[number])=>{if(s.paid||productsLocked){setNotice(blocked?'Resuelve el cobro pendiente antes de modificar la cuenta.':s.payments?.length?'La cuenta tiene pagos recibidos. Completa el cobro antes de modificarla.':'La cuenta está pagada. Abre un nuevo pedido.');return}if(p.id==='latte'){const draft=s.items.find(i=>(i.productId??i.id)==='latte'&&!lineIsSent(s,i)&&!i.voidReason);if(draft)edit(draft);else set({editing:true,editLineId:undefined,productQuantity:1,productCourse:1,productNote:''});return}run(()=>addOrderItem(s,{...p,qty:1}))}
  const adjust=(id:string,delta:number)=>run(()=>adjustItem(s,id,delta))
  const edit=(item:Item)=>set({editing:true,editLineId:item.id,productQuantity:item.qty,productCourse:item.course??1,productNote:item.note??'',size:item.detail?.split(' · ')[0]??'Nube',milk:item.detail?.split(' · ')[1]??'Deslactosada'})
  const commitLatte=()=>run(()=>addOrderItem(s,{...latte,qty:s.productQuantity??1,course:s.productCourse??1,note:s.productNote?.trim()||undefined,price:s.size==='Nube'?90:80,detail:s.size+' · '+s.milk},s.editLineId))
  const identity=orderIdentity(s)
  const pill=(text:string,tone='')=><span className={`u-pill ${tone}`}>{text}</span>
  const accountItems=<div className="u-lines">{s.items.map(i=>{const fired=lineIsSent(s,i);return <Collapse key={i.id} open={true}><div className="u-line" data-voided={Boolean(i.voidReason)}><Row className="u-line-row" pad={0} lead={<span className="u-qty">{i.qty}</span>} title={i.name} subtitle={[i.course&&i.course>1?`Tiempo ${i.course}`:'',i.detail,i.note].filter(Boolean).join(' · ')} meta={<strong>{money(i.voidReason?0:i.price*i.qty)}</strong>}/>{i.voidReason?<p className="u-line-state text-caption-1-regular">Cancelado · {voidReasons[i.voidReason]}</p>:<>{fired&&<span className="u-line-state text-caption-1-regular">Enviado · Ronda {i.round??1}</span>}{s.screen==='sale'&&!s.paid&&<div className="u-line-actions u-operational-line u-boardui" data-sent={fired}>{!fired&&<><BoardButton variant="ghost" iconOnly leadingIcon={RiSubtractLine} aria-label={`Quitar uno ${i.name}`} disabled={productsLocked} onClick={()=>adjust(i.id,-1)}/><span>{i.qty}</span><BoardButton variant="ghost" iconOnly leadingIcon={RiAddLine} aria-label={`Agregar uno ${i.name}`} disabled={productsLocked} onClick={()=>adjust(i.id,1)}/>{(i.productId??i.id)==='latte'&&<BoardButton variant="ghost" className="u-edit" disabled={productsLocked} onClick={()=>edit(i)}>Editar opciones</BoardButton>}</>}{fired&&<><BoardButton variant="ghost" size="small" leadingIcon={RiRepeatLine} disabled={productsLocked} onClick={()=>run(()=>addOrderItem(s,{...i,id:i.productId??i.id,qty:i.qty}))}>Repetir</BoardButton><BoardButton variant="ghost" size="small" leadingIcon={RiCloseLine} disabled={productsLocked} onClick={()=>setCancelLine(i.id)}>Cancelar</BoardButton></>}</div>}</>}{cancelLine===i.id&&!i.voidReason&&<SentLineCancellation s={s} item={i} set={set} onClose={()=>setCancelLine(null)}/>}</div></Collapse>})}</div>
  const identityHeader=<div className="u-account-head"><div><span className="u-overline">Cuenta {accountId(s)}</span><div className="u-title">{s.source==='counter'&&s.service==='here'&&s.tableNumber?<TableIdentity number={s.tableNumber}/>:identity}</div></div><span className="u-people"><Users size={16}/> {s.guests??(s.source==='menu'?1:2)}</span></div>
  const summary=design!=='1'?<div className="u-sum"><details className="u-balance-details"><summary className="text-caption-1-medium">Detalle de consumo</summary><div><div><span>Consumo</span><b>{money(total)}</b></div><div className="u-tax"><span>IVA incluido</span><span>{money(total-total/1.16)}</span></div>{paidPrincipal(s)>0&&<div><span>Pagos recibidos</span><b>{money(paidPrincipal(s))}</b></div>}{tipsPaid(s)>0&&<div><span>Propinas cobradas</span><b>{money(tipsPaid(s))}</b></div>}</div></details><div className="u-total"><span>{s.paid?'Saldo pendiente':'Por cobrar'}</span><strong><Count value={due} format={money}/></strong></div></div>:<div className="u-sum"><div><span>Consumo</span><b>{money(total)}</b></div><div className="u-tax"><span>IVA incluido</span><span>{money(total-total/1.16)}</span></div>{paidPrincipal(s)>0&&<div><span>Pagos recibidos</span><b>{money(paidPrincipal(s))}</b></div>}{tipsPaid(s)>0&&<div><span>Propinas cobradas</span><b>{money(tipsPaid(s))}</b></div>}<div className="u-total"><span>{s.paid?'Saldo pendiente':'Por cobrar'}</span><strong><Count value={due} format={money}/></strong></div></div>
  const preparation=<>{sent&&<div className="u-routing-summary">{(['bar','kitchen'] as const).filter(station=>stationItems(s,station).length>0).map(station=><div key={station}><span>{roleName[station]}</span><b data-ready={s.stations[station]==='ready'}>{stationLabel[s.stations[station]]}</b></div>)}</div>}<div className={cx('u-progress',sent&&'sent')} data-state={s.kitchen}><ChefHat size={18}/><div><b><Roll>{progress.title}</Roll></b></div>{s.kitchen==='delivered'&&<Check size={16}/>}</div></>
  const dispatch=pending.length>0?<button className="u-secondary u-wide" data-target="send" disabled={s.editing||s.paid||blocked} onClick={()=>run(()=>sendRound(s))}><Send size={17}/>{sent?`Enviar nueva ronda · ${pending.length}`:'Enviar a cocina'}</button>:s.kitchen==='ready'?<button className="u-secondary u-wide" data-target="deliver" onClick={()=>run(()=>deliverRounds(s))}><ShoppingBag size={17}/>{s.service==='here'?'Confirmar servicio en mesa':'Confirmar entrega'}<Check size={16}/></button>:<div className="u-send-status"><Check size={15}/>{s.kitchen==='delivered'?'Pedido entregado':sent?'Comanda enviada a sus estaciones':'Agrega productos a la cuenta'}</div>
  const collection=<button className="u-primary u-wide" data-target="pay" disabled={!total||s.paid||s.editing} onClick={()=>set({screen:'payment',received:''})}><span>{s.paid?'Cuenta pagada':blocked?'Revisar cobro pendiente':'Cobrar cuenta'}</span><span>{design==='1'&&money(due)} <ArrowRight size={17}/></span></button>
  const ticket=<aside className="u-ticket" data-active={s.ticket}>{compact&&s.ticket&&<button className="u-mobile-cart u-account-back" onClick={()=>set({ticket:false})}><ArrowLeft size={18}/>Volver a la carta</button>}<div className="u-ticket-context">{design==='3'&&<h2 className="u-comanda-title text-title-3-medium">Comanda</h2>}{identityHeader}<div className="u-meta"><Clock3 size={14}/> Abierta hace 8 min <span>·</span> Ana</div><div className="u-service">{s.source==='counter'&&!sent&&!s.paid?<div className="u-service-options">{(['here','takeaway'] as const).map(service=><button key={service} aria-pressed={s.service===service} onClick={()=>set({service,tableNumber:service==='takeaway'?null:s.tableNumber})}><ServiceTag service={service}/></button>)}</div>:<ServiceTag service={s.service}/>}</div></div><div className="u-ticket-scroll"><div className="u-ticket-body" onScroll={ticketFade.onScroll}><div className="u-line-label">{design==='3'?<><span>Cant.</span><span>Producto</span><span>Importe</span></>:<><span>{s.items.filter(i=>!i.voidReason).reduce((n,i)=>n+i.qty,0)} productos</span><span>MXN</span></>}</div>{accountItems}{s.source==='menu'&&<div className="u-order-note"><b>Nota del cliente</b><span>{s.customerNote??customerNote}</span></div>}{design==='1'&&preparation}</div>{design!=='1'&&<ScrollFade progress={ticketFade.progress}/>}</div><div className="u-ticket-foot">{design==='1'&&summary}{design==='1'?dispatch:<div className="u-dispatch-zone">{preparation}{dispatch}</div>}{design==='1'?collection:<div className="u-collection-zone">{summary}{collection}</div>}</div></aside>
  const displayedProducts=products.filter(p=>(category==='Todo'||category==='Favoritos'&&favoriteProductIds.includes(p.id)||p.category===category)&&p.name.toLowerCase().includes(search.toLowerCase()))
  const categoryFilters=<div className="u-categories">{[{name:'Todo'},{name:'Bebidas'},{name:'Pan'},{name:'Pizzas'}].map(c=><button key={c.name} data-category={c.name} data-active={category===c.name} aria-pressed={category===c.name} onClick={()=>{setCategory(c.name);set({editing:false})}}><b>{c.name}</b><span>{c.name==='Todo'?12:products.filter(p=>p.category===c.name).length}<small>{products.filter(p=>p.category===c.name).length===1?' producto':' productos'}</small></span></button>)}</div>
  const productCard=(p:typeof products[number])=><button className={cx("u-product",design!=='1'&&'text-body-medium')} key={p.id} data-category={p.category} data-popular={design==='2'&&mostOrderedProductIds.has(p.id)||undefined} data-in-order={s.items.some(i=>!i.voidReason&&(i.productId??i.id)===p.id)} data-photo={effectivePhotos&&!!productPhotos[p.id]} data-target={'product-'+p.id} onClick={()=>add(p)}>{effectivePhotos&&productPhotos[p.id]&&<img className="u-product-photo" src={productPhotos[p.id]} alt="" loading="eager"/>}<span className="u-product-category">{p.category}</span>{s.items.some(i=>!i.voidReason&&(i.productId??i.id)===p.id)&&<b className="u-product-count">{s.items.filter(i=>!i.voidReason&&(i.productId??i.id)===p.id).reduce((n,i)=>n+i.qty,0)}</b>}<strong>{p.name}</strong>{design==='2'&&mostOrderedProductIds.has(p.id)&&<Badge className="u-product-popularity">Más pedido</Badge>}<span className="u-product-price">{p.id==='latte'?'Desde ':''}{money(p.price)}</span></button>
  if(s.screen==='login')return framed(<div className={`u-app ${compact?'compact':''}`} data-design={design} data-theme={dark?'dark':'light'} data-screen="login" data-tablet-portrait={tabletPortrait} data-role={s.role}><Login s={s} set={set} shiftStatus={cashState.status} design={design}/></div>)
  if(s.role!=='cashier')return framed(<div className={`u-app u-station-app ${compact?'compact':''}`} data-design={design} data-theme={dark?'dark':'light'} data-tablet-portrait={tabletPortrait} data-role={s.role} data-screen={s.screen} data-kitchen={s.kitchen}><div className="u-shell"><header className="u-header"><span className="u-station-brand">umi</span><div className="u-branch"><strong>{business}</strong><span>Centro</span></div><span className="u-role-label">{roleName[s.role]}</span><div className="u-header-actions"><span className="u-online"><Wifi size={16}/>En línea</span><span className="u-station-user">{s.role==='bar'?'Luis':'Marta'} · {roleName[s.role]}</span><button className="u-station-setting" aria-label="Configuración" onClick={()=>go('settings')}><SettingsIcon size={20}/></button></div></header>{demoNotice&&<div className="menu-staff-notice text-body-2-regular" role="status"><span>{demoNotice}</span>{demoAction}</div>}<div className="u-workspace">{s.screen==='settings'?settings:<Kitchen design={design} s={s} set={set}/>}</div></div></div>)
  return framed(<div className={`u-app ${compact?'compact':''}`} data-tablet-portrait={tabletPortrait} data-design={design} data-theme={dark?'dark':'light'} data-role="cashier" data-rail-expanded={railExpanded} data-screen={s.screen} data-kitchen={s.kitchen}>
    <nav className="u-rail" aria-label="Navegación principal"><div className="u-rail-head"><div className="u-logo">umi</div><button className="u-rail-toggle" aria-expanded={railExpanded} aria-label={railExpanded?'Contraer navegación':'Expandir navegación'} title={railExpanded?'Contraer navegación':'Expandir navegación'} onClick={()=>setRailExpanded(!railExpanded)}>{railExpanded?<PanelLeftClose size={20}/>:<PanelLeftOpen size={20}/>}<span>Contraer menú</span></button></div><div className="u-nav">{([{id:'sale',text:'Venta',icon:ShoppingBag},{id:'incoming',text:'Pedidos',icon:Inbox},{id:'tables',text:'Mesas',icon:LayoutGrid},{id:'cash',text:'Caja',icon:Wallet}] as const).map(n=><button key={n.id} aria-label={n.text} title={n.text} data-active={s.screen===n.id} onClick={()=>go(n.id)}><n.icon size={22}/><span>{n.text}</span>{n.id==='incoming'&&s.incoming&&<i>1</i>}</button>)}</div><button className="u-rail-bottom" aria-label="Configuración" title="Configuración" data-active={s.screen==='settings'} onClick={()=>go('settings')}><SettingsIcon size={21}/><span>Configuración</span></button><div className="u-avatar">A</div></nav>
    <div className="u-shell"><header className="u-header"><span className="u-mobile-brand">umi</span><div className="u-branch"><strong>{business}</strong><span>Centro <ChevronDown size={13}/></span></div><div className="u-header-context">Caja · Ana <span>·</span> 14:52</div><div className="u-header-actions"><span className="u-online"><Wifi size={16}/> En línea</span>{s.incoming&&<button className="u-incoming-shortcut" onClick={()=>go('incoming')}><Inbox size={17}/><span>1 pedido nuevo</span><b>1</b></button>}<span className="u-header-user">Ana <ChevronDown size={13}/></span></div></header>
    {demoNotice&&<div className="menu-staff-notice text-body-2-regular" role="status"><span>{demoNotice}</span>{demoAction}</div>}
    {notice&&<div className="u-notice" role="status">{notice}<button aria-label="Cerrar aviso" onClick={()=>setNotice('')}><X size={16}/></button></div>}
    <div className="u-workspace">
      {s.screen==='sale'&&<><section className={`u-catalog ${s.ticket?'ticket-visible':''}`} data-editing={s.editing}><div className="u-catalog-top"><div><span className="u-overline">Venta en caja</span><div className="u-page-title">La carta</div></div>{design==='2'?<BoardButton className="u-new-action u-boardui" leadingIcon={RiAddLine} aria-expanded={newOrderOpen} onClick={startNew}>Nuevo pedido</BoardButton>:<button className="u-new" onClick={startNew}><Plus size={18}/> Nuevo pedido</button>}</div>{newOrderOpen&&<div className="u-new-order-choice u-boardui"><span className="text-body-2-medium">Servicio del nuevo pedido</span><div className="u-pos-inline"><BoardButton variant="secondary" onClick={()=>{setNewOrderOpen(false);go('tables')}}>Comer aquí · Elegir mesa</BoardButton><BoardButton variant="secondary" onClick={()=>{run(()=>newAccount(s,'takeaway'));setNewOrderOpen(false)}}>Para llevar</BoardButton><BoardButton variant="ghost" onClick={()=>setNewOrderOpen(false)}>Volver</BoardButton></div></div>}<div className="u-search-slot">{design!=='1'?<Input aria-label="Buscar un producto" placeholder="Buscar un producto" value={search} onChange={setSearch} className="u-workbench-search u-boardui" fieldClassName="min-h-11 h-11 py-2"/>:<label className="u-search"><Search size={18}/><input placeholder="Buscar un producto" value={search} onChange={e=>setSearch(e.target.value)}/><span>⌘ K</span></label>}</div>{(compact||tabletPortrait||design!=='1')&&categoryFilters}<div className="u-grid-heading"><b>{category==='Todo'?'Productos':category}</b><div className="u-catalog-actions">{supportsProductPhotos&&<button aria-pressed={photos} onClick={()=>setPhotos(!photos)}>{photos?'Ocultar fotos':'Mostrar fotos'}</button>}<button onClick={()=>setCategory(category==='Favoritos'?'Todo':'Favoritos')}>{category==='Favoritos'?'Ver todos':'Ver favoritos'} <ArrowRight size={13}/></button></div></div>{design==='3'&&<div className="u-frequent-products"><span className="text-caption-1-medium">Frecuentes</span><div className="u-frequent-scroll" role="group" aria-label="Productos frecuentes">{products.filter(p=>favoriteProductIds.includes(p.id)).map(p=><BoardButton key={p.id} variant="secondary" className="text-body-2-medium shadow-none" data-target={'frequent-'+p.id} onClick={()=>add(p)}>{p.name}<span className="text-caption-1-regular">{money(p.price)}</span></BoardButton>)}</div></div>}<div className="u-products-scroll"><div className="u-products" onScroll={catalogFade.onScroll}>{displayedProducts.map(productCard)}{!displayedProducts.length&&<p className="u-empty">No hay productos con ese nombre.</p>}</div>{design!=='1'&&<ScrollFade progress={catalogFade.progress}/>}</div><div className="u-catalog-foot"><span>12 productos en la carta</span><span>Precios en MXN · IVA incluido</span></div><ProductOptions design={design} s={s} set={set} save={commitLatte} photos={effectivePhotos}/></section>{!compact&&!tabletPortrait&&design==='1'&&<nav className="u-category-column" aria-label="Categorías de productos"><span className="u-category-column-title">Categorías</span>{categoryFilters}</nav>}{ticket}{compact&&!s.ticket&&!s.editing&&<button className="u-mobile-cart u-primary" onClick={()=>set({ticket:true})}><span>{identity} · Ver cuenta</span><b>{money(total)}</b></button>}</>}
      {s.screen==='settings'&&settings}
      {s.screen==='tables'&&<PosTables design={design} s={s} set={set} fit={tabletPortrait||compact}/>}
      {s.screen==='incoming'&&(design==='3'?<IncomingOrder3 s={s} onAccept={()=>set(acceptIncoming(s))} onResume={()=>run(()=>resumeAccount(s,'043'))}/>:<div className="u-incoming-composition"><section className="u-incoming-list"><div className="u-page-heading"><div><span className="u-overline">Menú digital</span><div className="u-page-title">Pedidos entrantes</div></div>{pill(s.incoming?'1 por revisar':'Al día',s.incoming?'amber':'green')}</div>{s.incoming?<button className="u-incoming-card" onClick={()=>{}}><Row pad={0} lead={<ShoppingBag size={24}/>} title={orderIdentity(s)} subtitle="Para llevar · Hace 2 min" meta={money(totalOf(s))}/><div><span>Pedido web {s.menuOrderNumber||'018'} · 2 productos</span>{pill('Por revisar','amber')}</div></button>:<div className="u-inbox-empty"><CheckCircle2 size={42}/><strong>Todo al día</strong><p>El pedido está en la cuenta {s.account}.</p><button className="u-secondary" onClick={()=>run(()=>resumeAccount(s,'043'))}>Ver cuenta</button></div>}</section><aside className="u-incoming-detail"><span className="u-overline">Pedido web {s.menuOrderNumber||'018'}</span><div className="u-page-title">{orderIdentity(s)}</div><div className="u-meta"><ServiceTag service="takeaway"/><span>Retiro · {s.pickupTime||'15:10'}</span></div><div className="u-detail-label">Productos y opciones</div>{s.items.map(item=><Row key={item.id} className="u-incoming-line" lead={<span className="u-qty">{item.qty}</span>} title={item.name} subtitle={[item.detail,item.note].filter(Boolean).join(' · ')} meta={money(item.price*item.qty)}/>)}<div className="u-customer-note"><b>Nota del cliente</b><p>{s.customerNote??customerNote}</p></div><div className="u-incoming-payment"><span>Pago al recoger</span><strong>{money(totalOf(s))}</strong></div><div className="u-bottom-actions"><button className="u-primary u-wide" data-target="accept-order" disabled={!s.incoming} onClick={()=>set(acceptIncoming(s))}>Atender en cuenta {s.account} <ArrowRight size={17}/></button></div></aside></div>)}
      {s.screen==='cash'&&<Cash design={design} state={cashState} setState={setCashState} preview={preview} compact={compact} policy={new URLSearchParams(location.search).get('cashPolicy')==='visible'?visibleCashPolicy:blindCashPolicy}/>}
      {s.screen==='payment'&&<Payment design={design} key={s.account} s={s} set={set} identity={identityHeader} items={accountItems} summary={summary} onBack={()=>go('sale')} cashOpen={cashState.status==='open'}/>}
      {s.screen==='done'&&<PosReceipt design={design} s={s} set={set} onNew={startNew} business={business}/>}
    </div></div>

  </div>)
}

createRoot(document.getElementById('root')!).render(<DirectionProvider locale="es-MX"><App/></DirectionProvider>)

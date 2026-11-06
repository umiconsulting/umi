import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RiHomeLine, RiShoppingBag3Line, RiBarChartLine, RiWallet3Line, RiRestaurantLine, RiGroupLine, RiChat3Line, RiGiftLine, RiCupLine, RiArchiveLine, RiLayoutGridLine, RiComputerLine, RiTeamLine, RiTimeLine, RiSettings3Line, RiPulseLine, RiStore2Line, RiBankCardLine, RiUserLine, RiMenuLine, RiCloseLine, RiArrowRightLine, RiAddLine, RiDownloadLine, RiSearchLine, RiArrowLeftLine, RiLogoutBoxLine, RiRefreshLine, RiArrowDownSLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { Tabs, Tab, TabList } from '@/components/base/tabs/tabs'
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/base/table/table'
import { SidebarNavItem } from '@/components/application/dashboard/dashboard-sidebar'
import { ScrollFade, useScrollFade } from '@/components/foundations/scroll-fade/scroll-fade'
import { cx } from '@/utils/cx'
import { DeviceFrame, devices, type Device, type Orientation } from '../DevicePreview'
import FloorEditor from './FloorEditor'
import { modules, findView, productPhoto, type Entry, type View } from './data'
import { Detail, Fields, type DetailState } from './Detail'
import CountWorkflow from './CountWorkflow'
import { filterEntries, filtersFor, canView, safeValues, receiptDeltas, jsonValue, type ReceiptLine, type AccessContext } from './parity-model'
import { RoutePreview, ProviderPanel } from './DomainPanels'
import { InventorySelection, ProfileAccess, reportRows, salesDimensions, salesPeriodFactor } from './ViewControls'
import './parity.css'
import DashboardLogin from './DashboardLogin'
import Overview from './Overview'
import './dashboard.css'
import './identity.css'
import type { DashboardScene } from './tour-model'

const icons=[RiHomeLine,RiShoppingBag3Line,RiBarChartLine,RiWallet3Line,RiRestaurantLine,RiGroupLine,RiChat3Line,RiGiftLine,RiCupLine,RiArchiveLine,RiLayoutGridLine,RiComputerLine,RiTeamLine,RiTimeLine,RiSettings3Line,RiPulseLine,RiStore2Line,RiBankCardLine,RiUserLine]
const iconFor=Object.fromEntries(['overview','orders','reports','cash','kitchen','customers','inbox','loyalty','products','inventory','floor','devices','team','hours','settings','diagnostics','cafes','billing','profile'].map((key,i)=>[key,icons[i]]))
type Props={device:Device;orientation:Orientation;dark:boolean;platform:boolean;tour?:DashboardScene;unframed?:boolean;menuPreview?:{title:string;content:ReactNode}}
export default function Dashboard({device,orientation,dark,platform,tour,unframed=false,menuPreview}:Props){
 const [localCurrent,setCurrent]=useState(()=>new URLSearchParams(location.search).get('view')||'overview')
 const current=tour?.view??localCurrent
 const [localDetail,setDetail]=useState<DetailState|null>(null)
 const detail=tour?(tour.detail?{view:findView(tour.view),entry:tour.detail.row===undefined?undefined:findView(tour.view).rows[tour.detail.row]}:null):localDetail
 const [collapsed,setCollapsed]=useState(false)
 const [localMenuOpen,setMenuOpen]=useState(false)
 const menuOpen=tour?.menu??localMenuOpen
 const [query,setQuery]=useState('')
 const [filter,setFilter]=useState<Record<string,string>>({})
 const [business,setBusiness]=useState(menuPreview?'Bruma Café':'ONCA'),[branch,setBranch]=useState('Centro')
 const [role,setRole]=useState<AccessContext['role']>('Owner'),[productSet,setProductSet]=useState('Todos')
 const [dimension,setDimension]=useState('Producto'),[limit,setLimit]=useState(4)
 const [expanded,setExpanded]=useState<Record<string,boolean>>({})
 const scope=business+':'+branch
 const access:AccessContext={role:tour?'Owner':role,products:tour||productSet==='Todos'?['dashboard','cash','conversaflow']:productSet==='Dashboard y Umi Cash'?['dashboard','cash']:['dashboard'],platform}
 const readOnly=access.role!=='Owner'
 const [period,setPeriod]=useState('Hoy')
 const [notice,setNotice]=useState('')
 const [localSignedIn,setSignedIn]=useState(current!=='login'&&current!=='reset')
 const signedIn=tour?tour.view!=='login':localSignedIn
 useEffect(()=>{if(tour){setCurrent(tour.view);setSignedIn(tour.view!=='login');setMenuOpen(tour.menu);setDetail(tour.detail?{view:findView(tour.view),entry:tour.detail.row===undefined?undefined:findView(tour.view).rows[tour.detail.row]}:null)}},[tour])
 const [saved,setSaved]=useState<Record<string,Entry[]>>(()=>{try{return JSON.parse(sessionStorage.getItem('umi-dashboard-demo-records')||'{}')}catch{return {}}})
 useEffect(()=>{try{sessionStorage.setItem('umi-dashboard-demo-records',JSON.stringify(saved))}catch{setNotice('No se pudieron conservar los cambios de ejemplo en el navegador.')}},[saved])
 const [config,setConfig]=useState<Record<string,Record<string,string>>>({})
 const [drafts,setDrafts]=useState<Record<string,Record<string,string>>>({})
 const mainFade=useScrollFade(),navFade=useScrollFade()
 const mainRef=useRef<HTMLElement>(null)
 useEffect(()=>{mainRef.current?.scrollTo(0,0);mainFade.reset()},[current,detail?.entry?.name,detail?.action])
 const compact=devices[device].kind==='phone'
 const portrait=devices[device].kind==='tablet'&&orientation==='portrait'
 const sourceView=findView(current)
 const view=sourceView.id==='sales'?{...sourceView,columns:[dimension,...sourceView.columns.slice(1)]}:sourceView
 const sourceMod=modules.find(m=>m.views.some(v=>v.id===view.id))||modules[0]
 const mod={...sourceMod,views:sourceMod.views.filter(v=>canView(v.id,access))}
 const go=(id:string)=>{setCurrent(id);setDetail(null);setQuery('');setFilter({});setMenuOpen(false);setNotice('');setLimit(4);mainFade.reset()}
 useEffect(()=>{if(!platform&&mod.platform)go('overview')},[platform,mod.platform])
 const groups:Record<string,string>={overview:'Hoy',orders:'Operación',reports:'Operación',cash:'Operación',kitchen:'Operación',customers:'Clientes',inbox:'Clientes',loyalty:'Clientes',products:'Negocio',inventory:'Negocio',floor:'Negocio',devices:'Negocio',team:'Negocio',hours:'Configuración',settings:'Configuración',diagnostics:'Configuración',cafes:'Plataforma',billing:'Plataforma'}
 const available=modules.filter(m=>(!m.platform||platform)&&m.id!=='profile').map(m=>({...m,views:m.views.filter(v=>canView(v.id,access)),group:groups[m.id]||m.group})).filter(m=>m.views.length)
 const scopedKey=(id:string)=>scope+':'+id
 const records=Object.fromEntries(modules.flatMap(m=>m.views.map(v=>[v.id,saved[scopedKey(v.id)]||(business==='ONCA'&&branch==='Centro'?v.rows:[])]))) as Record<string,Entry[]>
 records.customers=(records.customers||[]).map(r=>({...r,values:{balance:String(Number((records.wallet||[]).find(w=>w.name===r.name)?.cells[0].replace(/[^0-9.]/g,'')||220)),stamps:(records.loyalty||[]).find(l=>l.name===r.name)?.cells[1].split(' ')[0]||'0',...r.values}}))
 records.permissions=(records.permissions||[]).map(r=>({...r,cells:[String((records.team||[]).filter(p=>p.cells[0]===r.name).length),...r.cells.slice(1)]}))
 const branchOptions=menuPreview?['Centro']:business==='ONCA'?['Centro','Malecón',...Object.entries(saved).filter(([key])=>key.startsWith(business+':')&&key.endsWith(':locations')).flatMap(([,entries])=>entries.map(e=>e.name.replace(/^ONCA · /,'')))]:['Principal']
 const batchSave=(id:string,entries:Entry[])=>setSaved(old=>{const source=old[scopedKey(id)]||records[id]||[];return {...old,[scopedKey(id)]:[...source.map(e=>entries.find(next=>next.name===e.name||!!next.values?.Referencia&&next.values.Referencia===e.values?.Referencia)||e),...entries.filter(e=>!source.some(previous=>previous.name===e.name||!!e.values?.Referencia&&e.values.Referencia===previous.values?.Referencia))]}})
 const baseRows=records[view.id]||[]
 const rows=view.id==='sales'?reportRows(dimension,period,baseRows):baseRows
 const filtered=filterEntries(view.id,rows,query,filter)
 const shown=view.id==='customers'||view.id==='loyalty'?filtered.slice(0,limit):filtered
 const save=(entry?:Entry,values?:Record<string,string>,actionName?:string)=>{
  const targetId=detail?.view.id||view.id
  const clean=safeValues(values||{})
  if(detail)setDrafts(old=>({...old,[scope+':'+targetId+':'+(entry?.name||(actionName?.startsWith('Editar')?detail.entry?.name:detail.entry?detail.entry.name+':'+actionName:actionName)||'')]:clean}))
  if(entry&&detail)setSaved(old=>{const source=old[scopedKey(targetId)]||records[targetId]||[];const existing=detail.entry?.name||entry.name;return {...old,[scopedKey(targetId)]:source.some(r=>r.name===existing)?source.map(r=>r.name===existing?entry:r):[entry,...source]}})
  if(targetId==='permissions'&&actionName==='Reasignar equipo'&&detail?.entry){
   const from=detail.entry.name,to=clean['Rol de reemplazo'];const people=(records.team||[]).filter(p=>p.cells[0]===from)
   batchSave('team',people.map(p=>({...p,cells:[to,...p.cells.slice(1)],values:{...p.values,Rol:to}})))
   batchSave('permissions',(records.permissions||[]).filter(r=>r.name===from||r.name===to).map(r=>({...r,cells:[String(r.name===from?0:Number(r.cells[0])+people.length),...r.cells.slice(1)]})))
  }
  if(targetId==='permissions'&&actionName?.startsWith('Editar')&&entry&&detail?.entry&&entry.name!==detail.entry.name)batchSave('team',(records.team||[]).filter(p=>p.cells[0]===detail.entry?.name).map(p=>({...p,cells:[entry.name,...p.cells.slice(1)],values:{...p.values,Rol:entry.name}})))
  if(targetId==='customers'&&entry){if(entry.values?.stamps!==undefined)batchSave('loyalty',(records.loyalty||[]).filter(r=>r.name===entry.name).map(r=>({...r,cells:[r.cells[0],`${entry.values?.stamps} de 8`,'Hoy',Number(entry.values?.stamps)>=8?'Premio disponible':'Activa']})));if(entry.values?.balance!==undefined)batchSave('wallet',(records.wallet||[]).filter(r=>r.name===entry.name).map(r=>({...r,cells:[Number(entry.values?.balance).toLocaleString('es-MX',{style:'currency',currency:'MXN'}),'Hoy · Operación de ejemplo','Recarga','Registrado']})))}
  if(targetId==='giftcards'&&actionName==='Canjear tarjeta'&&entry){const contact=clean['Contacto del cliente'],customer=(records.customers||[]).find(c=>c.detail?.includes(contact)||c.values?.Correo===contact||c.values?.Teléfono===contact||c.name===entry.cells[0]);if(customer){const balance=Number(customer.values?.balance||220)+Number(entry.cells[1].replace(/[^0-9.]/g,''));batchSave('customers',[{...customer,values:{...customer.values,balance:String(balance)}}]);batchSave('wallet',(records.wallet||[]).filter(r=>r.name===customer.name).map(r=>({...r,cells:[balance.toLocaleString('es-MX',{style:'currency',currency:'MXN'}),'Hoy · Tarjeta de regalo','Canje','Registrado']})))}}
  if(targetId==='hours'&&detail?.entry&&actionName==='Guardar horario'&&entry&&clean['Copiar a']!=='Solo este día')batchSave('hours',(records.hours||[]).filter(r=>clean['Copiar a']==='Todos los días'||!['Sábado','Domingo'].includes(r.name)).map(r=>({...r,cells:entry.cells,values:entry.values})))
  if(actionName==='Pausar pedidos'||actionName==='Reanudar pedidos')setConfig(old=>({...old,[scope+':hours']:{...old[scope+':hours'],paused:actionName==='Pausar pedidos'?'Sí':'No',reason:clean['Motivo visible para clientes']||''}}))
  if(targetId==='terminals')setConfig(old=>({...old,[scope+':terminals']:{...old[scope+':terminals'],...(actionName?.includes('Mercado Pago')?{providerState:actionName==='Desconectar Mercado Pago'?'Desconexión solicitada · Sin verificar':'Autorización solicitada · Sin verificar'}:{}),...(actionName==='Crear tienda'?{store:clean['Nombre de tienda']}:{}),...clean}}))
  if(targetId==='purchases'&&entry?.values?.invoiceLines){const lines=receiptDeltas(jsonValue<ReceiptLine[]>(entry.values.invoiceLines,[]),jsonValue<ReceiptLine[]>(detail?.entry?.values?.invoiceLines,[]));batchSave('items',(records.items||[]).filter(r=>lines.some(l=>l.article===r.name)).map(r=>{const added=lines.filter(l=>l.article===r.name).reduce((sum,l)=>sum+l.quantity,0),unit=r.cells[0].split(' ').at(-1);return {...r,cells:[`${parseFloat(r.cells[0])+added} ${unit}`,...r.cells.slice(1)],values:{...r.values,lastMovement:`Recepción de ejemplo ${entry.name}: +${added} ${unit}`}}}))}
 }
 const action=(name:string)=>{setDetail({view,action:name});setNotice('');mainFade.reset()}
 const exportRows=()=>{
  const cell=(v:string)=>'"'+v.replaceAll('"','""')+'"'
  const csv=[view.columns,...shown.map(r=>[r.name,...r.cells])].map(r=>r.map(cell).join(',')).join('\n')
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`umi-demo-${view.id}.csv`;a.click();URL.revokeObjectURL(url);setNotice('CSV de ejemplo descargado')
 }
 const renderView=()=>{
  if(menuPreview)return menuPreview.content
  if(detail?.action==='Iniciar conteo')return <CountWorkflow entries={records.items} scope={scope} onSave={entries=>batchSave('items',entries)} onBack={()=>{setDetail(null);mainFade.reset()}}/>
  if(detail)return <Detail tour={tour?.detail??undefined} key={detail.view.id+(detail.entry?.name||'')+(detail.action||'')} records={records} scope={scope} readOnly={readOnly} onBatchSave={batchSave} state={{...detail,savedValues:drafts[scope+':'+detail.view.id+':'+(detail.entry?.name||detail.action||'')]}} onBack={()=>{setDetail(null);mainFade.reset()}} onSave={save}/>
  if(!canView(view.id,access))return <div className="d-empty"><h1>Acceso no disponible</h1><p>Este destino requiere el producto contratado y los permisos del comercio.</p><Button variant="secondary" onClick={()=>go('profile')}>Ver mi acceso</Button></div>
  if(view.id==='overview')return business==='ONCA'&&branch==='Centro'?<Overview go={go}/>:<div className="d-empty"><h1>Resumen de {business}</h1><p>{branch} · Esta sucursal no tiene registros en la demostración.</p></div>
  if(view.id==='floor')return <FloorEditor tourEditing={tour?.floorEditing} demonstration={!!tour}/>
  return <>
   <header className="d-page-head"><div><span className="d-eyebrow">{mod.label===view.label?mod.group:mod.label}</span><h1>{view.label}</h1><p>{view.description}</p></div><div className="d-page-actions">{view.action&&!readOnly&&(mod.id!=='settings'||view.id==='locations')&&<Button leadingIcon={/Nuevo|Nueva|Añadir|Agregar|Crear|Emitir|Registrar/.test(view.action||'')?RiAddLine:undefined} onClick={()=>action(view.action!)}>{view.action}</Button>}</div></header>
   {mod.views.length>1&&(compact||mod.views.length>6?<Select className="d-section-picker" data-target="d-sections" isOpen={tour?.sectionOpen} tourPortal={!!tour} label={`Sección de ${mod.label.toLowerCase()}`} selectedKey={view.id} onSelectionChange={key=>go(String(key))}>{mod.views.map(v=><SelectItem data-target={`d-section-${v.id}`} id={v.id} key={v.id}>{v.label}</SelectItem>)}</Select>:<Tabs selectedKey={view.id} onSelectionChange={key=>go(String(key))}><TabList aria-label={`Secciones de ${mod.label}`}>{mod.views.map(v=><Tab data-target={`d-section-${v.id}`} id={v.id} key={v.id}>{v.label}</Tab>)}</TabList></Tabs>)}
   {view.id==='sales'&&<><div className="d-report-controls"><Select aria-label="Periodo del reporte" selectedKey={period} onSelectionChange={key=>setPeriod(String(key))}>{['Hoy','Ayer','7 días','30 días'].map(p=><SelectItem id={p} key={p}>{p}</SelectItem>)}</Select><Select aria-label="Agrupar ventas por" selectedKey={dimension} onSelectionChange={key=>setDimension(String(key))}>{salesDimensions.map(d=><SelectItem id={d} key={d}>{d}</SelectItem>)}</Select><span>{branch} · MXN · IVA incluido</span></div><SalesSummary period={period} entries={baseRows}/></>}
   {(mod.id==='settings'&&view.id!=='locations'||!rows.length&&!!view.fields&&mod.id==='settings')&&view.fields?.length?<form className="d-settings-form" onSubmit={e=>{e.preventDefault();setNotice('Configuración guardada en esta demostración')}}><Fields fields={view.fields} values={config[scope+':'+view.id]||{}} onChange={(label,value)=>setConfig(c=>({...c,[scope+':'+view.id]:{...c[scope+':'+view.id],[label]:value}}))}/>{view.id==='walletdesign'&&<div className="d-wallet-preview"><span>ONCA</span><b>Café frecuente</b><p>Lucía Hernández</p><span>5 de 8 sellos</span></div>}<div className="d-form-actions"><Button type="submit">Guardar cambios</Button></div></form>:<>
    <div className="d-list-tools"><Input aria-label={`Buscar en ${view.label.toLowerCase()}`} placeholder={`Buscar en ${view.label.toLowerCase()}`} value={query} onChange={setQuery} leadingIcon={RiSearchLine}/><div>{filtersFor(view.id,rows).map(f=><Select key={f.label} aria-label={f.label} selectedKey={filter[f.label]||f.options[0]} onSelectionChange={key=>{setFilter(old=>({...old,[f.label]:String(key)}));setLimit(4)}}>{f.options.map(option=><SelectItem id={option} key={option}>{option}</SelectItem>)}</Select>)}<Button variant="secondary" leadingIcon={RiRefreshLine} onClick={()=>setNotice(`Datos del ejemplo actualizados · ${new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}`)}>Actualizar</Button><Button variant="secondary" leadingIcon={RiDownloadLine} onClick={exportRows}>Exportar</Button></div></div>
    {!readOnly&&['items','recipes','preparation','purchases','hours','giftcards'].includes(view.id)&&<div className="d-secondary-actions">{view.id==='items'&&<><Button variant="secondary" onClick={()=>action('Importar artículos')}>Importar artículos</Button><Button variant="secondary" onClick={()=>action('Iniciar conteo')}>Contar existencias</Button></>}{view.id==='recipes'&&<Button variant="secondary" onClick={()=>action('Importar recetas')}>Importar recetas</Button>}{view.id==='purchases'&&<Button variant="secondary" onClick={()=>action('Cargar CFDI XML')}>Cargar CFDI XML</Button>}{view.id==='hours'&&<Button variant="secondary" onClick={()=>action(config[scope+':hours']?.paused==='Sí'?'Reanudar pedidos':'Pausar pedidos')}>{config[scope+':hours']?.paused==='Sí'?'Reanudar pedidos':'Pausar pedidos'}</Button>}{view.id==='giftcards'&&<Button variant="secondary" onClick={()=>action('Canjear tarjeta')}>Canjear tarjeta</Button>}</div>}
    {view.id==='routes'&&<RoutePreview routes={records.routes} products={records.products} onEdit={entry=>setDetail({view,entry})}/>} {view.id==='terminals'&&!readOnly&&<ProviderPanel onAction={action} state={config[scope+':terminals']}/>} {view.id==='items'&&!readOnly&&<InventorySelection entries={shown} onSave={entries=>batchSave('items',entries)}/>} {view.id==='hours'&&config[scope+':hours']?.paused==='Sí'&&<p role="status" className="d-access-note">Pedidos pausados en todo el negocio. {config[scope+':hours']?.reason}</p>}
    {view.id==='inbox'?<div className="d-conversations">{shown.map(r=><Button data-target={`d-row-${shown.indexOf(r)}`} key={r.name} variant="ghost" className="d-conversation" onClick={()=>{setDetail({view:view.id==='inbox'?findView('customers'):view,entry:view.id==='inbox'?(records.customers.find(c=>c.name===r.name)||r):r});mainFade.reset()}}><span className="d-person-avatar">{r.name.slice(0,1)}</span><span><b>{r.name}</b><small>{r.cells[0]}</small></span><span className="d-conversation-meta">{r.detail}<small>{r.cells.at(-1)}</small></span><RiArrowRightLine size={18}/></Button>)}</div>:compact?<div className="d-mobile-records">{shown.length?shown.map((r,i)=><Button data-target={`d-row-${i}`} variant="ghost" key={i} onClick={()=>{setDetail({view:view.id==='inbox'?findView('customers'):view,entry:view.id==='inbox'?(records.customers.find(c=>c.name===r.name)||r):r});mainFade.reset()}}><span className="d-mobile-record-title"><b>{r.name}</b><RiArrowRightLine size={18}/></span>{r.detail&&<small>{r.detail}</small>}<span className="d-mobile-record-facts">{r.cells.map((cell,j)=><span key={j}><small>{view.columns[j+1]}</small><span>{cell}</span></span>)}</span></Button>):<div className="d-empty"><h2>No hay resultados</h2><Button variant="secondary" onClick={()=>{setQuery('');setFilter({})}}>Limpiar filtros</Button></div>}</div>:<Table aria-label={view.label} containerClassName="d-table-container" className="d-table" selectionMode="none" onRowAction={key=>{const entry=shown[Number(key)];if(entry){setDetail({view,entry});mainFade.reset()}}}>
     <TableHeader>{view.columns.map((col,i)=><TableColumn key={col} isRowHeader={i===0}>{col}</TableColumn>)}</TableHeader><TableBody renderEmptyState={()=><div className="d-empty"><h2>No hay resultados</h2><p>Prueba otro nombre o elimina el filtro.</p><Button variant="secondary" onClick={()=>{setQuery('');setFilter({})}}>Limpiar filtros</Button></div>}>{shown.map((r,i)=><TableRow data-target={`d-row-${i}`} key={i} id={String(i)} textValue={r.name}><TableCell><div className="d-cell-title">{view.id==='products'&&productPhoto[r.name]&&<img src={`/products/${productPhoto[r.name]}.jpg`} alt=""/>}<span><b>{r.name}</b>{r.detail&&<small>{r.detail}</small>}</span></div></TableCell>{r.cells.map((cell,j)=><TableCell key={j}>{/Estado|Disponibilidad/.test(view.columns[j+1])?<span className="d-status" data-status={r.status||'neutral'}>{cell}</span>:cell}</TableCell>)}</TableRow>)}</TableBody>
    </Table>}
    <div className="d-list-footer"><span>{shown.length} de {filtered.length} {filtered.length===1?'registro':'registros'}</span>{shown.length<filtered.length&&<Button variant="secondary" onClick={()=>setLimit(l=>l+4)}>Cargar más</Button>}<span>{['orders','refunds','shifts'].includes(view.id)?'Las operaciones se realizan en el POS':'Selecciona una fila para ver el detalle'}</span></div>
   </>}
   {view.id==='profile'&&<ProfileAccess role={role} products={productSet} onRole={role=>setRole(role as AccessContext['role'])} onProducts={setProductSet}/>}
   {view.note&&<details className="d-access-note"><summary>Alcance de esta pantalla</summary><p>{view.note}</p></details>}
  </>
 }
 const wrap=(content:ReactNode)=>unframed?<>{content}</>:<DeviceFrame device={device} orientation={orientation} dark={dark} title="UMI Dashboard">{content}</DeviceFrame>
 return wrap(<div className="u-app u-boardui d-app" data-theme={dark?'dark':'light'} data-phone={compact} data-portrait={portrait} data-view={menuPreview?'menu-digital':view.id} data-tour={!!tour}>
  {!signedIn?<DashboardLogin tour={tour} reset={current==='reset'} onEnter={()=>{setSignedIn(true);go('overview')}}/>:<>
   {(menuOpen||!compact&&!portrait)&&<aside className="d-sidebar" data-collapsed={collapsed&&!menuOpen}><div className="d-brand-row"><span className="d-logo">umi{(!collapsed||menuOpen)&&<em>dash</em>}</span><Button variant="ghost" iconOnly leadingIcon={menuOpen?RiCloseLine:RiMenuLine} aria-label={menuOpen?'Cerrar menú':collapsed?'Expandir menú':'Contraer menú'} onClick={()=>menuOpen?setMenuOpen(false):setCollapsed(!collapsed)}/></div>
    <div className="d-nav-wrap"><ScrollFade progress={navFade.progress} surfaceClassName="from-background-primary-default"/><nav  onScroll={navFade.onScroll} aria-label="Navegación del dashboard" className="d-nav" data-target="d-nav-scroll">{[...new Set(available.map(m=>m.group))].map(group=><div key={group} className="d-nav-group">{!collapsed&&<span>{group}</span>}{available.filter(m=>m.group===group).map(m=>{const disclosure=['reports','cash','products','inventory','diagnostics'].includes(m.id),open=tour?(tour.navExpanded===m.id||mod.id===m.id):(expanded[m.id]??mod.id===m.id);return <div className="d-nav-module" key={m.id}>{disclosure?<Button variant="ghost" className="d-nav-disclosure" data-target={`d-nav-${m.id}`} data-selected={mod.id===m.id} leadingIcon={iconFor[m.id]||RiLayoutGridLine} trailingIcon={!collapsed||menuOpen?RiArrowDownSLine:undefined} iconOnly={collapsed&&!menuOpen} aria-label={m.label} aria-expanded={open} onClick={()=>{if(collapsed&&!menuOpen)setCollapsed(false);setExpanded(old=>({...old,[m.id]:!open}))}}>{(!collapsed||menuOpen)&&m.label}</Button>:<SidebarNavItem target={`d-nav-${m.id}`} label={m.label} icon={iconFor[m.id]||RiLayoutGridLine} href={`?app=dashboard&view=${m.views[0].id}`} collapsed={collapsed&&!menuOpen} isSelected={!menuPreview&&mod.id===m.id} onClick={()=>go(m.views[0].id)}/>}{disclosure&&open&&(!collapsed||menuOpen)&&<div className="d-nav-submenu">{m.views.map(v=><SidebarNavItem key={v.id} target={`d-subnav-${v.id}`} label={v.label} icon={()=>null} href={`?app=dashboard&view=${v.id}`} isSelected={view.id===v.id} onClick={()=>go(v.id)}/>)}</div>}</div>})}</div>)}{menuPreview&&<SidebarNavItem label="Menú digital" icon={RiShoppingBag3Line} href="#" isSelected onClick={()=>{}}/>}</nav></div>
    {(!collapsed||menuOpen)&&<Select className="d-business-picker" label="Negocio" selectedKey={business} onSelectionChange={key=>{setBusiness(String(key));setBranch(key==='ONCA'?'Centro':'Principal');go('overview')}}>{['ONCA','Bruma Café'].map(b=><SelectItem id={b} key={b}>{b}</SelectItem>)}</Select>}
   </aside>}
   {menuOpen&&(compact||portrait)&&<button className="d-nav-backdrop" aria-label="Cerrar navegación" onClick={()=>setMenuOpen(false)}/>}
   <div className="d-shell"><header className="d-topbar"><div className="d-masthead">{(compact||portrait)&&<Button variant="ghost" iconOnly leadingIcon={RiMenuLine} data-target="d-menu-open" aria-label="Abrir menú" onClick={()=>{setCollapsed(false);setMenuOpen(true)}}/>}{compact&&<span className="d-mobile-brand">umi<em>dash</em></span>}<h1 className="d-context-title">{menuPreview?.title||(view.id==='overview'?`Buenas tardes, ${business}.`:view.label)}</h1><div className="d-masthead-controls"><Select className="d-branch-picker" aria-label="Sucursal" selectedKey={branch} onSelectionChange={key=>{setBranch(String(key));setDetail(null);setQuery('');setFilter({})}}>{[...new Set(branchOptions)].map(b=><SelectItem id={b} key={b}>{b}</SelectItem>)}</Select><Button variant="ghost" className="d-profile-action" data-target="d-nav-profile" aria-label="Abrir perfil" onClick={()=>go('profile')}><span className="d-avatar">SM</span><span className="d-profile-name">Sofía Martínez</span></Button></div></div><div className="d-dateline"><span className="d-connection"><i className="d-dot"/>En línea</span><span>{business}</span><span>·</span><span>{branch}</span><span className="d-day">· 1 nov 2026</span><time>14:52</time></div></header>
    {notice&&<div className="d-notice" role="status"><span>{notice}</span><Button variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="Cerrar aviso" onClick={()=>setNotice('')}/></div>}
    <div className="d-main-wrap"><ScrollFade progress={mainFade.progress} surfaceClassName="from-background-full"/><main className="d-main" data-target="d-main-scroll" ref={mainRef} onScroll={mainFade.onScroll}>{renderView()}{view.id==='profile'&&!detail&&<Button variant="secondary" leadingIcon={RiLogoutBoxLine} onClick={()=>setSignedIn(false)}>Cerrar sesión</Button>}</main></div>
   </div>
  </>}
 </div>)
}

function SalesSummary({period,entries}:{period:string;entries:Entry[]}){
 const products=reportRows('Producto',period,entries)
 const netSales=products.reduce((sum,row)=>sum+Number(row.cells[1].replace(/[^0-9.]/g,'')),0)
 const units=products.reduce((sum,row)=>sum+Number(row.cells[0]),0)
 // Paid orders belong to the report fixture, not to its product-unit count.
 const orders=products.length?48*salesPeriodFactor(period):0
 const average=orders?netSales/orders:0
 const leadingProduct=products.reduce<Entry|undefined>((leader,row)=>!leader||Number(row.cells[0])>Number(leader.cells[0])?row:leader,undefined)
 const amount=(n:number,decimals=2)=>n.toLocaleString('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:decimals,maximumFractionDigits:decimals})
 const count=(n:number)=>n.toLocaleString('es-MX')
 const opening=period==='7 días'?'En los últimos 7 días':period==='30 días'?'En los últimos 30 días':period
 // Stageshow uses a grounded example of the original optional sales insight.
 // Live UMI obtains this text from useSalesInsight for the same range and scope.
 const narrative=leadingProduct?`${opening} se registraron ${amount(netSales)} en ventas netas en ${count(orders)} pedidos pagados, con un ticket promedio de ${amount(average)}. Se vendieron ${count(units)} unidades; ${leadingProduct.name} fue el producto más vendido, con ${count(Number(leadingProduct.cells[0]))} unidades.`:null
 return <>
  <div className="d-sales-summary"><div><span>Ventas netas</span><strong>{amount(netSales,0)}</strong><small>{period} · IVA incluido</small></div><div><span>Pedidos pagados</span><strong>{count(orders)}</strong><small>Del periodo seleccionado</small></div><div><span>Ticket promedio</span><strong>{amount(average)}</strong><small>Por pedido pagado</small></div></div>
  {narrative&&<section className="d-surface d-sales-insight" aria-labelledby="sales-insight-title" data-target="d-sales-insight"><h2 id="sales-insight-title" className="text-body-semibold!">Resumen del periodo</h2><p className="text-body-regular!">{narrative}</p></section>}
 </>
}

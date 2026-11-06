import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Bell, CalendarDays, Check, ChevronDown, ChevronRight, CircleDollarSign, ClipboardList, Cloud, Coffee, CreditCard, Home, LayoutGrid, List, Mail, Menu, Monitor, MoreVertical, Package, Play, ReceiptText, RefreshCw, Search, Settings2, ShoppingBag, ShoppingCart, Sun, Table2, UserRound, Users, Utensils, Volume2 } from 'lucide-react'
import type { CancelCase, Chapter, Mode } from '../../playground/flow-data'
import './dashboard-source.css'
export type SceneProps={beat:number;chapter:Chapter;mode:Mode;cancelCase:CancelCase;compact:boolean}
const money='$210'
export function Dashboard({beat,mode,compact}:SceneProps) {
 const groups=[
  {title:'HOY',items:[['Panorama',Home]]},
  {title:'OPERACIÓN',items:[['Pedidos',ReceiptText],['Reportes',LayoutGrid],['Caja y turnos',CircleDollarSign],['Cocina',Monitor]]},
  {title:'CLIENTES',items:[['Clientes',Users],['Atención',Bell],['Lealtad y valor',CreditCard]]},
  {title:'NEGOCIO',items:[['Productos',Package],['Inventario',LayoutGrid],['Menú digital',ShoppingBag],['Plano de mesas',Table2]]}
 ] as const
 return <div className="dashboard-scene" data-compact={compact}>
  <div className="app"><aside className="side"><div className="side-head"><span className="side-brand-name">umi<em>dash</em></span></div>
   <nav className="side-nav">{groups.map(group=><div key={group.title}><div className="side-section">{group.title}</div>{group.items.map(([label,Icon])=><button key={label} className={'side-item'+(label==='Menú digital'?' active':'')}><span className="ic"><Icon size={18}/></span><span className="label">{label}</span></button>)}</div>)}</nav>
   <div className="side-foot"><span>Bruma</span><ChevronDown size={14}/></div>
  </aside><main className="main">
   <header className="topbar"><div className="masthead"><div className="masthead-row"><h1 className="h-page">Menú digital</h1><div className="top-actions"><Sun size={18}/><span>Español</span><ChevronDown size={13}/><span>Centro</span><ChevronDown size={13}/><span className="demo-profile">AB</span><span>Admin Bruma</span><ChevronDown size={13}/></div></div><div className="dateline"><span><i className="dot ok"/>En línea</span><span className="sep">·</span><span className="live">Bruma</span><span className="sep">·</span><span>Centro</span><span className="sep">·</span><span>DOM 1 DE NOV</span><span className="clock">12:12 P.M.</span></div></div></header>
   <div className="demo-dash-tabs"><span className="selected">General</span><span>Contenido</span><span>Enlaces y QR</span></div>
   <div className="demo-settings-grid">
    <section className="card demo-settings-card"><h2>Disponibilidad</h2><p>Configura el menú de esta sucursal.</p>
     <label className="demo-check-row"><input type="checkbox" checked readOnly/><span><strong>Publicar el menú</strong><small>Los clientes pueden consultar los productos.</small></span></label>
     <label className="demo-check-row" data-target="receive"><input type="checkbox" checked={beat>0} readOnly/><span><strong>Recibir pedidos</strong><small>{mode==='table'?'Pedidos desde el QR de una mesa.':'Pedidos para recoger en el negocio.'}</small></span></label>
     <div className="demo-setting-divider"/>
     <div className="demo-eyebrow">MODALIDADES</div>
     <label className="demo-check-row"><input type="checkbox" checked={mode==='table'} readOnly/><span><strong>En mesa</strong><small>Enviar a preparación y avisar al personal.</small></span></label>
     <label className="demo-check-row"><input type="checkbox" checked={mode!=='table'} readOnly/><span><strong>Para recoger</strong><small>El personal acepta el pedido antes de prepararlo.</small></span></label>
    </section>
    <section className="card demo-settings-card"><h2>Recogida y avisos</h2><p>Opciones para los pedidos de esta sucursal.</p>
     <label className="demo-check-row"><input type="checkbox" checked={mode==='scheduled'} readOnly/><span><strong>Permitir programar una hora</strong><small>Según el horario y los productos habilitados.</small></span></label>
     <div className="demo-setting-divider"/>
     <div className="demo-field"><span>Anticipación para preparar</span><div className="demo-select">20 minutos <ChevronDown size={15}/></div></div>
     <div className="demo-field"><span>Pago</span><div className="demo-select">En el negocio <ChevronDown size={15}/></div></div>
     <label className="demo-check-row"><input type="checkbox" checked readOnly/><span><strong>Avisos por correo electrónico</strong><small>Confirmación, pedido listo y cancelación.</small></span></label>
    </section>
   </div>
   <div className="demo-save"><span>{beat>=3?'Cambios guardados':'Los cambios aplican a Bruma · Centro.'}</span><button className="btn btn-primary" data-target="save">{beat>=3?<><Check size={17}/> Guardado</>:'Guardar cambios'}</button></div>
  </main></div>
 </div>
}
const nav=[['Comanda',ClipboardList],['Cuentas',Table2],['KDS',Utensils],['Ventas',ReceiptText],['Caja',CircleDollarSign],['Ajustes',Settings2]] as const
export function PosShell({children,kitchen=false,compact}: {children:ReactNode;kitchen?:boolean;compact:boolean}) {
 return <div className="native-scene" data-compact={compact}>
  <aside className="native-side"><div className="native-brand"><b>umi</b><small>ESTACIÓN</small></div><nav>{nav.map(([label,Icon])=><div key={label} className={label===(kitchen?'KDS':'Cuentas')?'selected':''}><Icon size={22}/><span>{label}</span></div>)}</nav></aside>
  <div className="native-main"><header className="native-header"><strong>{kitchen?'KDS':'Bruma'}</strong><div>{kitchen?<><Volume2 size={24}/><RefreshCw size={23}/></>:<><span className="native-online"><Cloud size={19}/>En línea</span><span className="new-order"><ShoppingCart size={21}/>Iniciar pedido</span><MoreVertical size={22}/><span className="native-operator"><UserRound size={22}/>Cajero Bruma<ChevronDown size={19}/></span></>}</div></header><div className="native-content">{children}</div></div>
  <nav className="native-bottom">{nav.map(([label,Icon])=><div key={label} className={label===(kitchen?'KDS':'Cuentas')?'selected':''}><Icon size={21}/><span>{label}</span></div>)}</nav>
 </div>
}
export function OrderLines(){return <div className="native-lines"><div><span><b>1 × French toast de la casa</b><small>Miel aparte</small></span><strong>$145</strong></div><div><span><b>1 × Latte de la casa</b><small>Leche entera</small></span><strong>$65</strong></div></div>}
export function Pos(props:SceneProps) {
 const {mode,chapter,beat,compact}=props,table=mode==='table',scheduled=mode==='scheduled'
 const paid=chapter==='pay'&&beat>0,delivered=chapter==='pay'&&beat>=3
 const accepted=table||(chapter==='accept'&&beat>0)
 const state=chapter==='cancel'?'Cancelación solicitada':delivered?'Entregado':paid?'Cobrado':chapter==='pay'?'Listo':accepted?scheduled?'Programado':'En preparación':'Pendiente'
 return <PosShell compact={compact}>
  <div className="native-title"><h1>{chapter==='pay'?'Cuenta 1042':chapter==='cancel'?'Pedido 1042':'Pedidos recibidos'}</h1><RefreshCw size={22}/></div>
  <div className="native-filter-row"><span className="native-filter selected">Recibidos (1)</span><span className="native-filter">En preparación</span><span className="native-filter">Programados</span></div>
  <div className="native-order-workspace">
   <div className="native-order-list"><article className="native-order-summary"><div><strong>#1042 · {table?'Mesa 12':'Ana'}</strong><span>{money}</span></div><p>{table?'Comer aquí':'Para llevar'} · Menú digital</p><span className={'native-state '+(accepted?'green':'')}>{state}</span><small>{scheduled?'Hoy · Recogida 17:30':'Hoy · 12:12'}</small></article></div>
   <section className="native-order-detail"><div className="native-detail-head"><h2>Pedido #1042</h2><span className="native-service">{table?<Utensils size={17}/>:<ShoppingBag size={17}/>} {table?'Comer aquí · Mesa 12':'Para llevar'}</span></div>
    <div className="native-facts"><div><small>{table?'Mesa':'Cliente'}</small><strong>{table?'12':'Ana'}</strong></div><div><small>Origen</small><strong>Menú digital</strong></div><div><small>Recogida</small><strong>{table?'Servicio en mesa':scheduled?'Hoy · 17:30':accepted||chapter==='pay'?'12:25':'Por confirmar'}</strong></div></div>
    <OrderLines/>
    <div className="native-total"><span>{paid?'Total pagado':'Total'}</span><strong>{money}</strong></div>
    {chapter==='accept'&&<><div className="native-note">{table?'Ya se envió a cocina y barra.':accepted?scheduled?'Horario reservado. Se enviará a preparación a las 17:10.':'Pedido aceptado. Cocina y barra pueden prepararlo.':'Revisa la disponibilidad antes de aceptar.'}</div>{!table&&<div className="native-actions">{!accepted&&<button className="native-button secondary">Rechazar</button>}<button className="native-button" data-target="accept" disabled={accepted}>{accepted?<><Check size={18}/>Pedido aceptado</>:'Aceptar pedido'}</button></div>}</>}
    {chapter==='pay'&&<><div className="native-payment-options"><span className="native-filter selected">Efectivo</span><span className="native-filter">Tarjeta</span></div><div className="native-actions"><button className="native-button" data-target="charge">{paid?<><Check size={18}/>{money} cobrados</>:<><CreditCard size={18}/>Cobrar {money}</>}</button><button className="native-button secondary" data-target="deliver">{delivered?'Entregado':'Registrar entrega'}</button></div><p className="native-subtle">{paid?'Saldo pendiente $0':'Pago en el negocio'}</p></>}
    {chapter==='cancel'&&<><div className="native-note">Ana solicitó cancelar. El pedido sigue activo hasta que el personal lo autorice.</div><div className="native-actions"><button className="native-button secondary">Mantener pedido</button><button className="native-button" data-target="approve-cancel">Autorizar cancelación</button></div></>}
   </section>
  </div>
 </PosShell>
}
export function Kitchen({beat,mode,compact}:SceneProps) {
 const held=mode==='scheduled'&&beat===0
 return <PosShell compact={compact} kitchen><div className="native-kds-meta">Sin estación · 0</div>
  <div className="native-filter-row"><span className="native-filter selected">Todos</span><span className="native-filter">Barra</span><span className="native-filter">Cocina</span><span className="native-filter selected">Hoy ({held?0:2})</span><span className="native-filter"><Clock/>Anteriores (0)</span></div>
  {held?<div className="native-reservation"><Utensils size={48}/><h2>Sin comandas en cocina.</h2></div>:<div className="native-tickets">
   {[{name:'Barra',item:'Latte de la casa',note:'Leche entera',ready:beat>=2,target:'bar-ready'},{name:'Cocina',item:'French toast de la casa',note:'Miel aparte',ready:beat>=3,target:'kitchen-ready'}].map(station=><article className={'native-ticket'+(station.ready?' ready':'')} key={station.name}>
    <div className="native-ticket-title"><strong>Cuenta 1042{mode==='table'?' · Mesa 12':''}</strong><span>2 min</span></div>
    <div className="native-ticket-badges"><span>{station.name}</span><span className={station.ready?'green':''}>{station.ready?'Listo':'En preparación'}</span><span>{mode==='table'?'Comer aquí':'Para llevar'}</span></div>
    <div className="native-ticket-item"><b>Tiempo 1</b><div><strong>1×</strong><span>{station.item}<small>{station.ready?'Listo · ':''}Hoy: 1</small><em>{station.note}</em></span><span className="native-checkbox" data-target={station.target}>{station.ready&&<Check size={18}/>}</span></div></div>
    <div className="native-ticket-actions"><button className="native-button secondary"><ArrowLeft size={18}/>{station.ready?'Recuperar':'En proceso'}</button>{station.ready&&<button className="native-button"><Check size={18}/>Terminar</button>}</div>
   </article>)}
  </div>}
  <div className="native-kds-status"><Check size={19}/>{beat>=3?'Pedido #1042 listo para entregar.':beat>=2?'Barra terminó. Cocina continúa en preparación.':held?'17:09 · El pedido permanece reservado.':'Cocina y barra preparan el pedido.'}</div>
 </PosShell>
}
function Clock(){return <span aria-hidden="true">◷</span>}
export function Email({mode}:SceneProps){return <div className="email-scene"><header><Mail size={21}/><strong>Correo de Ana</strong><span>Recibidos</span></header><main><h1>Tu pedido #1042 está listo</h1><div className="email-from"><span className="email-avatar">b</span><div><strong>Bruma · Centro</strong><small>Para: ana@example.com</small></div><span>17:30</span></div><article><h2>Hola, Ana.</h2><p>Ya puedes recoger tu pedido en Bruma · Centro.</p><div className="email-order"><strong>Pedido #1042</strong><OrderLines/><div className="native-total"><span>Pago en el negocio</span><strong>{money}</strong></div></div><p>{mode==='scheduled'?'Recogida programada: hoy a las 17:30.':'Pasa al mostrador y comparte tu número de pedido.'}</p><button className="native-button" data-target="view-order">Ver mi pedido<ArrowRight size={18}/></button><footer>Bruma · Centro, Mazatlán</footer></article></main></div>}

import type { ReactNode } from 'react'
import { Badge, Collapse, Count, Field, Phone, Row, Stage, States, Swap, Toggle, Window, type Act } from '../../kit'
import { Check, Clock3, Coffee, Mail, MapPin, ShoppingBag, Utensils, CalendarDays, CreditCard, CheckCircle2, Bell, ArrowUpRight } from 'lucide-react'
import { readChapter, readMode, type CancelCase } from '../../playground/flow-data'
import './flow.css'

// Adapted from device-pair: one main surface and a phone at its right edge.
const query = new URLSearchParams(location.search)
const mode = readMode(query.get('mode')), chapter = readChapter(query.get('chapter'))
const cancelCase: CancelCase = mode === 'table' ? 'preparing' : query.get('case') === 'accepted' ? 'accepted' : query.get('case') === 'preparing' ? 'preparing' : 'pending'
const table = mode === 'table', scheduled = mode === 'scheduled'
const directCancel = !table && (cancelCase === 'pending' || (scheduled && cancelCase === 'accepted'))
const pickup = scheduled ? '17:30' : '12:25'
type State = { beat: number }
const INITIAL: State = { beat: 0 }, POSTER: State = { beat: 3 }
const stop = { x: 590, y: 74 }
const script = async (a: Act<State>) => {
  a.mark('inicio'); await a.wait(1000)
  const beat = (n: number, name: string) => { a.put({beat:n}); a.mark(name) }
  const press = (target: string) => a.click({at:target,x:0.85,y:0.5})
  if (chapter === 'config') {
    await a.click('receive'); beat(1,'recepcion'); await a.wait(1100)
    await press('save'); beat(3,'guardado')
  } else if (chapter === 'menu') {
    await a.click('add-toast'); beat(1,'tostada'); await a.wait(1000)
    await a.click('add-coffee'); beat(2,'latte'); await a.wait(1000)
    await press('review'); beat(3,'carrito')
  } else if (chapter === 'send') {
    await press('confirm'); beat(1,'enviado'); await a.wait(1400); beat(3,'recibido')
  } else if (chapter === 'accept') {
    if (!table) await press('accept')
    beat(1,'aceptado'); await a.wait(1600); beat(3,scheduled?'reservado':'preparacion')
  } else if (chapter === 'kitchen') {
    if (scheduled) { await a.wait(700); beat(1,'liberado'); await a.wait(1300) }
    await press('bar-ready'); beat(2,'barra-lista'); await a.wait(1600)
    await press('kitchen-ready'); beat(3,'todo-listo')
  } else if (chapter === 'notify') {
    beat(1,'listo'); await a.wait(1800); beat(3,table?'aviso-personal':'correo')
  } else if (chapter === 'pay') {
    await press('charge'); beat(1,'cobrado'); await a.wait(1600)
    await press('deliver'); beat(3,'entregado')
  } else {
    await press('cancel'); beat(1,directCancel?'cancelado':'solicitado'); await a.wait(1800)
    if (!directCancel && a.layout === 'wide') await press('approve-cancel')
    beat(3,directCancel?'cancelado':'autorizado')
  }
  if (a.layout === 'wide') await a.move(stop)
  await a.wait(2200); a.mark('fin')
}
function Action({name,children,secondary=false,done=false}: {name?:string;children:ReactNode;secondary?:boolean;done?:boolean}) {
  return <span className={'uf-action'+(secondary?' secondary':'')} data-target={name} data-cursor="pointer" data-done={done||undefined}>{children}</span>
}
function Brand() { return <span className="uf-brand">umi<span> / </span><small>{table?'Mesa 12':'Menú digital'}</small></span> }
function Lines({count=2}: {count?:number}) { return <div className="uf-lines"><Collapse open={count===0}><div className="uf-empty">Elige productos del menú.</div></Collapse><Collapse open={count>=1}>
  <Row lead={<img src="/assets/toast.jpg" alt=""/>} title="French toast" subtitle="1 × Miel aparte" meta="$145"/></Collapse><Collapse open={count>=2}>
  <Row lead={<img src="/assets/coffee.jpg" alt=""/>} title="Latte" subtitle="1 × Leche entera" meta="$70"/></Collapse>
</div> }
function OrderMeta({pending=false}: {pending?:boolean}) { return <div className="uf-meta">
  <span><small>{table?'Mesa':'Cliente'}</small><strong>{table?'12':'Ana'}</strong></span>
  <span><small>{table?'Servicio':pending?'Hora solicitada':'Recogida'}</small><strong>{table?'Comer aquí':scheduled?'Hoy · 17:30':pending?'Por confirmar':'Hoy · 12:25'}</strong></span>
</div> }
function Settings({beat}:State) { return <div className="uf-settings">
  <div className="uf-overline">Bruma · Sucursal Centro</div><div className="uf-title">Menú digital</div>
  <div className="uf-settings-tabs"><span className="active">General</span><span>Contenido</span><span>Enlaces y QR</span></div>
  <Row title="Menú publicado" subtitle="El catálogo está disponible." meta={<Toggle on aria-label="Menú publicado"/>}/>
  <Row title="Recibir pedidos" subtitle="Habilita pedidos en esta sucursal." meta={<Toggle on={beat>0} data-target="receive" aria-label="Recibir pedidos"/>}/>
  <div className="uf-section-label">Modalidades</div>
  <Row lead={<Utensils size={18}/>} title="En mesa" meta={<Toggle on aria-label="En mesa"/>}/>
  <Row lead={<ShoppingBag size={18}/>} title="Para recoger" meta={<Toggle on aria-label="Para recoger"/>}/>
  <Row lead={<CalendarDays size={18}/>} title="Recogida programada" meta={<Toggle on aria-label="Recogida programada"/>}/>
  <div className="uf-settings-bottom"><span>Pago en el negocio</span><Badge tone={beat===3?'success':'neutral'}><States value={beat===3?'yes':'no'} states={{yes:'Guardado',no:'Sin cambios'}}/></Badge></div>
  <Action name="save" done={beat===3}><States value={beat===3?'yes':'no'} states={{yes:<><Check size={18}/> Cambios guardados</>,no:'Guardar cambios'}}/></Action>
</div> }
function Menu({beat}:State) { return <div className="uf-menu">
  <Brand/><div className="uf-menu-head"><div className="uf-title">Desayunos y café</div><p>Preparados al momento.</p></div>
  <img className="uf-menu-hero" src="/assets/toast.jpg" alt="French toast con plátano y miel"/>
  <div className="uf-feature"><div><strong>French toast</strong><span>Pan brioche, plátano y miel.</span><b>$145</b></div><span className="uf-add" data-target="add-toast" data-cursor="pointer"><States value={beat>0?'yes':'no'} states={{yes:<Check size={18}/>,no:'+'}}/></span></div>
  <Row lead={<img className="uf-thumb" src="/assets/coffee.jpg" alt=""/>} title="Latte" subtitle="Leche entera · $70" meta={<span className="uf-add" data-target="add-coffee" data-cursor="pointer"><States value={beat>1?'yes':'no'} states={{yes:<Check size={18}/>,no:'+'}}/></span>}/>
  <Action name="review"><span>Revisar pedido</span><span>$<Count value={beat>1?215:beat>0?145:0}/></span></Action>
</div> }
function Cart({beat,checkout=false}:State&{checkout?:boolean}) { const count=chapter==='menu'?Math.min(beat,2):2; return <div className="uf-cart">
  <Brand/><div className="uf-title">{checkout?'Confirmar pedido':'Tu pedido'}</div>
  <div className="uf-location"><MapPin size={16}/><span>{table?'Mesa 12 · Bruma':'Bruma · Centro'}</span></div>
  <Lines count={count}/>
  {checkout&&!table&&<div className="uf-contact"><Field label="Nombre" value="Ana"/><Field label="Celular" value="669 000 0000"/><Field label="Correo" value="ana@example.com"/></div>}
  {!checkout&&<div className="uf-cart-note"><Clock3 size={18}/><div>{scheduled?'Hoy, a las 17:30':table?'Se prepara al enviar':'Lo antes posible'}<small>{table?'Si necesitas cambiar algo, avisa al personal.':'El negocio debe aceptar tu pedido.'}</small></div></div>}
  {checkout&&scheduled&&<div className="uf-schedule"><CalendarDays size={16}/><span>Hoy · 17:30</span><small>Cancelación directa hasta 17:00</small></div>}
  <div className="uf-total"><span>Total</span><strong>$<Count value={count===2?215:count===1?145:0}/></strong></div>
  <Action name={checkout?'confirm':undefined}><States value={checkout&&beat>0?'yes':'no'} states={{yes:<><Check size={18}/> Pedido enviado</>,no:checkout?'Confirmar pedido':'Continuar'}}/></Action><p className="uf-footnote">Pagas en el negocio</p>
</div> }
function Tracking({title,detail,done=false,children}: {title:string;detail:string;done?:boolean;children?:ReactNode}) { return <div className="uf-tracking">
  <Brand/><div className="uf-order-id">Pedido #1042</div>
  <span className={'uf-status-icon'+(done?' complete':'')}><States value={done?'done':'pending'} states={{done:<CheckCircle2 size={28}/>,pending:<Clock3 size={28}/>}}/></span>
  <div className="uf-track-heading"><Swap id={title}><div className="uf-title">{title}</div></Swap></div>
  <div className="uf-track-detail"><Swap id={detail}><p>{detail}</p></Swap></div>
  <OrderMeta pending={title==='Pedido recibido'}/><Lines/><div className="uf-total"><span>{chapter==='cancel'?'Importe del pedido':chapter==='pay'&&done?'Total pagado':'Pago en el negocio'}</span><strong>$215</strong></div>{children}
</div> }
function StatusPhone({beat}:State) {
  if(chapter==='config') return <div className="uf-phone-catalog"><Menu beat={0}/><div className="uf-menu-availability"><Swap id={String(beat===3)}>{beat===3?'Abierto para pedidos':'Consulta nuestro menú'}</Swap></div></div>
  if(chapter==='menu') return <Cart beat={beat}/>
  if(chapter==='send') return <div className="uf-phone-pages">
    <div className="uf-page" data-visible={beat===0||undefined}><Cart beat={beat} checkout/></div>
    <div className="uf-page" data-visible={beat>0||undefined}><Tracking title={table?'En preparación':'Pedido recibido'} detail={table?'Cocina y barra recibieron tu pedido.':'El negocio debe aceptar tu pedido.'}/></div>
  </div>
  if(chapter==='accept') return <Tracking title={table||beat>0?scheduled?'Recogida confirmada':'En preparación':'Pedido recibido'} detail={table?'El personal lo llevará a tu mesa.':beat===0?'Espera la confirmación del negocio.':scheduled?'Te esperamos hoy a las 17:30.':'Cocina y barra preparan tu pedido.'}/>
  if(chapter==='kitchen') return <Tracking title={beat===3?'Tu pedido está listo':scheduled&&beat===0?'Recogida confirmada':'En preparación'} detail={beat===3?table?'El personal lo llevará a tu mesa.':'Puedes pasar por Bruma · Centro.':scheduled&&beat===0?'La preparación empieza a las 17:10.':beat===2?'El latte está listo. Falta el French toast.':'Cocina y barra preparan tu pedido.'} done={beat===3}/>
  if(chapter==='notify') return <Tracking title="Tu pedido está listo" detail={table?'El personal lo llevará a la mesa 12.':'Pasa por Bruma · Centro. Pagas al recoger.'} done>{!table&&<div className="uf-mail-note"><Mail size={18}/><span>Aviso por correo<small>ana@example.com</small></span></div>}</Tracking>
  if(chapter==='pay') return <Tracking title={beat===3?'Pedido entregado':beat>0?'Pago recibido':'Tu pedido está listo'} detail={beat===3?'Gracias por tu pedido.':beat>0?'El personal registró tu pago.':table?'Pide la cuenta al personal.':'Muestra el número #1042 al recoger.'} done={beat>0}/>
  const canceled=(directCancel&&beat>0)||beat===3
  return <Tracking title={canceled?'Pedido cancelado':beat>0?'Cancelación solicitada':cancelCase==='pending'?'Pedido recibido':scheduled&&cancelCase==='accepted'?'Recogida confirmada':'En preparación'} detail={canceled?'No hay ningún cobro pendiente.':beat>0?'El pedido sigue activo. Esperamos al personal.':directCancel?'Puedes cancelar directamente.':'La cancelación necesita autorización.'} done={canceled}><Action name="cancel" secondary done={canceled}><States value={canceled?'done':beat>0?'request':'start'} states={{done:'Cancelado',request:'Esperando respuesta',start:directCancel?'Cancelar pedido':'Solicitar cancelación'}}/></Action></Tracking>
}
function Pos({beat}:State) {
  const beforeSend=chapter==='send'&&beat===0, accepted=table||chapter==='pay'||(chapter==='accept'&&beat>0)
  const canceled=chapter==='cancel'&&((directCancel&&beat>0)||beat===3)
  const state=canceled?'Cancelado':chapter==='cancel'?(beat>0?'Cancelación solicitada':cancelCase==='pending'?'Pendiente':scheduled&&cancelCase==='accepted'?'Programado':'En preparación'):chapter==='pay'?beat===3?'Entregado':beat>0?'Cobrado':'Listo':beforeSend?'Sin enviar':accepted?scheduled?'Programado':'En preparación':'Pendiente'
  return <div className="uf-pos">
    <div className="uf-overline">UmiPOS · Bruma Centro</div><div className="uf-title">{chapter==='pay'?'Cobrar pedido':'Pedidos digitales'}</div>
    <div className="uf-pos-tabs"><span className="active">{chapter==='pay'?'Listos':table?'En preparación':'Recibidos'}</span><span>Programados</span><span>Historial</span></div>
    <div className="uf-inbox-before" data-show={beforeSend||undefined}><div className="uf-inbox-title">Sin pedidos nuevos</div><p>Los pedidos aparecerán aquí cuando el cliente confirme.</p><Row title="#1040 · Para llevar" subtitle="En preparación" meta="$120"/><Row title="#1039 · Mesa 8" subtitle="Listo" meta="$190"/></div><div className="uf-pos-ticket" data-hidden={beforeSend||undefined}><div className="uf-ticket-head"><span className="uf-ticket-number">#1042</span><Badge tone={canceled?'danger':state==='Pendiente'?'warning':'success'}><Swap id={state}>{state}</Swap></Badge></div>
      <div className="uf-service"><ShoppingBag size={16}/><span>{table?'Comer aquí · Mesa 12':'Para llevar'}</span><span>Origen: menú digital</span></div>
      <OrderMeta pending={state==='Pendiente'}/><Lines/><div className="uf-total"><span>Total del pedido</span><strong>$215</strong></div>
      {chapter==='accept'&&!table&&<Action name="accept" done={beat>0}><States value={beat>0?'yes':'no'} states={{yes:<><Check size={18}/> Pedido aceptado</>,no:'Aceptar pedido'}}/></Action>}
      {chapter==='accept'&&table&&<div className="uf-callout"><Bell size={18}/><span>Nuevo pedido de la mesa 12<small>Ya se envió a cocina y barra.</small></span></div>}
      {chapter==='send'&&<div className="uf-callout"><Bell size={18}/><Swap id={state}><span>{beforeSend?'El cliente revisa su pedido.':table?'Pedido enviado a preparación.':'Nuevo pedido por aceptar.'}</span></Swap></div>}
      {chapter==='pay'&&<div className="uf-pay-actions"><Action name="charge" done={beat>0}><States value={beat>0?'yes':'no'} states={{yes:<><Check size={18}/> $215 cobrados</>,no:<><CreditCard size={18}/> Cobrar $215</>}}/></Action><Action name="deliver" secondary done={beat===3}><States value={beat===3?'yes':'no'} states={{yes:'Entregado',no:'Registrar entrega'}}/></Action></div>}
      {chapter==='cancel'&&<Action name="approve-cancel" done={canceled} secondary><States value={canceled?'done':beat>0?'request':'idle'} states={{done:'Pedido cancelado',request:'Autorizar cancelación',idle:'Pedido activo'}}/></Action>}
    </div><div className="uf-pos-bottom" data-hidden={beforeSend||undefined}><span>{scheduled?'Recogida · 17:30':table?'Mesa 12':'Recogida · 12:25'}</span><span>{chapter==='pay'&&beat>0?'Saldo $0':'Pago pendiente'}</span></div>
  </div>
}
function Kitchen({beat}:State) {
  const held=scheduled&&beat===0
  return <div className="uf-kitchen">
    <div className="uf-overline">Preparación</div><div className="uf-kds-header"><div className="uf-title"><Swap id={String(held)}>{held?'Pedido programado':'Pedido #1042'}</Swap></div><span className="uf-clock"><Clock3 size={16}/><Swap id={String(held)}>{held?'17:09':scheduled?'17:10':'12:12'}</Swap></span></div>
    <div className="uf-kds-service">{table?'Comer aquí · Mesa 12':'Para llevar'}{scheduled&&<span>Recogida 17:30</span>}</div>
    <div className="uf-held" data-show={held||undefined}><CalendarDays size={30}/><strong>Reservado en UmiPOS</strong><span>Recogida a las 17:30</span><p>Se enviará a cocina y barra a las 17:10.</p></div><div className="uf-stations" data-held={held||undefined}>{[{name:'Barra',item:'Latte',note:'Leche entera',ready:beat>=2,target:'bar-ready',icon:<Coffee size={20}/>},{name:'Cocina',item:'French toast',note:'Miel aparte',ready:beat>=3,target:'kitchen-ready',icon:<Utensils size={20}/>}].map(station=><div className="uf-station" key={station.name} data-ready={station.ready||undefined}>
      <div className="uf-station-heading">{station.icon}<strong>{station.name}</strong></div>
      <div className="uf-station-body"><div className="uf-station-number">#1042</div><div className="uf-station-item">1 × {station.item}</div><div className="uf-station-note">{station.note}</div><Action name={station.target} done={station.ready}><States value={station.ready?'yes':held?'held':'no'} states={{yes:<><Check size={18}/><span className="uf-ready-label">Listo</span></>,held:'En espera',no:'Marcar listo'}}/></Action></div>
    </div>)}</div>
    <div className="uf-kds-progress"><span>Productos listos</span><span><Count value={beat>=3?2:beat>=2?1:0}/> / 2</span></div><div className="uf-progress-track"><span style={{width:beat>=3?'100%':beat>=2?'50%':'0%'}}/></div>
    <div className="uf-callout"><CheckCircle2 size={18}/><Swap id={String(beat)}><span>{beat>=3?'Pedido listo para entregar.':held?'La aceptación reservó el horario.':'El pedido continúa en preparación.'}</span></Swap></div>
  </div>
}
function Notification({beat}:State) {
  if(table) return <div className="uf-notification"><div className="uf-overline">UmiPOS · Servicio</div><div className="uf-title">Llevar a la mesa 12</div><div className="uf-ready-card"><CheckCircle2 size={36}/><span>Pedido #1042 listo</span><small>Cocina y barra terminaron.</small></div><Lines/><div className="uf-callout"><Utensils size={18}/><span>El personal entrega los productos.<small>El cliente conserva su seguimiento web.</small></span></div></div>
  return <div className="uf-notification"><div className="uf-overline">Correo de ejemplo</div><div className="uf-title">Tu pedido está listo</div><div className="uf-email-meta"><Mail size={22}/><div><strong>Bruma · Centro</strong><span>Para: ana@example.com</span></div><Badge tone={beat>0?'success':'neutral'}><States value={beat>0?'yes':'no'} states={{yes:'Aviso generado',no:'Pendiente'}}/></Badge></div>
    <div className="uf-email-body"><p>Hola, Ana.</p><p>Tu pedido <strong>#1042</strong> está listo para recoger.</p><div className="uf-email-location"><MapPin size={20}/><div><strong>Bruma · Centro</strong><span>Recogida {pickup} · Pagas en el negocio</span></div></div><Lines/><Action>Ver mi pedido <ArrowUpRight size={18}/></Action></div>
  </div>
}
function MainContent({beat}:State) {
  if(chapter==='config') return <Settings beat={beat}/>
  if(chapter==='menu') return <Menu beat={beat}/>
  if(chapter==='kitchen') return <Kitchen beat={beat}/>
  if(chapter==='notify') return <Notification beat={beat}/>
  return <Pos beat={beat}/>
}
function Compact({beat}:State) {
  if(chapter==='send'||chapter==='cancel') return <StatusPhone beat={beat}/>
  return <MainContent beat={beat}/>
}
const phoneTime=(beat:number)=>!scheduled?'12:12':chapter==='kitchen'?(beat===0?'17:09':'17:10'):chapter==='pay'?'17:32':chapter==='notify'?'17:30':chapter==='cancel'&&cancelCase==='accepted'?'16:50':chapter==='cancel'&&cancelCase==='preparing'?'17:15':'16:30'
const titles={config:'Umi Dashboard',menu:'Menú digital',send:'UmiPOS',accept:'UmiPOS',kitchen:'Umi · Preparación',notify:table?'UmiPOS':'Correo del pedido',pay:'UmiPOS',cancel:'UmiPOS'}
export default function UmiFlow() {
  return <Stage<State> width={1000} height={700} compact={{below:850,width:372,height:660}} className={'umi-flow chapter-'+chapter} initial={INITIAL} poster={POSTER} script={script} play="once" fidelity="realistic" accent="#223979" greys="cool"
    cursor={{at:{wide:stop,compact:{x:300,y:80}},style:'touch',idle:900}}
    tokens={{'--ss-font':'"Source Sans 3", sans-serif','--ss-text-strong':'#131F44','--ss-text':'#344361','--ss-text-muted':'#566785','--ss-canvas':'#EEF1F8','--ss-well':'#EEF1F8','--ss-accent':'#223979','--ss-line':'#DDE3F0'}}>
    {(s,_rect,layout)=>layout==='compact'?<Phone width={340} className="uf-compact" frame="silver" time={phoneTime(s.beat)}><Compact {...s}/></Phone>:<>
      <Window title={titles[chapter]} className="uf-window"><aside className="uf-side" aria-hidden="true"><span className="uf-side-word">umi</span><ShoppingBag size={20}/><Coffee size={20}/><CalendarDays size={20}/><CreditCard size={20}/></aside><div className="uf-main"><MainContent {...s}/></div></Window>
      <Phone width={340} frame="silver" className="uf-phone" time={phoneTime(s.beat)}><StatusPhone {...s}/></Phone>
    </>}
  </Stage>
}

import { useState, type Dispatch, type SetStateAction } from 'react'
import { RiArrowLeftLine, RiArrowRightLine, RiLockLine, RiArrowDownLine, RiArrowUpLine, RiSafe2Line } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { ScrollFade, useScrollFade } from '@/components/foundations/scroll-fade/scroll-fade'
import { Tabs, TabList, Tab, TabPanel } from '@/components/base/tabs/tabs'
import { CashCount, type CashPolicy } from './CashCount'

type Status='open'|'suspended'|'counting'|'review'|'reconciled'|'closed'
type Movement={id:number;type:string;amount:number;reason:string;time:string}
export type CashState={status:Status;owner:string;opening:number;sales:number;movements:Movement[];counted:number|null;reason:string;resolved:boolean;log:string[];postedAccounts:string[]}
export const initialCash:CashState={status:'open',owner:'Ana',opening:500,sales:1860,movements:[{id:1,type:'Retiro a caja fuerte',amount:-500,reason:'Resguardo de efectivo',time:'12:20'}],counted:null,reason:'',resolved:false,log:[],postedAccounts:[]}
const money=(n:number)=>n.toLocaleString('es-MX',{style:'currency',currency:'MXN'})
const statusName:Record<Status,string>={open:'Turno abierto',suspended:'Turno suspendido',counting:'Conteo en curso',review:'Revisar diferencia',reconciled:'Listo para cerrar',closed:'Turno cerrado'}
const movements=['Entrada de efectivo','Salida de efectivo','Retiro a caja fuerte']
const movementInfo:Record<string,{kind:string;icon:typeof RiArrowDownLine;detail:string}>={
  'Entrada de efectivo':{kind:'in',icon:RiArrowDownLine,detail:'Suma al efectivo'},
  'Salida de efectivo':{kind:'out',icon:RiArrowUpLine,detail:'Resta del efectivo'},
  'Retiro a caja fuerte':{kind:'safe',icon:RiSafe2Line,detail:'Resguardo de efectivo'},
}

export function Cash({state,setState,preview,compact,policy,design='1'}:{design?:'1'|'2'|'3';state:CashState;setState:Dispatch<SetStateAction<CashState>>;preview:(message:string)=>void;compact:boolean;policy:CashPolicy}){
  const [action,setAction]=useState('')
  const [amount,setAmount]=useState('')
  const [reason,setReason]=useState('')
  const [pin,setPin]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [mobileTab,setMobileTab]=useState('movements')
  const fade=useScrollFade()
  const expected=state.opening+state.sales+state.movements.reduce((sum,m)=>sum+m.amount,0)
  const difference=(state.counted??expected)-expected
  const expectedVisible=!policy.blindCountRequired||(state.counted!==null&&state.status!=='counting')
  const open=state.status==='open'
  const update=(patch:Partial<CashState>)=>setState(c=>({...c,...patch}))
  const begin=(name:string)=>{setAction(name);setAmount('');setReason('');setPin('');setError('');setNotice('');fade.reset();if(name==='Solicitar apertura de cajón'||name==='Entregar turno'||movements.includes(name))preview(name==='Entregar turno'?'PIN de operador entrante para esta demostración: 6842.':'PIN gerencial de demostración: 4826. El prototipo no mueve dinero ni hardware.')}
  const approval=()=>{if(pin==='4826')return true;setError('PIN gerencial incorrecto.');return false}
  const finish=()=>{setAction('');setError('');setPin('');fade.reset()}
  const submitMovement=()=>{
    const value=Number(amount)
    if(value<=0||!reason.trim())return
    if(action!=='Entrada de efectivo'&&value>expected){setError('El importe supera el efectivo esperado.');return}
    if(value>=500&&!approval())return
    setState(c=>({...c,movements:[{id:Date.now(),type:action,amount:action==='Entrada de efectivo'?value:-value,reason:reason.trim(),time:'14:52'},...c.movements]}));finish();setNotice('Movimiento registrado.')
  }
  const pinField=<Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="PIN gerencial" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={value=>{setPin(value);setError('')}} hint="Autorización del encargado"/>
  const balance=<div className="u-cash-expected"><span>Efectivo esperado</span>{expectedVisible?<strong>{money(expected)}</strong>:<b className="u-cash-hidden-total">Disponible al enviar el conteo</b>}<small>Desde las 08:00 · {state.owner}</small></div>
  const equation=<dl className="u-cash-equation">{[['Fondo inicial',state.opening],['Ventas en efectivo',state.sales],['Entradas',state.movements.filter(m=>m.amount>0).reduce((n,m)=>n+m.amount,0)],['Salidas y retiros',state.movements.filter(m=>m.amount<0).reduce((n,m)=>n+m.amount,0)]].map(([name,value])=><div key={name}><dt>{name}</dt><dd>{money(Number(value))}</dd></div>)}</dl>
  const book=<section className="u-cash-book"><h2>Libro del turno</h2><div className="u-cash-log-row"><span>08:00</span><div><b>Apertura de turno</b><small>Fondo inicial · {state.owner}</small></div><strong>{money(state.opening)}</strong></div>{state.movements.map(m=><div className="u-cash-log-row" key={m.id}><span>{m.time}</span><div><b>{m.type}</b><small>{m.reason}</small></div><strong>{m.amount>0?'+':''}{money(m.amount)}</strong></div>)}{state.log.map((entry,index)=><div className="u-cash-log-row" key={index}><span>14:52</span><div><b>{entry}</b></div></div>)}</section>
  const ledger=<>{equation}{book}</>

  const movementActions=<section className="u-cash-movements">      <h2>Movimientos</h2><div className="u-cash-action-list">{movements.map(name=><Button key={name} variant="secondary" className="u-cash-action min-h-16 justify-start shadow-none" data-kind={movementInfo[name].kind} aria-label={name} aria-description={movementInfo[name].detail} leadingIcon={movementInfo[name].icon} disabled={!open} onClick={()=>begin(name)}><span className="u-cash-action-copy"><b>{name}</b><small>{movementInfo[name].detail}</small></span></Button>)}<Button variant="ghost" className="min-h-12 justify-start" leadingIcon={RiLockLine} disabled={!open} onClick={()=>begin('Solicitar apertura de cajón')}>Solicitar apertura de cajón</Button></div></section>
  const administration=<>
      <section className="u-cash-section"><h2>Administrar turno</h2><div className="u-config-actions"><Button variant="secondary" className="min-h-11" disabled={!['open','suspended'].includes(state.status)} onClick={()=>{const suspended=state.status==='open';update({status:suspended?'suspended':'open',log:[...state.log,suspended?'Turno suspendido':'Turno reanudado']})}}>{state.status==='suspended'?'Reanudar turno':'Suspender turno'}</Button><Button variant="ghost" className="min-h-11" disabled={!open} onClick={()=>begin('Entregar turno')}>Entregar turno</Button></div></section></>
  const closeStep=state.status==='closed'?4:state.status==='reconciled'?3:state.counted!==null&&state.status!=='counting'?(state.resolved?2:1):0
  const countLabel=policy.blindCountRequired?'Iniciar conteo ciego':'Contar el cajón'
  const closing=<section className="u-cash-section u-cash-closing"><h2>Cierre de caja</h2>
    <ol className="u-cash-close-steps">{['Contar efectivo','Revisar diferencia','Conciliar turno','Cerrar turno'].map((name,index)=><li key={name} data-complete={index<closeStep} aria-current={index===closeStep?'step':undefined}><span>{index+1}</span>{name}</li>)}</ol>
    {state.status==='closed'?<><dl className="u-cash-equation"><div><dt>Contado</dt><dd>{money(state.counted??0)}</dd></div><div><dt>Diferencia</dt><dd>{money(difference)}</dd></div></dl><p>{state.reason||'Sin diferencia'}</p><Button className="min-h-12 w-full" onClick={()=>begin('Abrir turno')}>Abrir otro turno</Button></>:<>
      <Button className="min-h-12 w-full justify-between shadow-none" trailingIcon={RiArrowRightLine} disabled={state.status==='suspended'} onClick={()=>{if(closeStep===2){update({status:'reconciled'});begin('Conciliación')}else begin(closeStep===0?'Conteo':closeStep===1?'Revisión':'Confirmar cierre')}}>{closeStep===0?countLabel:closeStep===1?'Revisar diferencia':closeStep===2?'Conciliar turno':'Cerrar turno'}</Button>
      {state.counted!==null&&<Button variant="ghost" className="min-h-11" onClick={()=>begin('Cancelar conteo')}>Cancelar conteo y volver a abierto</Button>}
    </>}
  </section>
  const policyNote=<details className="u-cash-policy"><summary>Política de esta caja</summary><p>{policy.blindCountRequired?'Conteo ciego':'Conteo visible'} · {policy.countMethod==='total_only'?'Importe total':'Por denominaciones'}. Movimientos desde $500 requieren PIN gerencial. Las diferencias requieren autorización. Operación con conexión.</p></details>
  const counter=action==='Conteo'||action==='Abrir turno'
  return <section className="u-cash-manager u-boardui" data-counting={counter}>
    <header className="u-cash-head"><div><span className="u-overline">Caja principal · 01 nov 2026</span><h1>Turno de {state.owner}</h1></div><span className="u-cash-status" data-open={open}>{statusName[state.status]}</span></header>
    {notice&&<p className="u-cash-notice" role="status">{notice}</p>}
    {counter?<CashCount design={design} key={action} policy={policy} opening={action==='Abrir turno'} recount={state.counted!==null&&action==='Conteo'} expected={expected} onBack={finish} onSubmit={total=>{
      if(action==='Abrir turno'){setState({...initialCash,opening:total,sales:0,movements:[],log:[]});setMobileTab('movements');finish();setNotice('Turno abierto.');return}
      update({counted:total,status:'review',resolved:total===expected,reason:total===expected?'Sin diferencia':'',log:[...state.log,`Conteo enviado: ${money(total)}`]});setAction('Revisión');setPin('');fade.reset();preview('PIN gerencial para revisar diferencias en esta demostración: 4826.')
    }}/>:<>
    {!action&&compact&&design!=='3'?<Tabs className="u-cash-mobile-tabs" selectedKey={mobileTab} onSelectionChange={key=>{setMobileTab(String(key));fade.reset()}}>
      <TabList aria-label="Secciones de Caja"><Tab id="movements">Movimientos</Tab><Tab id="shift">Turno</Tab><Tab id="close">Cierre</Tab></TabList>
      {balance}
      <div className="u-cash-scroll-wrap"><div key={mobileTab} className="u-cash-content" onScroll={fade.onScroll}>
        <TabPanel id="movements">{movementActions}</TabPanel>
        <TabPanel id="shift">{administration}{ledger}</TabPanel>
        <TabPanel id="close">{closing}{policyNote}</TabPanel>
      </div><ScrollFade progress={fade.progress} surfaceClassName="from-background-full"/></div>
    </Tabs>:<div className="u-cash-scroll-wrap"><div key={action} className="u-cash-content" onScroll={fade.onScroll}>
    {!action&&<div className="u-cash-columns">{design==='1'?<><div className="u-cash-ledger-main">{balance}{ledger}</div><aside className="u-cash-controls">{state.status!=='closed'&&<>{movementActions}{administration}</>}{closing}{policyNote}</aside></>:<><div className="u-cash-status-band">{balance}{equation}</div><div className="u-cash-ledger-main">{book}</div><aside className="u-cash-controls">{state.status!=='closed'&&<>{movementActions}{administration}</>}{closing}{policyNote}</aside></>}</div>}
    {action&&<div className="u-cash-form-layout"><div className="u-cash-form">
      <Button variant="ghost" leadingIcon={RiArrowLeftLine} onClick={finish}>Volver al turno</Button>
      <h2 data-kind={movementInfo[action]?.kind}>{action==='Conteo'?'Contar el cajón':action==='Revisión'?'Revisión del conteo':action==='Conciliación'?'Listo para cerrar':action==='Confirmar cierre'?'Cerrar turno de caja':action}</h2>
      {movements.includes(action)&&<form onSubmit={e=>{e.preventDefault();submitMovement()}}><Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="Importe del movimiento" placeholder="0.00" leadingAddon={<span className="text-body-medium text-text-secondary">$</span>} value={amount} inputMode="decimal" onChange={value=>{setAmount(value.replace(/[^\d.]/g,''));setError('')}}/><Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="Motivo del movimiento" placeholder="Describe el motivo" maxLength={80} value={reason} onChange={setReason}/>{Number(amount)>=500&&pinField}{error&&<p role="alert">{error}</p>}<Button type="submit" className="min-h-12 w-full" disabled={!Number.isFinite(Number(amount))||Number(amount)<=0||!reason.trim()||Number(amount)>=500&&pin.length!==4}>Confirmar movimiento de caja</Button></form>}
      {action==='Solicitar apertura de cajón'&&<form onSubmit={e=>{e.preventDefault();if(!approval())return;update({log:[...state.log,'Solicitud de apertura autorizada']});finish();setNotice('Solicitud de apertura registrada.');preview('Apertura simulada. No se envió un pulso a un cajón físico.')}}><p>La apertura sin venta requiere autorización gerencial.</p>{pinField}{error&&<p role="alert">{error}</p>}<Button type="submit" className="min-h-12" disabled={pin.length!==4}>Autorizar apertura</Button></form>}
      {action==='Entregar turno'&&<form onSubmit={e=>{e.preventDefault();if(pin!=='6842'){setError('PIN del operador entrante incorrecto.');return}update({owner:'Sofía',log:[...state.log,'Turno entregado a Sofía']});finish();setNotice('Turno entregado a Sofía.')}}><p>El turno pasa al operador entrante. El cajón no se mueve.</p><Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="PIN del operador entrante" type="password" maxLength={4} inputMode="numeric" value={pin} onChange={setPin}/>{error&&<p role="alert">{error}</p>}<Button type="submit" className="min-h-12" disabled={pin.length!==4}>Confirmar entrega de turno</Button></form>}
      {action==='Revisión'&&<><div className="u-cash-difference"><span>Diferencia</span><strong>{money(difference)}</strong></div>{difference!==0&&!state.resolved&&<form onSubmit={e=>{e.preventDefault();if(approval())update({reason,resolved:true})}}><Select label="Motivo de la diferencia" placeholder="Seleccionar motivo" selectedKey={reason||null} onSelectionChange={key=>setReason(String(key))}>{['Error de conteo','Error de cambio','Error de manejo de efectivo','Diferencia operativa'].map(name=><SelectItem key={name} id={name}>{name}</SelectItem>)}</Select>{pinField}{error&&<p role="alert">{error}</p>}<Button variant="secondary" type="submit" className="min-h-11" disabled={!reason||pin.length!==4}>Resolver diferencia</Button></form>}{state.resolved&&<p className="u-cash-resolved">{state.reason} · Revisión completa</p>}<Button className="min-h-12 w-full" disabled={!state.resolved} onClick={()=>{update({status:'reconciled'});setAction('Conciliación');fade.reset()}}>Conciliar turno</Button><Button variant="ghost" className="min-h-11" onClick={()=>{update({status:'counting',resolved:false});begin('Conteo')}}>Iniciar reconteo</Button></>}
      {action==='Conciliación'&&<><p>El conteo está conciliado. Revisa los importes antes de cerrar.</p><Button className="min-h-12 w-full" onClick={()=>setAction('Confirmar cierre')}>Cerrar turno</Button></>}
      {action==='Confirmar cierre'&&<><p>El cierre termina este turno de caja. Los movimientos quedarán disponibles para consulta.</p><Button className="min-h-12 w-full" onClick={()=>{update({status:'closed',log:[...state.log,'Turno conciliado y cerrado']});finish();setMobileTab('close');setNotice('Turno cerrado.')}}>Confirmar cierre</Button><Button variant="ghost" className="min-h-11" onClick={()=>setAction('Conciliación')}>Volver a revisar</Button></>}
      {action==='Cancelar conteo'&&<><p>Se cancelará el conteo y el turno volverá a abierto. El conteo queda en el libro del turno.</p><Button className="min-h-12" onClick={()=>{update({status:'open',counted:null,resolved:false,reason:'',log:[...state.log,'Conteo cancelado']});finish()}}>Confirmar cancelación del conteo</Button></>}
    </div><aside className="u-cash-form-summary"><h3>{state.counted!==null?'Resumen del conteo':'Caja principal'}</h3><dl className="u-cash-equation"><div><dt>Responsable</dt><dd>{state.owner}</dd></div>{expectedVisible&&<div><dt>Efectivo esperado</dt><dd>{money(expected)}</dd></div>}{state.counted!==null&&<><div><dt>Efectivo contado</dt><dd>{money(state.counted)}</dd></div><div><dt>Diferencia</dt><dd>{money(difference)}</dd></div></>}</dl></aside></div>}
    </div><ScrollFade progress={fade.progress} surfaceClassName="from-background-full"/></div>}
    </>}
  </section>
}

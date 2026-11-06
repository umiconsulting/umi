import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/base/buttons/button'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { Select, SelectItem } from '@/components/base/select/select'
import Dashboard from './dashboard/Dashboard'
import { initial, type Scene } from './order'
import type { Device, Orientation } from './DevicePreview'
import './menu-staff-preview.css'

type Command = { chapter:string; mode:'pickup'|'table'|'scheduled'; beat:number; cancelCase:string }
type PosProps = { s:Scene; set:(patch:Partial<Scene>)=>void; compact:boolean; device:Device; orientation:Orientation; dark:boolean; setDark:(dark:boolean)=>void; preview:(text:string)=>void; unframed:boolean; business:string; demoNotice?:string; demoAction?:ReactNode }
const noop = () => {}

function MenuSettings({command:c}:{command:Command}) {
  return <>
    <header className="d-page-head"><div><h1>Menú digital</h1><p>Pedidos de Bruma · Centro.</p></div></header>
    <div className="menu-settings-grid">
      <section className="d-surface menu-settings-card">
        <h2 className="text-headline-medium">Disponibilidad</h2>
        <Checkbox isSelected isReadOnly>Publicar el menú</Checkbox>
        <Checkbox data-target="receive" isSelected={c.beat>0} isReadOnly>Recibir pedidos</Checkbox>
        <p className="text-body-2-regular text-text-secondary">Los clientes pueden consultar los productos y armar su pedido.</p>
        <h3 className="text-body-medium">Modalidades</h3>
        <Checkbox isSelected={c.mode==='table'} isReadOnly>En mesa</Checkbox>
        <Checkbox isSelected={c.mode!=='table'} isReadOnly>Para recoger</Checkbox>
        <p className="text-body-2-regular text-text-secondary">Los pedidos para recoger requieren aceptación del personal. Los de mesa pasan a preparación.</p>
      </section>
      <section className="d-surface menu-settings-card">
        <h2 className="text-headline-medium">Recogida y avisos</h2>
        <Checkbox isSelected={c.mode==='scheduled'} isReadOnly>Permitir programar una hora</Checkbox>
        <Select label="Anticipación para preparar" selectedKey="20" onSelectionChange={noop}><SelectItem id="20">20 minutos</SelectItem></Select>
        <Select label="Pago" selectedKey="business" onSelectionChange={noop}><SelectItem id="business">En el negocio</SelectItem></Select>
        <Checkbox isSelected isReadOnly>Avisos por correo electrónico</Checkbox>
        <p className="text-body-2-regular text-text-secondary">Confirmación, pedido listo y cancelación.</p>
      </section>
    </div>
    <div className="d-form-actions menu-settings-save"><span className="text-body-2-regular text-text-secondary" role="status">{c.beat>=3?'Cambios guardados':'Configuración de ejemplo de esta sucursal.'}</span><Button data-target="save">{c.beat>=3?'Guardado':'Guardar cambios'}</Button></div>
  </>
}

function scene(c:Command):Scene {
  const paid=c.chapter==='pay'&&c.beat>0,delivered=paid&&c.beat>=3
  const accepted=c.mode==='table'||c.chapter==='accept'&&c.beat>0
  const held=c.mode==='scheduled'&&c.chapter==='kitchen'&&c.beat===0
  const kitchen=c.chapter==='kitchen'
  return {...initial, account:'1042', customerName:c.mode==='table'?'Mesa 12':'Ana',customerNote:'Miel aparte.',menuOrderNumber:'1042',pickupTime:c.mode==='scheduled'?'17:30':'12:25',hideMenuOrigin:true,
    source:'menu',service:c.mode==='table'?'here':'takeaway',tableNumber:c.mode==='table'?12:null,
    items:[{id:'toast',name:'French toast de la casa',price:145,qty:1,category:'Desayunos',note:'Miel aparte'},{id:'latte',name:'Latte de la casa',price:65,qty:1,category:'Bebidas',detail:'Leche entera'}],
    screen:kitchen?'kitchen':c.chapter==='pay'?(delivered?'done':paid?'sale':'payment'):c.mode==='table'?'sale':'incoming',
    role:kitchen?(c.beat>=2?'kitchen':'bar'):'cashier',incoming:!accepted&&c.chapter==='accept',ticket:true,paid,received:'210',
    kitchen:held?'draft':delivered?'delivered':c.chapter==='pay'?'ready':accepted&&c.mode==='scheduled'?'draft':'preparing',
    stations:{bar:c.beat>=2&&kitchen||c.chapter==='pay'?'ready':'preparing',kitchen:c.beat>=3&&kitchen||c.chapter==='pay'?'ready':'preparing'},
    readyItems:kitchen?(c.beat>=3?['latte','toast']:c.beat>=2?['latte']:[]):c.chapter==='pay'?['latte','toast']:[],
    ...(held?{rounds:[]}:{}),payments:paid?[{id:'demo-payment',method:'Efectivo',channel:'cash',principal:210,tip:0,received:210,change:0}]:[],
  }
}

export default function MenuStaffPreview({renderPos}:{renderPos:(props:PosProps)=>ReactNode}) {
  const [command,setCommand]=useState<Command>({chapter:'config',mode:'pickup',beat:0,cancelCase:'pending'})
  const [viewport,setViewport]=useState({width:innerWidth,height:innerHeight})
  const [parentOrigin,setParentOrigin]=useState<string|null>(null)
  const compact=viewport.width<680,device:Device=compact?'iphone':'windows'
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.source!==parent||event.data?.type!=='umi-staff:render')return
      const origin=new URL(event.origin)
      if(event.origin!==location.origin&&!(['localhost','127.0.0.1'].includes(location.hostname)&&['localhost','127.0.0.1'].includes(origin.hostname)))return
      const c=event.data.command
      if(!['config','accept','kitchen','pay','cancel'].includes(c?.chapter)||!['pickup','table','scheduled'].includes(c?.mode)||!Number.isFinite(c?.beat))return
      setParentOrigin(event.origin);setCommand(previous=>JSON.stringify(previous)===JSON.stringify(c)?previous:c)
    }
    const resize=()=>setViewport({width:innerWidth,height:innerHeight})
    addEventListener('message',receive);addEventListener('resize',resize)
    return()=>{removeEventListener('message',receive);removeEventListener('resize',resize)}
  },[])
  useLayoutEffect(()=>{
    if(!parentOrigin)return
    const selectors:Record<string,string>={receive:'[data-target="receive"]',save:'[data-target="save"]',accept:'[data-target="accept-order"]','bar-ready':'[data-target="ready-latte"]','kitchen-ready':'[data-target="ready-toast"]',charge:'[data-target="confirm"]',deliver:'[data-target="deliver"]','approve-cancel':'[data-target="approve-cancel"]'}
    const measure=()=>{
      const targets=Object.entries(selectors).flatMap(([name,selector])=>{
        const el=document.querySelector(selector);if(!el)return[]
        const r=el.getBoundingClientRect();if(!r.width||!r.height||r.bottom<0||r.top>innerHeight)return[]
        return[{name,left:r.left,top:r.top,width:r.width,height:r.height}]
      })
      parent.postMessage({type:'umi-staff:targets',command:JSON.stringify(command),targets},parentOrigin)
    }
    const active=command.chapter==='config'?(command.beat>0?'save':'receive'):command.chapter==='accept'?'accept':command.chapter==='kitchen'?(command.beat>=2?'kitchen-ready':'bar-ready'):command.chapter==='pay'?(command.beat>0?'deliver':'charge'):'approve-cancel'
    const frame=requestAnimationFrame(()=>{
      if(command.chapter==='accept'&&command.beat>0)document.querySelector('.u-workspace')?.scrollTo({top:0,behavior:'instant'})
      else document.querySelector(selectors[active])?.scrollIntoView({block:'nearest',behavior:'instant'})
      measure()
    })
    const observer=new ResizeObserver(measure);observer.observe(document.body)
    void document.fonts.ready.then(measure)
    return()=>{cancelAnimationFrame(frame);observer.disconnect()}
  },[command,parentOrigin,viewport])
  const c=command
  const notice=c.chapter==='accept'?(c.mode==='table'?'Ya se envió a cocina y barra.':c.beat>0?c.mode==='scheduled'?'Horario reservado. Se enviará a preparación a las 17:10.':'Pedido aceptado. Cocina y barra pueden prepararlo.':'Revisa la disponibilidad antes de aceptar.'):c.chapter==='kitchen'?(c.beat>=3?'Pedido #1042 listo para entregar.':c.beat>=2?'Barra terminó. Cocina continúa en preparación.':c.mode==='scheduled'&&c.beat===0?'17:09 · El pedido permanece reservado.':undefined):c.chapter==='cancel'?'Ana solicitó cancelar. El pedido sigue activo hasta que el personal lo autorice.':c.chapter==='pay'&&c.beat>=3?'Entregado':undefined
  return <div className="menu-staff-root" data-redesign={c.chapter==='config'?'dashboard':'pos'}>
    {c.chapter==='config'?<Dashboard device={device} orientation="portrait" dark={false} platform={false} unframed menuPreview={{title:'Menú digital',content:<MenuSettings command={c}/>}}/>:
      renderPos({s:scene(c),set:noop,compact,device,orientation:'portrait',dark:false,setDark:noop,preview:noop,unframed:true,business:'Bruma',demoNotice:notice,demoAction:c.chapter==='cancel'?<Button data-target="approve-cancel">Autorizar cancelación</Button>:undefined})}
  </div>
}

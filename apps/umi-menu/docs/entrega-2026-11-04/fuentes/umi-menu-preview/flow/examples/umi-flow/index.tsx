import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Stage, type Act } from '../../kit'
import { readChapter, readMode, type CancelCase } from '../../playground/flow-data'
import { Email, type SceneProps } from './surfaces'
import StaffScreen from './StaffScreen'
import './product-flow.css'

const query=new URLSearchParams(location.search)
const mode=readMode(query.get('mode')),chapter=readChapter(query.get('chapter'))
const cancelCase:CancelCase=mode==='table'?'preparing':query.get('case')==='accepted'?'accepted':query.get('case')==='preparing'?'preparing':'pending'
const directCancel=mode!=='table'&&(cancelCase==='pending'||mode==='scheduled'&&cancelCase==='accepted')
type State={beat:number}
type TargetBox={name:string;left:number;top:number;width:number;height:number}
type MenuWindow=Window & {__umiDemo?:{render:(props:Omit<SceneProps,'compact'>)=>void;targets:()=>TargetBox[]}}
const initial:State={beat:0},poster:State={beat:chapter==='menu'?5:3}
const script=async(a:Act<State>)=>{
 const beat=(n:number,mark:string)=>{a.put({beat:n});a.mark(mark)}
 a.mark('inicio');await a.wait(1500)
 if(chapter==='config'){
  await a.click('receive');beat(1,'recepcion');await a.wait(1200)
  await a.click('save');beat(3,'guardado')
 }else if(chapter==='menu'){
  if(a.layout==='compact'){beat(-1,'ver-destacado');await a.wait(800)}
  await a.click('product-toast');beat(1,'opciones-toast');await a.wait(1700)
  await a.click('add-product');beat(2,'toast-agregado');await a.wait(1300)
  await a.click('product-latte');beat(3,'opciones-latte');await a.wait(1700)
  await a.click('add-product');beat(4,'latte-agregado');await a.wait(1200)
  await a.click('review');beat(5,'carrito')
 }else if(chapter==='send'){
  await a.wait(1500);beat(1,'confirmacion');await a.wait(1300)
  await a.click('confirm');beat(3,'recibido')
 }else if(chapter==='accept'){
  if(mode!=='table')await a.click('accept')
  beat(3,mode==='scheduled'?'reservado':'preparacion')
 }else if(chapter==='kitchen'){
  if(mode==='scheduled'){await a.wait(1100);beat(1,'liberado');await a.wait(1300)}
  await a.click('bar-ready');beat(2,'barra-lista');await a.wait(1800)
  await a.click('kitchen-ready');beat(3,'todo-listo')
 }else if(chapter==='notify'){
  await a.wait(1800)
  if(mode!=='table')await a.click('view-order')
  beat(3,'seguimiento')
 }else if(chapter==='pay'){
  await a.click('charge');beat(1,'cobrado');await a.wait(1600)
  await a.click('deliver');beat(3,'entregado')
 }else{
  await a.click('cancel');beat(1,directCancel?'cancelado':'solicitado');await a.wait(1900)
  if(!directCancel){beat(2,'revision-personal');await a.wait(1400);await a.click('approve-cancel')}
  beat(3,directCancel?'cancelado':'autorizado')
 }
 await a.wait(1800);a.mark('fin')
}
function ApprovedMenu(props:SceneProps){
 const ref=useRef<HTMLIFrameElement>(null)
 const [loaded,setLoaded]=useState(false),[targets,setTargets]=useState<TargetBox[]>([])
 useLayoutEffect(()=>{
  if(!loaded)return
  const win=ref.current?.contentWindow as MenuWindow|null
  if(!win?.__umiDemo)throw new Error('No se pudo cargar la maqueta local del menú.')
  win.__umiDemo.render({chapter:props.chapter,mode:props.mode,beat:props.beat,cancelCase:props.cancelCase})
  const measure=()=>setTargets(win.__umiDemo?.targets()||[])
  measure()
  const observer=new ResizeObserver(measure)
  if(ref.current)observer.observe(ref.current)
  const timer=setTimeout(measure,200)
  return()=>{observer.disconnect();clearTimeout(timer)}
 },[loaded,props.chapter,props.mode,props.beat,props.cancelCase])
 return <div className="approved-menu">
  <iframe title="Menú digital con el redesign local de Umi" ref={ref} src={`${import.meta.env.BASE_URL}reference/menu.html`} onLoad={()=>setLoaded(true)} tabIndex={-1}/>
  {targets.map(({name,...rect})=><span key={name} className="scene-target" style={rect} data-target={name} data-cursor="pointer"/>)}
 </div>
}
function Scene(props:SceneProps){
 if(['config','accept','kitchen','pay'].includes(chapter)||chapter==='cancel'&&props.beat===2)return <StaffScreen {...props}/>
 if(chapter==='menu'||chapter==='send'||chapter==='cancel'&&props.beat!==2)return <ApprovedMenu {...props}/>
 if(chapter==='notify')return mode==='table'||props.beat>=3?<ApprovedMenu {...props}/>:<Email {...props}/>
 return <StaffScreen {...props}/>
}
export default function UmiFlow(){
 const framed=query.get('framed')==='1'
 const [viewport,setViewport]=useState({width:innerWidth,height:innerHeight})
 useEffect(()=>{if(!framed)return;const resize=()=>setViewport({width:innerWidth,height:innerHeight});addEventListener('resize',resize);return()=>removeEventListener('resize',resize)},[framed])
 return <Stage<State> width={framed?viewport.width:1280} height={framed?viewport.height:860} compact={{below:680,width:framed?viewport.width:390,height:framed?viewport.height:840}} initial={initial} poster={poster} script={script} play="once" className="umi-product-flow" fidelity="realistic" accent="#223979" unframed cursor={{at:{x:-40,y:-40},style:'arrow',idle:650}}
 tokens={{'--ss-font':'"Source Sans 3",sans-serif','--ss-canvas':'#eef1f8','--ss-text-strong':'#131f44'}}>
  {(s,_rect,layout)=><Scene {...s} chapter={chapter} mode={mode} cancelCase={cancelCase} compact={layout==='compact'}/>}
 </Stage>
}

import { useEffect, useRef, useState } from 'react'
import { RiPlayLine, RiPauseLine, RiRestartLine, RiArrowLeftLine, RiArrowRightLine, RiExternalLinkLine } from '@remixicon/react'
import { Button, ButtonLink } from '@/components/base/buttons/button'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { Select, SelectItem } from '@/components/base/select/select'
import { Stage } from '../kit'
import { DeviceFrame, DevicePicker, deviceFormat, type Device, type Orientation } from './DevicePreview'
import { PreviewChoices } from './PreviewChoices'
import { chapters, modes, readChapter, readMode, explanation, type Chapter, type CancelCase } from './digital-menu-flow-data'
import './dashboard/tour.css'

const empty = {}
export default function DigitalMenuShow({device, orientation, onDevice, onOrientation}: {
  device:Device; orientation:Orientation; onDevice:(device:Device)=>void; onOrientation:(orientation:Orientation)=>void
}) {
  const params = new URLSearchParams(location.search)
  const [chapter,setChapter] = useState(readChapter(params.get('menuChapter') || 'menu'))
  const [mode,setMode] = useState(readMode(params.get('menuMode')))
  const [cancelCase,setCancelCase] = useState<CancelCase>('pending')
  const [still,setStill] = useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [playing,setPlaying] = useState(true), [speed,setSpeed] = useState('1')
  const [revision,setRevision] = useState(0), [ready,setReady] = useState(false)
  const [finished,setFinished] = useState(false), [error,setError] = useState<string|null>(null)
  const frame = useRef<HTMLIFrameElement>(null), visible = useRef(false)
  const format = deviceFormat(device,orientation)
  const effectiveCase = mode === 'table' ? 'preparing' : cancelCase
  const standalone=params.has('menuFullscreen')
  const fullLink='/?'+new URLSearchParams({app:'menu',menuView:'tour',menuChapter:chapter,menuMode:mode,device,orientation,...(standalone?{}:{menuFullscreen:'1'})})
  const index = chapters.findIndex(item=>item.id===chapter), current = chapters[index]
  const source = '/menu-digital/recorrido/index.html?' + new URLSearchParams({embed:'umi-flow',framed:'1',chapter,mode,case:effectiveCase,still:still?'1':'0'})
  const send = (data:object) => frame.current?.contentWindow?.postMessage({type:'stageshow:control',...data},location.origin)
  const replay = () => { setPlaying(true); setRevision(value=>value+1) }
  const choose = (next:Chapter) => { setChapter(next); setPlaying(true) }
  useEffect(()=>{
    const receive = (event:MessageEvent) => {
      if(event.origin!==location.origin || event.source!==frame.current?.contentWindow || event.data?.type!=='stageshow:status')return
      if(event.data.mark==='fin')setFinished(true)
      if(event.data.error){setError(String(event.data.error));setReady(false);setPlaying(false)}
      else if(event.data.ready){setReady(true);send({playing:playing&&!still,speed:Number(speed),visible:visible.current})}
    }
    addEventListener('message',receive)
    return ()=>removeEventListener('message',receive)
  },[playing,speed,still])
  useEffect(()=>{send({playing:playing&&!still,speed:Number(speed)})},[playing,speed,still])
  useEffect(()=>{
    const observer = new IntersectionObserver(([entry])=>{visible.current=entry.isIntersecting;send({visible:visible.current})})
    if(frame.current)observer.observe(frame.current)
    return ()=>observer.disconnect()
  },[source,revision,device,orientation])
  useEffect(()=>{
    setReady(false);setFinished(false);setError(null)
    const url=new URL(location.href)
    url.searchParams.set('menuChapter',chapter);url.searchParams.set('menuMode',mode)
    history.replaceState(null,'',url)
  },[source,revision,device,orientation])
  return <section className="dashboard-show menu-flow-show text-body-regular" aria-label="Recorrido del menú digital">
    <div className="preview-controls">
      <PreviewChoices label="Modalidad del pedido" value={mode} options={modes.map(item=>({value:item.id,label:item.label}))} onChange={value=>{setMode(value);setPlaying(true)}}/>
      <div className="preview-control-row"><DevicePicker device={device} orientation={orientation} onDevice={value=>{setPlaying(false);onDevice(value)}} onOrientation={value=>{setPlaying(false);onOrientation(value)}}/><ButtonLink variant="ghost" href={fullLink} target={standalone?undefined:"_blank"} rel="noreferrer" trailingIcon={RiExternalLinkLine}>{standalone?'Volver al visor':'Abrir pantalla completa'}</ButtonLink></div>
    </div>
    <div className="dashboard-tour-controls">
      <div className="dashboard-tour-actions">
        <Button leadingIcon={playing&&!finished&&!still?RiPauseLine:RiPlayLine} disabled={!ready||still} onClick={()=>finished?replay():setPlaying(value=>!value)} aria-label={still?'Vista fija':finished?'Reproducir de nuevo':playing?'Pausar':'Reproducir'}>{still?'Vista fija':playing&&!finished?'Pausar':'Reproducir'}</Button>
        <Button variant="secondary" leadingIcon={RiRestartLine} onClick={replay} aria-label="Repetir escena">Repetir</Button>
      </div>
      <Select className="dashboard-tour-chapters" aria-label="Capítulo del recorrido" selectedKey={chapter} onSelectionChange={key=>choose(key as Chapter)}>
        {chapters.map((item,i)=><SelectItem id={item.id} key={item.id}>{String(i+1).padStart(2,'0')} · {item.title}</SelectItem>)}
      </Select>
      <div className="dashboard-tour-steps">
        <Button variant="secondary" iconOnly leadingIcon={RiArrowLeftLine} aria-label="Paso anterior" disabled={index===0} onClick={()=>choose(chapters[index-1].id)}/>
        <span className="text-body-2-medium">{index+1} / {chapters.length}</span>
        <Button variant="secondary" iconOnly leadingIcon={RiArrowRightLine} aria-label="Paso siguiente" disabled={index===chapters.length-1} onClick={()=>choose(chapters[index+1].id)}/>
      </div>
    </div>
    <div className="menu-flow-options">
      <Checkbox isSelected={still} onChange={setStill}>Sin animación</Checkbox>
      <Select aria-label="Velocidad" selectedKey={speed} onSelectionChange={key=>setSpeed(String(key))}>{['0.5','1','2'].map(value=><SelectItem id={value} key={value}>{value}×</SelectItem>)}</Select>
      {chapter==='cancel'&&<Select aria-label="Estado al cancelar" selectedKey={effectiveCase} isDisabled={mode==='table'} onSelectionChange={key=>{setCancelCase(key as CancelCase);setPlaying(true)}}>
        <SelectItem id="pending">Pendiente de aceptación</SelectItem><SelectItem id="accepted">{mode==='scheduled'?'Aceptado · antes del límite':'Aceptado'}</SelectItem><SelectItem id="preparing">En preparación</SelectItem>
      </Select>}
    </div>
    <div className="dashboard-tour-caption" aria-live="polite" aria-atomic="true">
      <strong className="text-headline-medium">{current.title}{finished?' · Escena completa':''}</strong>
      <p className="text-body-2-regular">{explanation(chapter,mode,effectiveCase)}</p>
      <progress aria-label="Avance del recorrido" value={index+1} max={chapters.length}/>
    </div>
    {error&&<p role="alert" className="text-body-regular text-text-error-primary">No se pudo mostrar la escena: {error}</p>}
    <div className="dashboard-tour-stage" style={{maxWidth:format.outerWidth}}>
      <Stage width={format.outerWidth} height={format.outerHeight} initial={empty} poster={empty} fidelity="realistic">
        {()=> <DeviceFrame device={device} orientation={orientation} dark={false} title="Umi · Recorrido del menú digital">
          <iframe key={source+'-'+revision} ref={frame} className="digital-menu-frame" title="Recorrido del menú digital" src={source} onLoad={()=>send({playing:playing&&!still,speed:Number(speed),visible:visible.current})}/>
        </DeviceFrame>}
      </Stage>
    </div>
  </section>
}

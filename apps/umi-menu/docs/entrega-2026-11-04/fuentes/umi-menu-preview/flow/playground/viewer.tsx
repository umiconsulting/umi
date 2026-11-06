import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, Play, Pause, RotateCcw, Monitor, Smartphone, ExternalLink } from 'lucide-react'
import { chapters, modes, readChapter, readMode, explanation, type CancelCase, type Chapter } from './flow-data'
import './viewer.css'

function Viewer() {
  const params = new URLSearchParams(location.search)
  const [chapter,setChapter]=useState(readChapter(params.get('chapter')))
  const [mode,setMode]=useState(readMode(params.get('mode')))
  const [cancelCase,setCancelCase]=useState<CancelCase>('pending')
  const [phone,setPhone]=useState(false)
  const [still,setStill]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [playing,setPlaying]=useState(true),[speed,setSpeed]=useState(1)
  const [revision,setRevision]=useState(0),[elapsed,setElapsed]=useState(0),[height,setHeight]=useState(640)
  const [ready,setReady]=useState(false),[finished,setFinished]=useState(false),[error,setError]=useState<string|null>(null)
  const iframe=useRef<HTMLIFrameElement>(null),visible=useRef(false),motionOverride=useRef(false)
  const chapterNav=useRef<HTMLElement>(null)
  const current=chapters.find(c=>c.id===chapter)!,index=chapters.findIndex(c=>c.id===chapter)
  const effectiveCase=mode==='table'?'preparing':cancelCase
  const source=useMemo(()=>'?embed=umi-flow&chapter='+chapter+'&mode='+mode+'&case='+effectiveCase+'&still='+(still?1:0),[chapter,mode,effectiveCase,still,revision])
  const send=(data:object)=>iframe.current?.contentWindow?.postMessage({type:'stageshow:control',...data},location.origin)
  const replay=()=>{setPlaying(true);setRevision(n=>n+1)}
  const choose=(id:Chapter)=>{setChapter(id);setPlaying(true)}
  useEffect(()=>{
    const nav=chapterNav.current
    if(!nav)return
    const reveal=()=>{
      const active=nav.querySelector('[aria-current="step"]')
      if(!active||nav.scrollWidth<=nav.clientWidth)return
      const item=active.getBoundingClientRect(),rail=nav.getBoundingClientRect()
      if(item.left<rail.left||item.right>rail.right)nav.scrollLeft+=item.left-rail.left-(rail.width-item.width)/2
    }
    reveal()
    const observer=new ResizeObserver(reveal)
    observer.observe(nav)
    return()=>observer.disconnect()
  },[chapter])
  useEffect(()=>{
    const preference=matchMedia('(prefers-reduced-motion: reduce)')
    const change=()=>{if(!motionOverride.current)setStill(preference.matches)}
    preference.addEventListener('change',change);return()=>preference.removeEventListener('change',change)
  },[])
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==iframe.current?.contentWindow||event.data?.type!=='stageshow:status')return
      if(Number.isFinite(event.data.elapsed))setElapsed(event.data.elapsed)
      if(Number.isFinite(event.data.height))setHeight(Math.max(1,event.data.height))
      if(event.data.mark==='fin')setFinished(true)
      if(event.data.error){setError(String(event.data.error));setReady(false);setPlaying(false)}
      else if(event.data.ready){setReady(true);send({playing:playing&&!still,speed,visible:visible.current})}
    }
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)
  },[playing,speed,still])
  useEffect(()=>{send({playing:playing&&!still,speed})},[playing,speed,still])
  useEffect(()=>{
    const observer=new IntersectionObserver(([entry])=>{visible.current=entry.isIntersecting;send({visible:visible.current})})
    if(iframe.current)observer.observe(iframe.current)
    return()=>observer.disconnect()
  },[source,revision])
  useEffect(()=>{
    setReady(false);setFinished(false);setElapsed(0);setError(null)
    const url=new URL(location.href);url.searchParams.set('chapter',chapter);url.searchParams.set('mode',mode);history.replaceState(null,'',url)
  },[source,revision])
  return <div className="flow-viewer" data-hosted={params.get('host')==='umi'||undefined}>
    <header className="page-header"><a className="brand" href={import.meta.env.BASE_URL==='/'?'./':'/?app=menu'} aria-label="Umi, inicio">umi</a><span className="header-divider"/><span>Menú digital</span><span className="local-label"><span/>Demostración</span></header>
    <main className="page-main">
      <section className="page-intro"><div><p className="eyebrow">Diseño del flujo</p><h1>Del pedido a la entrega</h1><p>Revisa cada paso desde el cliente, el personal y la cocina.</p></div><a className="original-link" href={`${import.meta.env.BASE_URL}menu.html`} target="_blank" rel="noreferrer">Abrir maqueta del menú<ExternalLink size={15}/></a></section>
      <div className="flow-layout">
        <nav className="chapters" ref={chapterNav} aria-label="Pasos del flujo"><div className="chapters-label">El recorrido</div>{chapters.map((item,i)=><button key={item.id} onClick={()=>choose(item.id)} aria-current={chapter===item.id?'step':undefined}><span className="chapter-number">{String(i+1).padStart(2,'0')}</span><span className="chapter-label">{item.title}<small>{item.actor}</small></span>{chapter===item.id&&<ArrowRight size={16}/>}</button>)}<p className="nav-note">Un mismo pedido.<br/>Diferentes momentos.</p></nav>
        <section className="scene-column" aria-label="Demostración del flujo">
          <div className="scene-top"><div className="modes" aria-label="Modalidad">{modes.map(item=><button key={item.id} aria-pressed={mode===item.id} onClick={()=>{setMode(item.id);setPlaying(true)}}>{item.label}</button>)}</div><div className="width-controls" aria-label="Tamaño de vista"><button onClick={()=>setPhone(false)} aria-pressed={!phone} aria-label="Vista de escritorio"><Monitor size={17}/></button><button onClick={()=>setPhone(true)} aria-pressed={phone} aria-label="Vista de celular"><Smartphone size={17}/></button></div></div>
          {chapter==='cancel'&&<div className="cancel-case"><label htmlFor="cancel-state">Estado al cancelar</label><select id="cancel-state" value={effectiveCase} disabled={mode==='table'} onChange={e=>{setCancelCase(e.target.value as CancelCase);setPlaying(true)}}><option value="pending">Pendiente de aceptación</option><option value="accepted">{mode==='scheduled'?'Aceptado · antes del límite':'Aceptado'}</option><option value="preparing">En preparación</option></select></div>}
          <div className="scene-canvas" data-phone={phone||undefined}><iframe key={source+'-'+revision} ref={iframe} title={'Escena: '+current.title} src={source} style={{height}} onLoad={()=>send({playing:playing&&!still,speed,visible:visible.current})}/></div>
          {error&&<p className="scene-error" role="alert">No se pudo mostrar la escena: {error}</p>}
          <div className="transport"><div className="transport-actions">
            <button className="play-button" disabled={!ready||still} onClick={()=>finished?replay():setPlaying(v=>!v)} aria-label={finished?'Reproducir de nuevo':playing?'Pausar':'Reproducir'}>{!finished&&playing?<Pause size={16}/>:<Play size={16}/>}<span>{finished?'Reproducir':playing?'Pausar':'Reproducir'}</span></button>
            <button onClick={replay} aria-label="Repetir escena"><RotateCcw size={16}/><span>Repetir</span></button>
            <label className="motion-control"><input type="checkbox" checked={still} onChange={e=>{motionOverride.current=true;setStill(e.target.checked)}}/>Sin animación</label>
          </div><div className="transport-time"><output aria-label="Tiempo de la escena">{still?'Vista fija':finished?'Escena completa':(elapsed/1000).toFixed(1)+' s'}</output><select aria-label="Velocidad" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></div></div>
          <div className="scene-caption"><div><span className="caption-number">{String(index+1).padStart(2,'0')} / 08</span><h2>{current.title}</h2><p>{explanation(chapter,mode,effectiveCase)}</p></div><div className="step-actions"><button aria-label="Paso anterior" disabled={index===0} onClick={()=>choose(chapters[index-1].id)}><ArrowLeft size={18}/></button><button className="next-button" disabled={index===chapters.length-1} onClick={()=>choose(chapters[index+1].id)}><span>Siguiente</span><ArrowRight size={18}/></button></div></div>
          <footer className="demo-note">Simulación visual con Stageshow. Bruma, los datos y los horarios son ejemplos. No se envían pedidos ni correos.</footer>
        </section>
      </div>
    </main>
  </div>
}
export function mount(){createRoot(document.getElementById('root')!).render(<Viewer/>)}

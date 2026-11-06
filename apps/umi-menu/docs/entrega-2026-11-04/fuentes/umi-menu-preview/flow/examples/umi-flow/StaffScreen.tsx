import { useEffect, useMemo, useRef, useState } from 'react'
import type { SceneProps } from './surfaces'

type Target={name:string;left:number;top:number;width:number;height:number}
export default function StaffScreen(props:SceneProps) {
  const frame=useRef<HTMLIFrameElement>(null),retry=useRef<ReturnType<typeof setInterval>>()
  const [loaded,setLoaded]=useState(false),[ready,setReady]=useState(false),[targets,setTargets]=useState<Target[]>([])
  const source=useMemo(()=>{
    const url=new URL('/?embed=menu-staff',location.href)
    if(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='56450')url.port='56452'
    return url
  },[])
  const command=JSON.stringify({chapter:props.chapter,mode:props.mode,beat:props.beat,cancelCase:props.cancelCase})
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==source.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='umi-staff:targets'||event.data.command!==command)return
      setTargets(event.data.targets);setReady(true)
      clearInterval(retry.current)
    }
    addEventListener('message',receive)
    return()=>removeEventListener('message',receive)
  },[source,command])
  useEffect(()=>{
    if(!loaded)return
    setTargets([])
    const send=()=>frame.current?.contentWindow?.postMessage({type:'umi-staff:render',command:JSON.parse(command)},source.origin)
    send();retry.current=setInterval(send,150)
    return()=>clearInterval(retry.current)
  },[loaded,command,source])
  return <div className="approved-menu">
    <iframe ref={frame} src={source.href} title="Redesign de Umi para el personal" style={{visibility:ready?'visible':'hidden'}} onLoad={()=>setLoaded(true)} tabIndex={-1}/>
    {targets.map(({name,...rect})=><span key={name} className="scene-target" style={rect} data-target={name} data-cursor="pointer"/>)}
  </div>
}

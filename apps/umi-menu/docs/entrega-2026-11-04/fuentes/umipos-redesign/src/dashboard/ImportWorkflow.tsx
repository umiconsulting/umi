import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { FileUpload } from '@/components/base/file-upload/file-upload'
import { RiArrowLeftLine } from '@remixicon/react'
import type { Entry } from './data'
import type { ParsedFile } from './import-source/format'
import { buildImportPreview } from './import-source/preview.js'
import { importErrors } from './import-source/copy'
import { money } from './parity-model'

const id=(kind:number,i:number)=>`00000000-0000-4000-8000-${String(kind*1000+i+1).padStart(12,'0')}`
const unitNames:Record<string,string>={kg:'kilogram',g:'gram',L:'liter',mL:'milliliter',pza:'unit',pzas:'unit'}
const displayUnits:Record<string,string>={kilogram:'kg',gram:'g',liter:'L',milliliter:'mL',unit:'pza',portion:'porción',package:'paquete',box:'caja'}
const statusNames:Record<string,string>={new:'Nuevo',update:'Actualizar',unchanged:'Sin cambios',error:'Error',duplicate:'Duplicado',pending:'Pendiente',success:'Guardado localmente',ambiguous:'Por confirmar',retryable:'Reintentar'}
type Journal={parsed:ParsedFile;file:string;states:Record<string,string>}

export default function ImportWorkflow({kind,records,onBack,onSave,scope}:{kind:'items'|'recipes';records:Record<string,Entry[]>;onBack:()=>void;onSave:(view:string,entries:Entry[])=>void;scope:string}) {
 const key=`umi-demo-import:${scope}:${kind}`
 const restored=useMemo(()=>{try{return JSON.parse(sessionStorage.getItem(key)||'null') as Journal|null}catch{return null}},[key])
 const [parsed,setParsed]=useState<ParsedFile|null>(restored?.parsed||null),[file,setFile]=useState(restored?.file||''),[states,setStates]=useState<Record<string,string>>(restored?.states||{})
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[running,setRunning]=useState(false),[confirmed,setConfirmed]=useState(!!restored&&Object.keys(restored.states).length>0),[result,setResult]=useState('Normal'),[page,setPage]=useState(0)
 const saveRef=useRef(onSave);saveRef.current=onSave
 const refs=useMemo(()=>({merchantId:id(9,0),items:(records.items||[]).map((r,i)=>({id:id(1,i),publicReference:r.values?.Referencia||r.detail?.split(' · ')[0]||`ART-${i+1}`,displayName:r.name,itemType:r.values?.importType||'ingredient',baseUnit:r.values?.importUnit||unitNames[r.cells[0]?.split(' ').at(-1)||'']||'unit',quantityScale:Number(r.values?.Decimales||3),active:r.cells.at(-1)!=='Archivado',version:1,conversions:[]})),targets:(records.products||[]).flatMap((r,i)=>[{productId:id(2,i),productName:r.name,productActive:true,variantId:null,variantName:null},...(r.name==='Latte'?[{productId:id(2,i),productName:r.name,productActive:true,variantId:id(3,i),variantName:'Nube'}]:[])]),recipes:[]}),[records.items,records.products])
 const preview=useMemo(()=>{if(!parsed)return null;try{return buildImportPreview({kind,parsed,snapshot:refs})}catch(e){return {kind,entries:[],counts:{error:1,new:0,update:0,duplicate:0},fatal:(e as {code?:string}).code||'INVALID_PREVIEW_INPUT'}}},[kind,parsed,refs])
 const fatal=preview&&'fatal' in preview?importErrors[String(preview.fatal)]||'No se pudo revisar el archivo.':''
 const valid=!!preview?.entries.length&&preview.entries.every(e=>e.status!=='error'&&e.status!=='duplicate')
 const pending=preview?.entries.filter(e=>e.command&&states[e.key]!=='success')||[]
 const savedCount=Object.values(states).filter(s=>s==='success').length
 useEffect(()=>{if(parsed){try{sessionStorage.setItem(key,JSON.stringify({parsed,file,states}))}catch{setError('No se pudo conservar el informe en este navegador.')}}},[key,parsed,file,states])
 useEffect(()=>{
  if(!running||!parsed||!preview)return
  const next=preview.entries.find(e=>e.command&&states[e.key]!=='success')
  if(!next){setRunning(false);return}
  const timer=setTimeout(()=>{
   if(result!=='Normal'){setStates(s=>({...s,[next.key]:result==='Resultado desconocido'?'ambiguous':'retryable'}));setRunning(false);setResult('Normal');return}
   const lines=parsed.rows.filter(r=>next.rowNumbers.includes(r.rowNumber)),v=lines[0].values
   const existing=(records.items||[]).find(r=>(r.values?.Referencia||r.detail?.split(' · ')[0])===v.codigo)
   const entry:Entry=kind==='items'?{name:v.nombre,detail:`${v.codigo} · Importado en demo`,cells:[existing?.cells[0]||`0 ${displayUnits[v.unidad]||v.unidad}`,`${v.existencia_minima||0} ${displayUnits[v.unidad]||v.unidad}`,existing&&existing.cells[2]!=='Desconocido'?existing.cells[2]:v.costo_unitario?money(Number(v.costo_unitario)):'Desconocido',existing?.cells.at(-1)||'Disponible'],status:'ready',values:{...existing?.values,Referencia:v.codigo,Decimales:v.decimales,importUnit:v.unidad,importType:v.tipo,'Costo inicial por unidad':v.costo_unitario||''}}:{name:refs.targets.find(t=>t.productId===v.producto_id&&(t.variantId||'')===(v.variante_id||''))?.variantName||refs.targets.find(t=>t.productId===v.producto_id)?.productName||next.label,detail:'Receta importada en demo',cells:[`${v.rendimiento} ${displayUnits[v.unidad_rendimiento]||v.unidad_rendimiento}`,String(lines.length),'Incompleto','v1 · Vigente'],status:'ready',values:{ingredients:JSON.stringify(lines.map(r=>({article:refs.items.find(i=>i.publicReference===r.values.ingrediente_codigo)?.displayName||r.values.ingrediente_codigo,quantity:Number(r.values.cantidad),unit:displayUnits[r.values.unidad]||r.values.unidad,cost:null}))),importReference:next.reference}}
   saveRef.current(kind,[entry]);setStates(s=>({...s,[next.key]:'success'}))
  },650)
  return()=>clearTimeout(timer)
 },[running,parsed,preview,states,result,kind,records.items,refs])
 const choose=async(selected:File)=>{setBusy(true);setError('');try{const {parseImportFile}=await import('./import-source/format.js');const next=await parseImportFile({kind,format:selected.name.split('.').at(-1)?.toLowerCase()||'',bytes:await selected.arrayBuffer()});setParsed(next);setFile(selected.name);setStates({});setConfirmed(false);setPage(0)}catch(e){setError(importErrors[(e as {code?:string}).code||'']||'No se pudo leer el archivo.')}finally{setBusy(false)}}
 const download=async(purpose:string,format:string)=>{setError('');try{const {buildImportFile}=await import('./import-source/format.js');const output=await buildImportFile({kind,format,purpose,references:refs,results:preview?.entries.map(e=>({rowNumber:e.rowNumbers.join(', '),reference:e.reference,status:statusNames[states[e.key]||e.status],message:e.errors.map(x=>importErrors[x.code]||x.code).join(' ')}))});const url=URL.createObjectURL(new Blob([output.bytes],{type:output.mimeType}));const a=document.createElement('a');a.href=url;a.download=output.fileName;a.click();URL.revokeObjectURL(url)}catch{setError('No se pudo preparar la descarga.')}}
 const update=(rowNumber:number,column:string,value:string)=>setParsed(old=>old?{...old,rows:old.rows.map(r=>r.rowNumber===rowNumber?{...r,values:{...r.values,[column]:value},errors:r.errors.filter(e=>e.column!==column)}:r)}:old)
 return <section className="d-detail"><Button className="d-back" variant="ghost" leadingIcon={RiArrowLeftLine} data-target="d-back" onClick={()=>{setRunning(false);onBack()}}>Volver a {kind==='items'?'artículos':'recetas'}</Button><div className="d-detail-heading"><span className="d-eyebrow">Inventario</span><h1>Importar {kind==='items'?'artículos':'recetas'}</h1><p>La lectura y la revisión usan tu archivo. El guardado solo cambia los datos de esta demostración.</p></div>
 <div className="d-local-context"><p>2 MiB · 500 filas · 100 recetas · 200 ingredientes por receta. Usa texto y punto decimal. La importación no registra entradas de inventario.</p><div className="d-inline-actions"><Button variant="secondary" onClick={()=>download('template','csv')}>Plantilla CSV</Button><Button variant="secondary" onClick={()=>download('template','xlsx')}>Plantilla Excel</Button><Button variant="ghost" onClick={()=>download('references','csv')}>Referencias</Button><Button variant="ghost" onClick={()=>download('guide','csv')}>Guía</Button><Button variant="ghost" onClick={()=>download('examples','csv')}>Ejemplo</Button></div></div>
 {!confirmed&&<FileUpload allowedExtensions={['csv','xlsx']} maxBytes={2097152} onUploadComplete={choose}/>}
 {busy&&<p role="status">Leyendo el archivo…</p>}{(error||fatal)&&<p className="d-error" role="alert">{error||fatal}</p>}
 {parsed&&preview&&<><div className="d-detail-section"><h2>{file}</h2><p>{parsed.rows.length} filas · {preview.entries.length} registros · {confirmed?`${savedCount} guardados localmente`: `${preview.counts.new||0} nuevos · ${preview.counts.update||0} actualizaciones · ${(preview.counts.error||0)+(preview.counts.duplicate||0)} con errores`}</p></div>
 <div className="d-import-grid">{parsed.rows.slice(page*8,page*8+8).map(row=>{const entry=preview.entries.find(e=>e.rowNumbers.includes(row.rowNumber));return <article className="d-import-line" data-invalid={!!entry?.errors.length} key={row.rowNumber}><header><b>Fila {row.rowNumber} · {entry?.label||row.values.nombre||'Sin nombre'}</b><span>{statusNames[states[entry?.key||'']||entry?.status||'error']}</span></header>{confirmed?<p>{entry?.reference} · {entry?.errors.map(e=>importErrors[e.code]||e.code).join(' ')}</p>:<><div className="d-fields">{parsed.headers.map(column=><Input key={column} label={`${column} · fila ${row.rowNumber}`} value={row.values[column]||''} onChange={value=>update(row.rowNumber,column,value)}/>)}</div>{!!entry?.errors.length&&<ul className="d-import-issues">{entry.errors.map((e,i)=><li key={i}>{e.column}: {importErrors[e.code]||e.code}</li>)}</ul>}</>}</article>})}</div>
 {parsed.rows.length>8&&<div className="d-inline-actions"><Button variant="secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span>Página {page+1} de {Math.ceil(parsed.rows.length/8)}</span><Button variant="secondary" disabled={(page+1)*8>=parsed.rows.length} onClick={()=>setPage(p=>p+1)}>Siguiente</Button></div>}
 <div className="d-local-context"><Select label="Resultado de prueba del siguiente registro" selectedKey={result} onSelectionChange={k=>setResult(String(k))} isDisabled={running}>{['Normal','Resultado desconocido','Error temporal'].map(s=><SelectItem id={s} key={s}>{s}</SelectItem>)}</Select>{Object.values(states).includes('ambiguous')&&<p>Falta confirmar el resultado simulado. Reintenta el mismo informe para conservar las operaciones guardadas.</p>}<div className="d-inline-actions">{!confirmed?<Button disabled={!valid} onClick={()=>{setConfirmed(true);setRunning(true)}}>Confirmar importación local</Button>:running?<Button variant="secondary" onClick={()=>setRunning(false)}>Detener pendientes</Button>:pending.length?<Button onClick={()=>setRunning(true)}>Reintentar pendientes</Button>:<p role="status">Todos los registros quedaron guardados en el ejemplo.</p>}{confirmed&&<Button variant="secondary" onClick={()=>download('results','csv')}>Descargar informe</Button>}{!running&&confirmed&&<Button variant="ghost" onClick={()=>{setParsed(null);setConfirmed(false);setStates({});sessionStorage.removeItem(key)}}>Nueva importación</Button>}</div></div>
 </>}
 </section>
}

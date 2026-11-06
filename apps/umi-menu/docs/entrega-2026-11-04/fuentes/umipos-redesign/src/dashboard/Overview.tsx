import { useState } from 'react'
import { RiArrowRightLine, RiRefreshLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'

// Keep the original overview's three bands and its single lead figure.
export default function Overview({go}:{go:(id:string)=>void}) {
 const [refreshed,setRefreshed]=useState(false)
 return <div className="d-panorama">
  <div className="d-signal"><span className="d-dot"/>Cocina <span>Platillo actualizado · 14:52</span></div>
  <section className="d-month d-surface" aria-label="Resumen del negocio">
   <div className="d-month-lead"><div><span>Ingresos del mes</span><strong>$6,840</strong></div></div>
   <div className="d-month-facts">{[
    ['Visitas hoy','12'], ['Tarjetas de regalo abiertas','2'],
    ['Recompensas canjeadas · 7d','3'], ['Miembros activos','128'],
   ].map(([label,value])=><div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
   <div className="d-month-foot">+5 nuevos esta semana · 2 cumpleaños activables · 0 con saldo &gt; $1,000</div>
  </section>
  <section className="d-station-region">
   <div className="d-region-head"><div><h2>Estaciones de cocina</h2><p>3 estaciones</p></div><Button variant="secondary" iconOnly leadingIcon={RiRefreshLine} aria-label="Actualizar las estaciones" onClick={()=>setRefreshed(true)}/></div>
   <div className="d-station-list d-surface">{[
    {name:'Barra',count:5,state:'En vivo',time:'4 min',tone:'ready'},
    {name:'Cocina',count:3,state:'Lento',time:'11 min',tone:'pending'},
    {name:'Horno',count:2,state:'En vivo',time:'8 min',tone:'ready'},
   ].map(s=><div className="d-station-row" key={s.name}><b>{s.name}</b><span className="d-station-state" data-status={s.tone}><i/>{s.state}</span><span className="d-station-open"><b>{s.count}</b> abiertos</span><span className="d-station-time">{s.time}</span></div>)}</div>
  </section>
  <div className="d-panorama-lower">
   <section><div className="d-region-head"><h2>Centro de acción</h2></div><div className="d-surface">
    <div className="d-action-current"><span>Nada pendiente ahora mismo.</span><Button variant="ghost" trailingIcon={RiArrowRightLine} onClick={()=>go('orders')}>Ver pedidos</Button></div>
    <div className="d-action-footer"><span>{refreshed?'Verificado ahora':'Última verificación 14:52'}</span><Button variant="ghost" leadingIcon={RiRefreshLine} onClick={()=>setRefreshed(true)}>Re-escanear</Button></div>
   </div></section>
   <section><div className="d-region-head"><h2>Hoy</h2></div><div className="d-today d-surface">
    <div><h3>Pedidos WhatsApp</h3><p>4 pedidos · ticket promedio $135.00</p><dl><div><dt>Aceptados</dt><dd>4</dd></div><div><dt>Cancelados</dt><dd>0</dd></div></dl></div>
    <div><h3>Actividad del monedero</h3><p>$500.00 MXN procesado hoy</p><dl><div><dt>Recargas</dt><dd>$500.00</dd></div><div><dt>Canjes</dt><dd>$0.00</dd></div></dl></div>
   </div></section>
  </div>
 </div>
}

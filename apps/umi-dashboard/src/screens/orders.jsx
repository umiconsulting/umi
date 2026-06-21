import React, { useState, useEffect } from 'react'
import { I } from '../icons.jsx'
import { XSep } from '../shell.jsx'
import { transitionOrder, useOrdersData } from '../data.jsx'

// Screen 6 — Pedidos / KDS Tickets
// Data: kds.tickets from Supabase (conversaflow project)
// Status enum: new | accepted | preparing | ready | completed | cancelled


const ORDER_STATUS_META = {
  new:       { label: 'Nuevo',       color: 'var(--umi-blue)',  bg: 'rgba(118,146,203,0.12)' },
  accepted:  { label: 'Aceptado',    color: '#6B8F4A',          bg: 'rgba(107,143,74,0.12)'  },
  preparing: { label: 'Preparando',  color: 'var(--warning)',   bg: 'var(--warning-soft)'    },
  ready:     { label: 'Listo',       color: 'var(--success)',   bg: 'var(--success-soft)'    },
  completed: { label: 'Completado',  color: 'var(--ink-3)',     bg: 'var(--canvas-2)'        },
  cancelled: { label: 'Cancelado',   color: 'var(--danger)',    bg: 'var(--danger-soft)'     },
};

const ACTIVE_STATUSES = ['new', 'accepted', 'preparing', 'ready'];

const OrdersScreen = () => {
  const [filter, setFilter]   = useState('active');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(null);
  const { data: tickets, loading } = useOrdersData(filter, refresh);

  const displayed = tickets || [];

  // Summary counts across all statuses for the status rail
  const allTickets = useOrdersData('all', refresh).data || [];
  const counts = {};
  allTickets.forEach(function(t) { counts[t.status] = (counts[t.status] || 0) + 1; });

  const totalToday = allTickets.length;
  const acceptedToday = (counts.accepted || 0) + (counts.completed || 0) + (counts.ready || 0) + (counts.preparing || 0);
  const cancelledToday = counts.cancelled || 0;
  const totalRevenue = allTickets
    .filter(function(t) { return t.status === 'completed' || ACTIVE_STATUSES.indexOf(t.status) !== -1; })
    .reduce(function(s, t) { return s + (parseFloat(t.total_amount) || 0); }, 0);

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>

      {/* Header */}
      <div className="ed-head fade-up d1">
        <div className="titles">
          <div className="sec-index">
            <span className="nn">A</span><span>/</span>
            <span>EN VIVO <XSep/> {totalToday} HOY <XSep/> {displayed.length} MOSTRADOS</span>
          </div>
          <h2>Pedidos WhatsApp</h2>
          <div className="en">KDS tickets · ConversaFlow</div>
        </div>
        <div style={{display:'flex', gap:10, alignItems:'center'}}>
          <button className="btn btn-ghost btn-sm" onClick={() => setRefresh(r => r+1)}>
            <I.Refresh size={14}/> Actualizar
          </button>
        </div>
      </div>

      {/* Status summary rail */}
      <div className="fade-up d2" style={{display:'flex', gap:10, flexWrap:'wrap'}}>
        {[
          { status: 'new',       label: 'Nuevos'     },
          { status: 'accepted',  label: 'Aceptados'  },
          { status: 'preparing', label: 'En cocina'  },
          { status: 'ready',     label: 'Listos'     },
          { status: 'completed', label: 'Completados'},
          { status: 'cancelled', label: 'Cancelados' },
        ].map(function(item) {
          var meta = ORDER_STATUS_META[item.status];
          var cnt  = counts[item.status] || 0;
          return (
            <div key={item.status} style={{
              display:'flex', alignItems:'center', gap:8,
              padding:'8px 14px', borderRadius:10,
              background: meta.bg, border:'1px solid ' + meta.color + '33',
              cursor:'pointer',
            }} onClick={() => setFilter(
              item.status === 'completed' || item.status === 'cancelled' ? item.status
              : ACTIVE_STATUSES.indexOf(item.status) !== -1 ? 'active' : item.status
            )}>
              <span style={{
                width:8, height:8, borderRadius:'50%',
                background: meta.color, flexShrink:0,
              }}/>
              <span style={{fontSize:12, fontWeight:600, color: meta.color, letterSpacing:'0.04em'}}>{cnt}</span>
              <span style={{fontSize:11.5, color:'var(--ink-2)', letterSpacing:'0.06em', textTransform:'uppercase'}}>{item.label}</span>
            </div>
          );
        })}
        <div style={{marginLeft:'auto', display:'flex', gap:18, alignItems:'center', fontSize:12.5, color:'var(--ink-3)'}}>
          <span>Ticket promedio <b style={{color:'var(--ink-1)', fontFamily:'var(--font-mono)'}}>${totalToday > 0 ? Math.round(totalRevenue/Math.max(totalToday,1)) : '–'}</b></span>
          <span>Cancelaciones <b style={{color: cancelledToday > 0 ? 'var(--danger)' : 'var(--ink-1)'}}>{cancelledToday}</b></span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="fade-up d3" style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div className="seg" role="tablist">
          {[
            { id: 'active',    label: 'Activos'     },
            { id: 'completed', label: 'Completados' },
            { id: 'cancelled', label: 'Cancelados'  },
            { id: 'all',       label: 'Todos'       },
          ].map(function(f) {
            return (
              <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            );
          })}
        </div>
        {loading && (
          <span style={{fontSize:12, color:'var(--ink-3)', display:'flex', alignItems:'center', gap:6}}>
            <span className="pulse" style={{display:'inline-block', width:6, height:6, borderRadius:'50%', background:'var(--umi-blue)'}}/>
            Cargando…
          </span>
        )}
      </div>

      {/* Tickets list */}
      {displayed.length === 0 ? (
        <div className="card fade-up d4" style={{padding:'48px 32px', textAlign:'center', color:'var(--ink-3)'}}>
          <I.Receipt size={32} style={{opacity:0.3, marginBottom:12}}/>
          <div style={{fontWeight:600, fontSize:15, marginBottom:4}}>Sin pedidos</div>
          <div style={{fontSize:13}}>No hay tickets en este filtro.</div>
        </div>
      ) : (
        <div className="fade-up d4" style={{display:'flex', flexDirection:'column', gap:10}}>
          {displayed.map(function(ticket) {
            return <TicketRow
              key={ticket.ticket_id}
              ticket={ticket}
              onSelect={() => setSelected(ticket)}
              onTransition={async (status) => {
                await transitionOrder(ticket.ticket_id, status);
                setRefresh(r => r + 1);
              }}
            />;
          })}
        </div>
      )}

      {/* Legend */}
      <div className="card fade-up d5" style={{padding:'14px 20px', display:'flex', gap:20, alignItems:'center', flexWrap:'wrap'}}>
        <div className="eyebrow">Estado</div>
        {Object.entries(ORDER_STATUS_META).map(function(entry) {
          var st = entry[0]; var meta = entry[1];
          return (
            <span key={st} className="legend" style={{color: meta.color}}>
              <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:meta.color, marginRight:6, verticalAlign:'middle'}}/>
              {meta.label}
            </span>
          );
        })}
        <span style={{marginLeft:'auto', fontSize:12, color:'var(--ink-3)', fontFamily:'var(--font-mono)'}}>
          Fuente · kds.tickets <XSep/> Supabase
        </span>
      </div>

      {selected && (
        <TicketDetail
          ticket={selected}
          onClose={() => setSelected(null)}
          onTransition={async (status) => {
            await transitionOrder(selected.ticket_id, status);
            setSelected(null);
            setRefresh(r => r + 1);
          }}
        />
      )}
    </div>
  );
};

const TicketRow = ({ ticket, onSelect, onTransition }) => {
  const meta  = ORDER_STATUS_META[ticket.status] || ORDER_STATUS_META.new;
  const isActive = ACTIVE_STATUSES.indexOf(ticket.status) !== -1;

  function fmtAgo(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return Math.floor(ms/1000) + 's';
    if (ms < 3600000) return Math.floor(ms/60000) + ' min';
    return Math.floor(ms/3600000) + 'h';
  }

  return (
    <div className={'list-card ' + (isActive ? '' : 'dim')} style={{padding:0, paddingRight:18}}>
      {/* Status strip */}
      <div className="l-strip" style={{background: meta.color}}/>
      <div style={{paddingTop:16, paddingBottom:16, paddingLeft:18, flex:1, display:'flex', gap:18, alignItems:'center'}}>

        {/* Status badge */}
        <div style={{
          width:88, textAlign:'center',
          padding:'5px 0', borderRadius:8,
          background: meta.bg, border:'1px solid ' + meta.color + '40',
          flexShrink:0,
        }}>
          <span style={{fontSize:11, fontWeight:700, color: meta.color, letterSpacing:'0.06em', textTransform:'uppercase'}}>
            {meta.label}
          </span>
        </div>

        {/* Customer */}
        <div style={{minWidth:160}}>
          <div style={{fontWeight:600, fontSize:14}}>{ticket.customer_name || 'Sin nombre'}</div>
          <div style={{fontSize:12, color:'var(--ink-3)', fontFamily:'var(--font-mono)'}}>{ticket.customer_phone || '—'}</div>
        </div>

        {/* Station */}
        <div style={{minWidth:120}}>
          <div className="eyebrow" style={{fontSize:10, marginBottom:2}}>Estación</div>
          <span className="chip" style={{fontSize:11.5, height:24, fontWeight:600}}>{ticket.station_name || '—'}</span>
        </div>

        {/* Items */}
        {ticket.items_count != null && (
          <div style={{minWidth:60, textAlign:'center'}}>
            <div className="eyebrow" style={{fontSize:10, marginBottom:2}}>Items</div>
            <div style={{fontWeight:600, fontSize:15}}>{ticket.items_count}</div>
          </div>
        )}

        {/* Amount */}
        <div style={{minWidth:90, textAlign:'right', marginLeft:'auto'}}>
          <div className="eyebrow" style={{fontSize:10, marginBottom:2}}>Total</div>
          <div style={{fontWeight:600, fontSize:16, fontFamily:'var(--font-display)', letterSpacing:'-0.01em'}}>
            {ticket.total_amount ? '$ ' + parseFloat(ticket.total_amount).toLocaleString('es-MX') : '—'}
          </div>
          <div style={{fontSize:11, color:'var(--ink-3)', marginTop:1}}>MXN</div>
        </div>

        {/* Time */}
        <div style={{minWidth:52, textAlign:'right', flexShrink:0}}>
          <div className="eyebrow" style={{fontSize:10, marginBottom:2}}>Hace</div>
          <div style={{fontWeight:600, fontSize:14, fontFamily:'var(--font-mono)', color:'var(--ink-2)'}}>{fmtAgo(ticket.created_at)}</div>
        </div>

        <div style={{display:'flex', gap:6, flexShrink:0}}>
          {ticket.status === 'new' && (
            <button className="btn btn-secondary btn-sm" onClick={() => onTransition('accepted')}>Aceptar</button>
          )}
          {(ticket.status === 'accepted' || ticket.status === 'new') && (
            <button className="btn btn-secondary btn-sm" onClick={() => onTransition('preparing')}>Cocina</button>
          )}
          {ticket.status === 'preparing' && (
            <button className="btn btn-primary btn-sm" onClick={() => onTransition('ready')}>Listo</button>
          )}
          {ticket.status === 'ready' && (
            <button className="btn btn-primary btn-sm" onClick={() => onTransition('completed')}>Cerrar</button>
          )}
          <button className="btn-icon" onClick={onSelect} aria-label="Ticket detail"><I.ChevronRight size={15}/></button>
        </div>

      </div>
    </div>
  );
};

const TicketDetail = ({ ticket, onClose, onTransition }) => {
  const items = ticket.items || [];
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}></div>
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">KDS ticket</div>
            <h2 className="h-section" style={{marginTop:4}}>{ticket.customer_name || 'Pedido WhatsApp'}</h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><I.X size={16}/></button>
        </div>
        <div className="sheet-body">
          <div className="card" style={{padding:16}}>
            <div className="eyebrow" style={{marginBottom:8}}>Cliente</div>
            <div style={{fontWeight:600}}>{ticket.customer_name || 'Sin nombre'}</div>
            <div style={{fontFamily:'var(--font-mono)', color:'var(--ink-3)', marginTop:4}}>{ticket.customer_phone || '—'}</div>
            {ticket.customer_note && <div style={{marginTop:10, color:'var(--ink-2)'}}>{ticket.customer_note}</div>}
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {items.length === 0 ? (
              <div style={{color:'var(--ink-3)', fontSize:13}}>No hay items disponibles para este ticket.</div>
            ) : items.map(item => (
              <div key={item.ticket_item_id} className="list-card" style={{padding:14}}>
                <div style={{paddingLeft:14, flex:1}}>
                  <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
                    <b>{item.quantity}× {item.name}</b>
                    <span style={{fontFamily:'var(--font-mono)', color:'var(--ink-2)'}}>
                      {item.unit_price != null ? '$ ' + Number(item.unit_price).toLocaleString('es-MX') : '—'}
                    </span>
                  </div>
                  {item.variant_name && <div style={{fontSize:12, color:'var(--ink-3)', marginTop:3}}>{item.variant_name}</div>}
                  {item.notes && <div style={{fontSize:12.5, color:'var(--ink-2)', marginTop:6}}>{item.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          {ticket.status !== 'completed' && ticket.status !== 'cancelled' && (
            <button className="btn btn-primary" onClick={() => onTransition(nextStatus(ticket.status))}>
              Avanzar estado
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

function nextStatus(status) {
  if (status === 'new') return 'accepted';
  if (status === 'accepted') return 'preparing';
  if (status === 'preparing') return 'ready';
  if (status === 'ready') return 'completed';
  return status;
}

export default OrdersScreen

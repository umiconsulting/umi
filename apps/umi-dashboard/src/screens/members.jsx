import React, { useState, useEffect } from 'react'
import { I } from '../icons.jsx'
import { XSep } from '../shell.jsx'
import { useMembersData } from '../data.jsx'

// Screen 7 — Miembros / Loyalty Members
// Data: umi-cash GET /api/[slug]/admin/customers (role: CUSTOMER)
// Schema: User + LoyaltyCard (balanceCentavos, totalVisits, visitsThisCycle, pendingRewards)


const MembersScreen = () => {
  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [sort,   setSort]   = useState('recent');
  const [detail, setDetail] = useState(null); // member id for slide-out

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: result, loading } = useMembersData({ page, search: debouncedSearch, sort });
  const customers = (result && result.customers) || [];
  const total     = (result && result.total) || 0;
  const totalPages = (result && result.totalPages) || 1;

  const detailMember = detail ? customers.find(c => c.id === detail) : null;

  function fmtBalance(centavos) {
    if (!centavos && centavos !== 0) return '—';
    return '$ ' + (centavos / 100).toLocaleString('es-MX', { minimumFractionDigits: 0 });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtAgo(iso) {
    if (!iso) return '—';
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 3600000)  return Math.floor(ms/60000) + ' min';
    if (ms < 86400000) return Math.floor(ms/3600000) + 'h';
    return Math.floor(ms/86400000) + 'd';
  }

  const SORT_OPTIONS = [
    { value: 'recent',   label: 'Más recientes' },
    { value: 'visits',   label: 'Más visitas'   },
    { value: 'balance',  label: 'Mayor saldo'   },
    { value: 'ltv',      label: 'Mayor LTV'     },
    { value: 'inactive', label: 'Más inactivos' },
  ];

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>

      {/* Header */}
      <div className="ed-head fade-up d1">
        <div className="titles">
          <div className="sec-index">
            <span className="nn">A</span><span>/</span>
            <span>UMI CASH <XSep/> {total.toLocaleString('es-MX')} MIEMBROS</span>
          </div>
          <h2>Miembros activos</h2>
          <div className="en">Loyalty members · Umi Cash</div>
        </div>
        <div style={{display:'flex', gap:10, alignItems:'center'}}>
          <select
            className="select"
            style={{height:38, fontSize:13, padding:'0 32px 0 12px'}}
            value={sort}
            onChange={e => { setSort(e.target.value); setPage(1); }}
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Search + summary strip */}
      <div className="fade-up d2" style={{display:'flex', gap:14, alignItems:'center'}}>
        <div style={{position:'relative', flex:1, maxWidth:360}}>
          <I.Search size={15} style={{position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--ink-3)', pointerEvents:'none'}}/>
          <input
            className="input"
            style={{height:40, paddingLeft:36, fontSize:13}}
            placeholder="Buscar por nombre, teléfono o tarjeta…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        {loading && (
          <span style={{fontSize:12, color:'var(--ink-3)', display:'flex', alignItems:'center', gap:6}}>
            <span className="pulse" style={{display:'inline-block', width:6, height:6, borderRadius:'50%', background:'var(--umi-blue)'}}/>
            Cargando…
          </span>
        )}
        <span style={{marginLeft:'auto', fontSize:12.5, color:'var(--ink-3)'}}>
          {customers.length} de {total.toLocaleString('es-MX')} miembros
        </span>
      </div>

      {/* Members table */}
      <div className="card fade-up d3" style={{padding:0, overflow:'hidden'}}>
        <table className="matrix">
          <thead>
            <tr>
              <th style={{width:'22%'}}>Miembro</th>
              <th>Tarjeta</th>
              <th style={{textAlign:'right'}}>Saldo</th>
              <th style={{textAlign:'center'}}>Visitas</th>
              <th style={{textAlign:'center'}}>Progreso</th>
              <th style={{textAlign:'center'}}>Pendientes</th>
              <th>Última visita</th>
              <th style={{textAlign:'right'}}>LTV</th>
              <th style={{width:44}}></th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && !loading && (
              <tr>
                <td colSpan={9} style={{textAlign:'center', padding:'40px 20px', color:'var(--ink-3)'}}>
                  Sin miembros en este filtro.
                </td>
              </tr>
            )}
            {customers.map(c => (
              <MemberRow
                key={c.id}
                customer={c}
                fmtBalance={fmtBalance}
                fmtDate={fmtDate}
                fmtAgo={fmtAgo}
                onDetail={() => setDetail(detail === c.id ? null : c.id)}
                isSelected={detail === c.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="fade-up d4" style={{display:'flex', justifyContent:'center', alignItems:'center', gap:10}}>
          <button
            className="btn btn-ghost btn-sm focusable"
            disabled={page <= 1}
            style={{opacity: page <= 1 ? 0.4 : 1}}
            onClick={() => setPage(p => Math.max(1, p-1))}
          >
            <I.ChevronLeft size={14}/> Anterior
          </button>
          <span style={{fontSize:13, color:'var(--ink-2)', fontFamily:'var(--font-mono)'}}>
            {page} / {totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm focusable"
            disabled={page >= totalPages}
            style={{opacity: page >= totalPages ? 0.4 : 1}}
            onClick={() => setPage(p => Math.min(totalPages, p+1))}
          >
            Siguiente <I.ChevronRight size={14}/>
          </button>
        </div>
      )}

      {/* Data source note */}
      <div className="card fade-up d5" style={{padding:'14px 20px', display:'flex', gap:18, alignItems:'center', flexWrap:'wrap'}}>
        <div className="eyebrow">Umi Cash</div>
        <span className="legend"><I.CreditCard size={12} style={{verticalAlign:'-2px', marginRight:4}}/> LoyaltyCard · balanceCentavos en centavos</span>
        <span className="legend"><I.Activity size={12} style={{verticalAlign:'-2px', marginRight:4}}/> totalVisits · visitsThisCycle · pendingRewards</span>
        <span style={{marginLeft:'auto', fontSize:12, color:'var(--ink-3)', fontFamily:'var(--font-mono)'}}>
          GET /api/:slug/admin/customers
        </span>
      </div>

      {/* Member detail slide-out */}
      {detailMember && (
        <MemberDetail
          member={detailMember}
          fmtBalance={fmtBalance}
          fmtDate={fmtDate}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};

const MemberRow = ({ customer: c, fmtBalance, fmtDate, fmtAgo, onDetail, isSelected }) => {
  const hue = Math.abs(c.id.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % 360;
  const initials = (c.name || 'UN').split(' ').map(p => p[0]).slice(0,2).join('').toUpperCase();
  const visitsRequired = c.visitsRequired || null;
  const progress = visitsRequired ? Math.min(1, (c.visitsThisCycle || 0) / visitsRequired) : 0;

  return (
    <tr style={{background: isSelected ? 'var(--canvas)' : undefined}}>
      {/* Name */}
      <td>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <div className="avatar-lg" style={{
            background: `oklch(0.78 0.08 ${hue})`,
            color:      `oklch(0.28 0.08 ${hue})`,
          }}>{initials}</div>
          <div>
            <div style={{fontWeight:600, fontSize:13.5}}>{c.name || 'Sin nombre'}</div>
            <div style={{fontSize:11.5, color:'var(--ink-3)', fontFamily:'var(--font-mono)'}}>{c.phone || '—'}</div>
          </div>
        </div>
      </td>
      {/* Card */}
      <td style={{fontFamily:'var(--font-mono)', fontSize:12, color:'var(--ink-2)'}}>{c.cardNumber || '—'}</td>
      {/* Balance */}
      <td style={{textAlign:'right', fontWeight:600, fontSize:14, fontFamily:'var(--font-display)', letterSpacing:'-0.01em'}}>
        {fmtBalance(c.balanceCentavos)}
        <div style={{fontSize:10.5, color:'var(--ink-3)', fontWeight:400}}>MXN</div>
      </td>
      {/* Visits */}
      <td style={{textAlign:'center'}}>
        <div style={{fontWeight:700, fontSize:16}}>{c.totalVisits || 0}</div>
        <div style={{fontSize:10.5, color:'var(--ink-3)'}}>total</div>
      </td>
      {/* Cycle progress bar */}
      <td style={{textAlign:'center', minWidth:80}}>
        <div style={{fontSize:11.5, fontWeight:600, marginBottom:4, color:'var(--ink-2)'}}>
          {visitsRequired ? `${c.visitsThisCycle || 0} / ${visitsRequired}` : `${c.visitsThisCycle || 0} ciclo`}
        </div>
        <div style={{height:5, borderRadius:3, background:'var(--line-soft)', overflow:'hidden'}}>
          <div style={{
            height:'100%', width: (progress*100) + '%',
            background: visitsRequired && progress >= 1 ? 'var(--success)' : 'var(--umi-blue)',
            borderRadius:3, transition:'width 0.3s',
          }}/>
        </div>
      </td>
      {/* Pending rewards */}
      <td style={{textAlign:'center'}}>
        {c.pendingRewards > 0
          ? <span className="chip" style={{background:'var(--success-soft)', color:'var(--success)', fontWeight:700, fontSize:12}}>
              {c.pendingRewards} 🎁
            </span>
          : <span style={{color:'var(--ink-4)', fontSize:12}}>—</span>
        }
      </td>
      {/* Last visit */}
      <td style={{color:'var(--ink-2)', fontSize:13}}>
        {c.lastVisit ? fmtAgo(c.lastVisit) + ' atrás' : 'Nunca'}
      </td>
      {/* LTV */}
      <td style={{textAlign:'right', fontWeight:600, fontSize:13, color:'var(--ink-2)'}}>
        {c.ltvMXN || '—'}
      </td>
      {/* Actions */}
      <td>
        <button
          className={"btn-icon focusable" + (isSelected ? ' active' : '')}
          onClick={onDetail}
          aria-label="Ver detalle"
          style={{opacity: isSelected ? 1 : undefined}}
        >
          <I.ChevronRight size={15}/>
        </button>
      </td>
    </tr>
  );
};

const MemberDetail = ({ member: c, fmtBalance, fmtDate, onClose }) => {
  const hue = Math.abs(c.id.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % 360;
  const initials = (c.name || 'UN').split(' ').map(p => p[0]).slice(0,2).join('').toUpperCase();

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}/>
      <aside className="sheet">
        <div className="sheet-head">
          <div style={{display:'flex', alignItems:'center', gap:14}}>
            <div className="avatar-lg" style={{
              width:48, height:48, fontSize:17,
              background: `oklch(0.78 0.08 ${hue})`,
              color:      `oklch(0.28 0.08 ${hue})`,
            }}>{initials}</div>
            <div>
              <div className="eyebrow">Miembro · Umi Cash</div>
              <h2 className="h-section" style={{marginTop:2, fontSize:17}}>{c.name || 'Sin nombre'}</h2>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Cerrar"><I.X size={16}/></button>
        </div>

        <div className="sheet-body">
          {/* Key stats */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <StatCard label="Saldo · monedero" value={fmtBalance(c.balanceCentavos)} unit="MXN" accent="var(--umi-blue)"/>
            <StatCard label="Visitas totales"  value={c.totalVisits || 0} accent="var(--success)"/>
            <StatCard label="LTV estimado"     value={c.ltvMXN || '—'} accent="var(--ink-2)"/>
            <StatCard label="Recompensas pendientes" value={c.pendingRewards || 0} accent={c.pendingRewards > 0 ? 'var(--warning)' : 'var(--ink-3)'}/>
          </div>

          {/* Info rows */}
          <div style={{display:'flex', flexDirection:'column', gap:0, marginTop:4}}>
            {[
              { label: 'Teléfono',    value: c.phone      || '—', mono: true },
              { label: 'Número de tarjeta', value: c.cardNumber || '—', mono: true },
              { label: 'Última visita',   value: c.lastVisit ? fmtDate(c.lastVisit) : 'Nunca' },
              { label: 'Miembro desde',  value: fmtDate(c.createdAt) },
            ].map(row => (
              <div key={row.label} style={{
                display:'flex', justifyContent:'space-between', alignItems:'center',
                padding:'10px 0', borderBottom:'1px solid var(--line-soft)',
              }}>
                <span style={{fontSize:12.5, color:'var(--ink-3)', letterSpacing:'0.04em'}}>{row.label}</span>
                <span style={{
                  fontSize: row.mono ? 12 : 13.5,
                  fontWeight: row.mono ? 400 : 600,
                  fontFamily: row.mono ? 'var(--font-mono)' : undefined,
                  color:'var(--ink-1)',
                }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Cycle progress */}
          <div style={{marginTop:8}}>
            <div className="eyebrow" style={{marginBottom:8}}>Progreso en ciclo actual</div>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:13, fontWeight:600}}>
              <span>{c.visitsThisCycle || 0} visitas completadas</span>
              <span style={{color:'var(--ink-3)', fontWeight:400}}>{c.visitsRequired ? `meta: ${c.visitsRequired}` : 'meta sin configurar'}</span>
            </div>
            <div style={{height:8, borderRadius:4, background:'var(--line-soft)', overflow:'hidden'}}>
              <div style={{
                height:'100%',
                width: c.visitsRequired ? Math.min(100, ((c.visitsThisCycle || 0) / c.visitsRequired) * 100) + '%' : '0%',
                background:'var(--umi-blue)',
                borderRadius:4, transition:'width 0.4s',
              }}/>
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="btn btn-secondary focusable">
            <I.Wallet size={15}/> Top-up monedero
          </button>
        </div>
      </aside>
    </>
  );
};

const StatCard = ({ label, value, unit, accent }) => (
  <div className="card" style={{padding:'14px 16px'}}>
    <div style={{fontSize:10.5, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', marginBottom:6}}>{label}</div>
    <div style={{fontFamily:'var(--font-display)', fontWeight:700, fontSize:22, color: accent || 'var(--ink-1)', letterSpacing:'-0.02em'}}>
      {value}
    </div>
    {unit && <div style={{fontSize:10.5, color:'var(--ink-3)', marginTop:2}}>{unit}</div>}
  </div>
);

export default MembersScreen

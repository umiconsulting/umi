import React, { useState, useEffect } from 'react'
import { I } from '../icons.jsx'
import { XSep } from '../shell.jsx'
import { useBusinessHours, saveBusinessHours } from '../data.jsx'

// Screen 4 — Business Hours & Availability


const DAYS = [
  { id: 'mon', es: 'Lunes',    en: 'Monday',    abbr: 'Lun' },
  { id: 'tue', es: 'Martes',   en: 'Tuesday',   abbr: 'Mar' },
  { id: 'wed', es: 'Miércoles', en: 'Wednesday', abbr: 'Mié' },
  { id: 'thu', es: 'Jueves',   en: 'Thursday',  abbr: 'Jue' },
  { id: 'fri', es: 'Viernes',  en: 'Friday',    abbr: 'Vie' },
  { id: 'sat', es: 'Sábado',   en: 'Saturday',  abbr: 'Sáb' },
  { id: 'sun', es: 'Domingo',  en: 'Sunday',    abbr: 'Dom' },
];

const DEFAULT_HOURS = {
  mon: { open: true, from: '08:00', to: '23:00' },
  tue: { open: true, from: '08:00', to: '23:00' },
  wed: { open: true, from: '08:00', to: '23:00' },
  thu: { open: true, from: '08:00', to: '23:30' },
  fri: { open: true, from: '08:00', to: '00:30' },
  sat: { open: true, from: '09:00', to: '00:30' },
  sun: { open: false, from: '09:00', to: '22:00' },
};

const NUM_TO_DAY = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};

function normalizeHours(input) {
  const next = Object.fromEntries(
    Object.entries(DEFAULT_HOURS).map(([day, value]) => [day, { ...value }])
  );
  const source = input?.days && typeof input.days === 'object' ? input.days : input;
  if (!source || typeof source !== 'object') return next;

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const day = NUM_TO_DAY[rawKey] || rawKey;
    if (!next[day]) continue;

    if (rawValue === null) {
      next[day] = { ...next[day], open: false };
      continue;
    }

    if (Array.isArray(rawValue)) {
      next[day] = {
        ...next[day],
        open: true,
        from: `${String(rawValue[0] ?? 8).padStart(2, '0')}:00`,
        to: `${String(rawValue[1] ?? 20).padStart(2, '0')}:00`,
      };
      continue;
    }

    if (typeof rawValue === 'object') {
      next[day] = {
        ...next[day],
        open: rawValue.open !== false && rawValue.closed !== true,
        from: rawValue.from || rawValue.open || next[day].from,
        to: rawValue.to || rawValue.close || next[day].to,
      };
    }
  }

  return next;
}

const HoursScreen = ({ ordersPaused, setOrdersPaused }) => {
  const { data: hoursData, loading: hoursLoading } = useBusinessHours();
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [savedJson, setSavedJson] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null); // 'saved' | 'error' | null
  const [cutoff, setCutoff] = useState(45);
  const [tz, setTz] = useState('America/Mexico_City');
  const [notice, setNotice] = useState('Hoy nuestro horario será reducido por capacitación. Aceptamos pedidos hasta las 10pm.');
  const [bypass, setBypass] = useState(['+52 667 312 4480', '+52 667 901 1124', '+52 667 402 0091']);
  const [bypassInput, setBypassInput] = useState('');
  const [confirmPause, setConfirmPause] = useState(null); // {to: bool}

  useEffect(() => {
    if (hoursData && hoursData.hours) {
      const normalized = normalizeHours(hoursData.hours);
      setHours(normalized);
      setSavedJson(JSON.stringify(normalized));
      if (hoursData.timezone) setTz(hoursData.timezone);
    }
  }, [hoursData]);

  const isDirty = savedJson !== null && savedJson !== JSON.stringify(hours);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveBusinessHours(hours, tz);
      setSavedJson(JSON.stringify(hours));
      setSaveMsg('saved');
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      setSaveMsg('error');
    } finally {
      setSaving(false);
    }
  };

  const update = (d, k, v) => setHours(h => ({ ...h, [d]: { ...(h[d] || DEFAULT_HOURS[d]), [k]: v } }));

  const handlePauseToggle = () => {
    setConfirmPause({ to: !ordersPaused });
  };

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>
      {/* Pause banner */}
      <div className={"card fade-up d1"} style={{
        padding: 0,
        background: ordersPaused ? 'linear-gradient(90deg, #fef3eb, #fceae0)' : undefined,
        borderColor: ordersPaused ? '#f0c79b' : undefined,
        display:'flex', alignItems:'center', gap: 0, overflow:'hidden',
      }}>
        <div style={{width:4, alignSelf:'stretch', background: ordersPaused ? 'var(--warning)' : 'var(--success)'}}></div>
        <div style={{display:'flex', alignItems:'center', gap:18, padding:'18px 22px', flex:1}}>
          <div style={{
            width:48, height:48, borderRadius:14,
            background: ordersPaused ? 'rgba(181,129,42,0.18)' : 'var(--success-soft)',
            color: ordersPaused ? 'var(--warning)' : 'var(--success)',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            {ordersPaused ? <I.Pause size={20}/> : <I.WhatsApp size={20}/>}
          </div>
          <div style={{flex:1}}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span className="eyebrow" style={{color: ordersPaused ? 'var(--warning)' : 'var(--success)'}}>ConversaFlow · WhatsApp orders</span>
            </div>
            <div style={{fontWeight:600, fontSize:16, marginTop:4}}>
              {ordersPaused ? 'Orders are paused globally' : 'Orders are open · accepting incoming WhatsApp messages'}
            </div>
            <div style={{fontSize:13, color:'var(--ink-2)', marginTop:2}}>
              {ordersPaused
                ? 'New customers receive your special notice. Existing in-flight orders continue normally.'
                : `Cutoff active · WhatsApp orders stop ${cutoff} min before closing time.`}
            </div>
          </div>
          <button
            className={"btn focusable " + (ordersPaused ? "btn-primary" : "btn-secondary")}
            onClick={handlePauseToggle}
            style={ordersPaused ? {background: 'var(--warning)'} : undefined}
          >
            {ordersPaused ? <><I.Play size={15}/> Resume orders</> : <><I.Pause size={15}/> Pause orders</>}
          </button>
        </div>
      </div>

      {/* Hours grid */}
      <div className="grid fade-up d2" style={{gridTemplateColumns:'1.4fr 1fr', gap:18}}>
        <div className="card" style={{padding:'22px 22px 14px'}}>
          <div className="ed-head" style={{marginBottom:14}}>
            <div className="titles">
              <div className="sec-index"><span className="nn">A</span><span>/</span><span>HORARIO SEMANAL{hoursLoading && <span style={{marginLeft:6, fontSize:10, opacity:0.5}}>· cargando…</span>}</span></div>
              <h2>Horas de apertura</h2>
              <div className="en">Opening hours</div>
            </div>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <I.Clock size={14} style={{color:'var(--ink-3)'}}/>
              <select className="select" style={{height:36, fontSize:13, padding:'0 32px 0 12px'}} value={tz} onChange={e=>setTz(e.target.value)}>
                <option value="America/Mexico_City">America / Mexico_City (GMT−6)</option>
                <option value="America/Monterrey">America / Monterrey (GMT−6)</option>
                <option value="America/Tijuana">America / Tijuana (GMT−7)</option>
                <option value="America/Cancun">America / Cancun (GMT−5)</option>
              </select>
              {isDirty && (
                <button
                  className="btn btn-primary focusable"
                  style={{height:36, padding:'0 16px', fontSize:13}}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Guardando…' : <><I.Check size={14}/> Guardar</>}
                </button>
              )}
              {saveMsg === 'saved' && !isDirty && (
                <span style={{fontSize:12, color:'var(--success)', display:'flex', alignItems:'center', gap:4}}>
                  <I.Check size={13}/> Guardado
                </span>
              )}
              {saveMsg === 'error' && (
                <span style={{fontSize:12, color:'var(--danger)'}}>Error al guardar</span>
              )}
            </div>
          </div>

          <div>
            {DAYS.map(d => {
              const h = hours[d.id] || DEFAULT_HOURS[d.id];
              return (
                <div className="day-row" key={d.id}>
                  <div className="dn">
                    {d.es}
                    <small>{d.abbr}</small>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:10}}>
                    <div
                      className={"switch " + (h.open ? 'on' : '')}
                      onClick={() => update(d.id, 'open', !h.open)}
                    />
                    <span style={{fontSize:12, fontWeight:600, color: h.open ? 'var(--ink-1)' : 'var(--ink-3)', minWidth: 50}}>
                      {h.open ? 'OPEN' : 'CLOSED'}
                    </span>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <input
                      type="time"
                      className="input"
                      style={{height:38, padding:'0 10px', fontFamily:'var(--font-mono)', flex:1}}
                      value={h.from}
                      disabled={!h.open}
                      onChange={e => update(d.id, 'from', e.target.value)}
                    />
                    <span style={{color:'var(--ink-4)'}}>→</span>
                    <input
                      type="time"
                      className="input"
                      style={{height:38, padding:'0 10px', fontFamily:'var(--font-mono)', flex:1}}
                      value={h.to}
                      disabled={!h.open}
                      onChange={e => update(d.id, 'to', e.target.value)}
                    />
                  </div>
                  <div style={{textAlign:'right'}}>
                    <button className="btn-icon" aria-label="Copy to all"><I.Refresh size={14}/></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right side panel */}
        <div style={{display:'flex', flexDirection:'column', gap:18}}>
          {/* Cutoff */}
          <div className="card" style={{padding:'22px'}}>
            <div className="eyebrow">ConversaFlow</div>
            <h3 className="h-section" style={{marginTop:6, marginBottom:14, fontSize:16}}>Order cutoff</h3>
            <p style={{fontSize:13.5, color:'var(--ink-2)', marginTop:0, marginBottom:18}}>
              Stop accepting WhatsApp orders this many minutes before closing time.
            </p>
            <div style={{display:'flex', alignItems:'center', gap:14}}>
              <div className="card-warm" style={{padding:'12px 16px', borderRadius:12, display:'flex', alignItems:'baseline', gap:6}}>
                <div className="display" style={{fontSize:32, color:'var(--ink-warm)'}}>{cutoff}</div>
                <div style={{fontSize:12, color:'var(--ink-warm-soft)'}}>min</div>
              </div>
              <input
                type="range" min={0} max={120} step={5}
                value={cutoff}
                onChange={e => setCutoff(parseInt(e.target.value))}
                style={{
                  flex:1, height:6, appearance:'none',
                  background: `linear-gradient(90deg, var(--umi-navy) ${cutoff/120*100}%, var(--line-strong) ${cutoff/120*100}%)`,
                  borderRadius: 3, accentColor: 'var(--umi-navy)',
                }}
              />
            </div>
            <div style={{display:'flex', justifyContent:'space-between', marginTop:8, fontSize:11, color:'var(--ink-3)', letterSpacing:'0.06em'}}>
              <span>0 MIN</span>
              <span>120 MIN</span>
            </div>
          </div>

          {/* Special notice */}
          <div className="card" style={{padding:'22px'}}>
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
              <I.Megaphone size={16} style={{color:'var(--ink-2)'}}/>
              <div className="eyebrow">Broadcast</div>
            </div>
            <h3 className="h-section" style={{marginTop:2, marginBottom:14, fontSize:16}}>Special notice</h3>
            <textarea
              className="input"
              value={notice}
              onChange={e => setNotice(e.target.value)}
              placeholder="Mensaje que verán los clientes en su próxima interacción..."
              style={{minHeight:90}}
            />
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8}}>
              <span style={{fontSize:12, color:'var(--ink-3)'}}>Sent on next customer interaction · {notice.length} / 280</span>
              <button className="btn-sm btn btn-ghost"><I.Refresh size={13}/> Clear</button>
            </div>
          </div>
        </div>
      </div>

      {/* Bypass phones */}
      <div className="card fade-up d3" style={{padding:'22px'}}>
        <div className="ed-head" style={{marginBottom:14, paddingBottom:12}}>
          <div className="titles">
            <div className="sec-index"><span className="nn">C</span><span>/</span><span>INTERNO <XSep/> BYPASS</span></div>
            <h2>Teléfonos exentos</h2>
            <div className="en">Bypass phones <XSep/> can place test orders when closed or paused</div>
          </div>
        </div>
        <div className="bypass-zone">
          {bypass.map(p => (
            <span className="chip removable" key={p} style={{height:32, fontFamily:'var(--font-mono)', fontSize:12.5, paddingLeft:14}}>
              {p}
              <button className="x focusable" onClick={() => setBypass(prev => prev.filter(x => x !== p))} aria-label="Remove">
                <I.X size={12}/>
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (bypassInput.trim()) { setBypass(prev => [...prev, bypassInput.trim()]); setBypassInput(''); }
            }}
            style={{display:'flex', flex:1, minWidth:200}}
          >
            <input
              className="input"
              style={{height:32, fontSize:13, border:'none', background:'transparent', flex:1}}
              placeholder="Add a phone number and press Enter..."
              value={bypassInput}
              onChange={e => setBypassInput(e.target.value)}
            />
          </form>
        </div>
      </div>

      {confirmPause && (
        <PauseConfirm
          to={confirmPause.to}
          onConfirm={() => { setOrdersPaused(confirmPause.to); setConfirmPause(null); }}
          onCancel={() => setConfirmPause(null)}
        />
      )}
    </div>
  );
};

const PauseConfirm = ({ to, onConfirm, onCancel }) => (
  <div className="modal-backdrop" onClick={onCancel}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <div style={{display:'flex', alignItems:'center', gap:14, marginBottom:18}}>
        <div style={{
          width:44, height:44, borderRadius:12,
          background: to ? 'var(--warning-soft)' : 'var(--success-soft)',
          color: to ? 'var(--warning)' : 'var(--success)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          {to ? <I.AlertTriangle size={20}/> : <I.Play size={20}/>}
        </div>
        <div>
          <div className="eyebrow">{to ? 'Confirm pause' : 'Resume orders'}</div>
          <div style={{fontWeight:600, fontSize:17, marginTop:2}}>
            {to ? 'Pause WhatsApp orders globally?' : 'Resume accepting WhatsApp orders?'}
          </div>
        </div>
      </div>
      <p style={{fontSize:13.5, color:'var(--ink-2)', marginTop:0, marginBottom:24, lineHeight:1.55}}>
        {to ? (
          <>New customers will receive your special notice. <b>In-flight orders</b> continue normally on the KDS.
          Bypass phones can still place test orders. You can resume at any time.</>
        ) : (
          <>Customers will be able to place WhatsApp orders again, subject to your business hours and order cutoff.</>
        )}
      </p>
      <div style={{display:'flex', justifyContent:'flex-end', gap:10}}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className={"btn btn-primary"}
          style={to ? {background:'var(--warning)'} : undefined}
          onClick={onConfirm}
        >
          {to ? 'Pause orders' : 'Resume orders'}
        </button>
      </div>
    </div>
  </div>
);

export default HoursScreen

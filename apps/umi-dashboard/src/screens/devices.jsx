import React, { useState, useEffect } from 'react'
import { I } from '../icons.jsx'
import { XSep } from '../shell.jsx'
import {
  approveDevicePairing,
  denyDevicePairing,
  generateDevicePairingPin,
  revokeDevice,
  updateDevice,
  useDevicePairings,
  useDevicesData,
  useKdsStations,
} from '../data.jsx'

// Screen 3 — Devices (KDS)
// Data: useDevicesData() → kds.device_sessions from Supabase
// Status derived from local heartbeat: <10s=live, <20s=slow, else=offline.


const STATIONS = ['HOT LINE', 'COLD LINE', 'PASTRY', 'BAR', 'PASS', 'OVEN'];
const DEVICE_LIVE_MS = 10_000;
const DEVICE_OFFLINE_MS = 20_000;

// Derive human-readable last-seen from last_used_at timestamp
function fmtLastSeen(lastUsedAt) {
  if (!lastUsedAt) return 'never';
  var ms = Date.now() - new Date(lastUsedAt).getTime();
  if (ms < 10000) return 'just now';
  if (ms < 60000) return Math.floor(ms / 1000) + ' s ago';
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago';
  return Math.floor(ms / 3600000) + 'h ago';
}

function deriveStatus(lastUsedAt) {
  if (!lastUsedAt) return 'offline';
  var ms = Date.now() - new Date(lastUsedAt).getTime();
  if (ms < DEVICE_LIVE_MS) return 'live';
  if (ms < DEVICE_OFFLINE_MS) return 'slow';
  return 'offline';
}

const POLL_INTERVAL = 8; // seconds — heartbeat is every 5 s, catch a miss quickly

const DevicesScreen = () => {
  const [refresh,     setRefresh]     = useState(0);
  const [stationOpen, setStationOpen] = useState(false);
  const [addOpen,     setAddOpen]     = useState(false);
  const [editDevice,  setEditDevice]  = useState(null);
  const [countdown,   setCountdown]   = useState(POLL_INTERVAL);

  // Auto-poll local heartbeat data so offline/online transitions are picked up.
  useEffect(function() {
    setCountdown(POLL_INTERVAL);
    const pollId = setInterval(function() {
      setRefresh(function(r) { return r + 1; });
      setCountdown(POLL_INTERVAL);
    }, POLL_INTERVAL * 1000);
    const tickId = setInterval(function() {
      setCountdown(function(c) { return c <= 1 ? POLL_INTERVAL : c - 1; });
    }, 1000);
    return function() { clearInterval(pollId); clearInterval(tickId); };
  }, []);

  const { data: rawDevices, loading } = useDevicesData(refresh);
  const { data: stations } = useKdsStations(refresh);
  const { data: pairings } = useDevicePairings(refresh);
  const devices = (rawDevices || []).map(function(d) {
    // Heartbeat (local, 5-s cadence) is the authoritative connection signal.
    // last_used_at (cloud) only updates on order bumps — not a heartbeat.
    const hbStatus = d._heartbeatStatus || null;
    const hbSeenMs = d._heartbeatSeenMs || null;
    const connectionStatus = hbStatus || deriveStatus(d.last_used_at);
    return {
      id:      d.device_id,
      name:    d.device_name,
      station: d.station_name || d.station_id,
      stationId: d.station_id,
      status:  connectionStatus,
      hasHeartbeat: !!hbStatus,
      open:    d.open || 0,
      last:    hbSeenMs ? fmtLastSeen(new Date(hbSeenMs).toISOString()) : fmtLastSeen(d.last_used_at),
      pin:     d.pin || '• • • • • •',
      model:   d.model || 'iPad',
      ip:      d.ip || '—',
      _raw:    d,
    };
  });

  const liveCount = devices.filter(function(d) { return d.status === 'live'; }).length;

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>

      {/* Header */}
      <div className="ed-head fade-up d1">
        <div className="titles">
          <div className="sec-index">
            <span className="nn">A</span><span>/</span>
            <span>
              EN VIVO <XSep/> {devices.length} DEVICES <XSep/> {liveCount} LIVE
              {loading && <span style={{marginLeft:8, fontSize:10, opacity:0.6}}>· actualizando…</span>}
            </span>
          </div>
          <h2>Dispositivos pareados</h2>
          <div className="en">Paired KDS devices · kds.device_sessions</div>
        </div>
        <div style={{display:'flex', gap:10}}>
          <button className="btn btn-ghost btn-sm focusable" onClick={() => { setRefresh(r => r+1); setCountdown(POLL_INTERVAL); }}>
            <I.Refresh size={14}/> Actualizar
          </button>
          <button className="btn btn-secondary focusable" onClick={() => setStationOpen(true)}>
            <I.Layout size={16}/> Estaciones
          </button>
          <button className="btn btn-primary focusable" onClick={() => setAddOpen(true)}>
            <I.Plus size={16}/> Añadir dispositivo
          </button>
        </div>
      </div>

      {/* Devices grid */}
      <div className="grid grid-2 fade-up d2" style={{gap:12}}>
        {devices.map(function(d) {
          return (
            <div
              key={d.id}
              className={'list-card ' + d.status}
              style={{padding: 0, paddingRight: 16, cursor:'pointer', transition:'box-shadow 0.15s'}}
              onClick={() => setEditDevice(d)}
              onMouseEnter={e => e.currentTarget.style.boxShadow='var(--shadow-pop)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow=''}
            >
              <div className="l-strip"/>
              <div style={{paddingTop:14, paddingBottom:14, flex:1, display:'flex', gap:14, alignItems:'center', minWidth:0}}>
                <div style={{
                  width:40, height:40, borderRadius:12,
                  background:'var(--canvas-2)', color:'var(--umi-navy)',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                }}>
                  <I.Tablet size={18}/>
                </div>

                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'nowrap'}}>
                    <span style={{fontWeight:600, fontSize:14, color:'var(--ink-1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d.name}</span>
                    <span className="chip" style={{fontSize:10, height:20, fontWeight:600, letterSpacing:'0.08em', flexShrink:0}}>{d.station || 'SIN ASIGNAR'}</span>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--ink-3)', flexWrap:'nowrap'}}>
                    <span style={{display:'inline-flex', alignItems:'center', gap:4, flexShrink:0}}>
                      <span className={'s-dot ' + d.status}/>
                      {loading && d.status !== 'live'
                        ? <span style={{color:'var(--warning)', fontStyle:'italic'}}>Reconectando…</span>
                        : d.status === 'live' ? 'Live' : d.status === 'slow' ? 'Slow' : 'Offline'
                      }
                    </span>
                    <span style={{color:'var(--ink-4)'}}>·</span>
                    <span style={{whiteSpace:'nowrap'}}>Visto {d.last}</span>
                    {d.status === 'offline' && !loading && (
                      <span style={{color:'var(--ink-4)', fontSize:11}}>· en {countdown}s</span>
                    )}
                  </div>
                </div>

                <div style={{textAlign:'center', flexShrink:0}}>
                  <div className="eyebrow" style={{fontSize:9, marginBottom:2}}>ÓRDENES</div>
                  <div style={{fontFamily:'var(--font-display)', fontSize:22, fontWeight:600, lineHeight:1, color: d.status === 'offline' ? 'var(--ink-4)' : 'var(--ink-1)'}}>{d.open}</div>
                </div>

                <button
                  className="btn-icon focusable"
                  onClick={e => { e.stopPropagation(); setEditDevice(d); }}
                  aria-label="Editar dispositivo"
                >
                  <I.Edit size={15}/>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {(pairings || []).length > 0 && (
        <PairingRequestsCard
          pairings={pairings}
          stations={stations || []}
          onChanged={() => setRefresh(r => r + 1)}
        />
      )}

      {/* Connection legend */}
      <div className="card fade-up d3" style={{padding:'18px 22px', display:'flex', gap:24, alignItems:'center', flexWrap:'wrap'}}>
        <div className="eyebrow">Connection legend</div>
        <span className="legend"><span className="s-dot live"/> Live · responding under 10 s</span>
        <span className="legend"><span className="s-dot slow"/> Slow · responding 10–20 s</span>
        <span className="legend"><span className="s-dot offline"/> Offline · no heartbeat 20 s+</span>
        <span style={{marginLeft:'auto', fontSize:12.5, color:'var(--ink-3)'}}>
          Source · <span style={{fontFamily:'var(--font-mono)'}}>local heartbeat</span> + <span style={{fontFamily:'var(--font-mono)'}}>kds.device_sessions</span>
        </span>
      </div>

      {stationOpen && <StationPanel onClose={() => setStationOpen(false)} devices={devices}/>}
      {addOpen && (
        <AddDevicePanel
          onClose={() => setAddOpen(false)}
          stations={stations || []}
          pairings={pairings || []}
          onProvisioned={() => setRefresh(r => r + 1)}
        />
      )}
      {editDevice && (
        <EditDevicePanel
          device={editDevice}
          stations={stations || []}
          onClose={() => setEditDevice(null)}
          onSaved={() => { setEditDevice(null); setRefresh(r => r + 1); }}
        />
      )}
    </div>
  );
};

const PairingRequestsCard = ({ pairings, stations, onChanged }) => {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const stationById = Object.fromEntries((stations || []).map(function(s) { return [s.id, s]; }));

  async function approve(id) {
    setBusy(id + ':approve');
    setError(null);
    try {
      await approveDevicePairing(id);
      onChanged && onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function deny(id) {
    setBusy(id + ':deny');
    setError(null);
    try {
      await denyDevicePairing(id);
      onChanged && onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card fade-up d3" style={{padding:'18px 22px', display:'flex', flexDirection:'column', gap:12}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:16}}>
        <div>
          <div className="eyebrow">Primer pareo</div>
          <h2 className="h-section" style={{marginTop:4}}>Solicitudes KDS pendientes</h2>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onChanged}>
          <I.Refresh size={14}/> Actualizar
        </button>
      </div>
      {error && (
        <div style={{fontSize:12.5, color:'var(--danger)', background:'var(--danger-soft)', borderRadius:10, padding:'9px 12px'}}>
          {error}
        </div>
      )}
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {pairings.map(function(p) {
          const station = stationById[p.station_id];
          const requested = p.requested_name || 'Esperando iPad';
          const pendingApproval = p.status === 'pending' && p.requested_name;
          return (
            <div key={p.id} className="list-card" style={{padding:14, alignItems:'center'}}>
              <div style={{paddingLeft:14, flex:1, minWidth:0}}>
                <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:3}}>
                  <b style={{fontSize:14}}>{p.device_name}</b>
                  <span className="chip" style={{height:22, fontSize:10.5, letterSpacing:'0.08em'}}>
                    {station?.name || p.station_id}
                  </span>
                  <span className="chip" style={{
                    height:22,
                    fontSize:10.5,
                    color: p.status === 'approved' ? 'var(--success)' : 'var(--warning)',
                    background: p.status === 'approved' ? 'var(--success-soft)' : 'var(--warning-soft)',
                  }}>
                    {p.status === 'approved' ? 'Aprobado' : pendingApproval ? 'Confirmar' : 'Esperando'}
                  </span>
                </div>
                <div style={{fontSize:12.5, color:'var(--ink-3)'}}>
                  iPad · {requested} <XSep/> expira {new Date(p.expires_at).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })}
                </div>
              </div>
              {p.status === 'pending' && (
                <div style={{display:'flex', gap:8}}>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy === p.id + ':deny'}
                    onClick={() => deny(p.id)}
                  >
                    <I.X size={14}/> Rechazar
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!p.requested_name || busy === p.id + ':approve'}
                    style={{opacity: p.requested_name ? 1 : 0.5}}
                    onClick={() => approve(p.id)}
                  >
                    <I.Check size={14}/> Aprobar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const EditDevicePanel = ({ device, stations, onClose, onSaved }) => {
  const [name,     setName]     = useState(device.name);
  const [station,  setStation]  = useState(device.stationId || '');
  const [reveal,   setReveal]   = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [error,    setError]    = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateDevice(device.id, { device_name: name, station_id: station || null });
      onSaved && onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await revokeDevice(device.id, 'removed_from_dashboard');
      onSaved && onSaved();
    } catch (err) {
      setError(err.message);
      setRemoving(false);
    }
  }

  const statusLabel = device.status === 'live' ? 'En vivo' : device.status === 'slow' ? 'Lento' : 'Sin conexión';

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}/>
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">KDS · Dispositivo</div>
            <h2 className="h-section" style={{marginTop:4}}>Gestionar dispositivo</h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Cerrar"><I.X size={16}/></button>
        </div>
        <div className="sheet-body">
          {/* Status summary */}
          <div className="card" style={{padding:'14px 18px', display:'flex', alignItems:'center', gap:14}}>
            <div style={{width:40, height:40, borderRadius:12, background:'var(--canvas-2)', color:'var(--umi-navy)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
              <I.Tablet size={18}/>
            </div>
            <div style={{flex:1}}>
              <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
                <span className={'s-dot ' + device.status}/>
                <span style={{fontSize:13, fontWeight:600, color:'var(--ink-1)'}}>{statusLabel}</span>
              </div>
              <div style={{fontSize:12, color:'var(--ink-3)'}}>Visto {device.last}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div className="eyebrow" style={{fontSize:9, marginBottom:3}}>ÓRDENES ABIERTAS</div>
              <div style={{fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, lineHeight:1, color: device.status === 'offline' ? 'var(--ink-4)' : 'var(--ink-1)'}}>{device.open}</div>
            </div>
          </div>

          <div className="field">
            <label>Nombre del dispositivo</label>
            <input
              className="input tall"
              placeholder="e.g. Cocina Caliente 1"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Estación asignada</label>
            <select className="select" style={{height:52, borderRadius:14}} value={station} onChange={e => setStation(e.target.value)}>
              <option value="">Sin asignar</option>
              {(stations || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Session ID</label>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span className="pin-box" style={{flex:1, fontFamily:'var(--font-mono)', fontSize:10.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                {reveal ? device.id : '••••••••-••••-••••-••••-••••••••••••'}
              </span>
              <button className="pin-reveal focusable" onClick={() => setReveal(r => !r)} aria-label={reveal ? 'Ocultar' : 'Mostrar'}>
                {reveal ? <I.EyeOff size={15}/> : <I.Eye size={15}/>}
              </button>
            </div>
          </div>

          {error && (
            <div style={{fontSize:12.5, color:'var(--danger)', background:'var(--danger-soft)', borderRadius:10, padding:'9px 12px'}}>
              {error}
            </div>
          )}

          <div style={{borderTop:'1px solid var(--line-soft)', paddingTop:16, marginTop:4}}>
            <button
              className="btn btn-ghost btn-sm focusable"
              style={{color:'var(--danger)'}}
              disabled={removing}
              onClick={() => setConfirmingRevoke(true)}
            >
              <I.Trash size={14}/> {removing ? 'Revocando…' : 'Revocar dispositivo'}
            </button>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn-primary focusable"
            disabled={!name.trim() || saving}
            style={{opacity: name.trim() && !saving ? 1 : 0.5}}
            onClick={save}
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </aside>
      {confirmingRevoke && (
        <>
          <div className="sheet-backdrop" onClick={() => !removing && setConfirmingRevoke(false)}/>
          <aside className="sheet" style={{maxWidth:420}}>
            <div className="sheet-head">
              <div>
                <div className="eyebrow">KDS · Acceso</div>
                <h2 className="h-section" style={{marginTop:4}}>Revocar dispositivo</h2>
              </div>
              <button className="btn-icon" disabled={removing} onClick={() => setConfirmingRevoke(false)} aria-label="Cerrar"><I.X size={16}/></button>
            </div>
            <div className="sheet-body">
              <p style={{margin:0, color:'var(--ink-2)', fontSize:14.5, lineHeight:1.5}}>
                Este iPad se cerrará y tendrá que parearse de nuevo con un PIN.
              </p>
              {error && (
                <div style={{fontSize:12.5, color:'var(--danger)', background:'var(--danger-soft)', borderRadius:10, padding:'9px 12px'}}>
                  {error}
                </div>
              )}
            </div>
            <div className="sheet-foot">
              <button className="btn btn-ghost" disabled={removing} onClick={() => setConfirmingRevoke(false)}>Cancelar</button>
              <button className="btn btn-primary focusable" disabled={removing} onClick={remove}>
                {removing ? 'Revocando…' : 'Revocar'}
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
};

const StationPanel = ({ onClose, devices }) => {
  const [stations, setStations] = useState(STATIONS.map(function(s) { return { id: s, name: s }; }));
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}/>
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Devices · KDS</div>
            <h2 className="h-section" style={{marginTop:4}}>Stations</h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><I.X size={16}/></button>
        </div>
        <div className="sheet-body">
          <p style={{color:'var(--ink-2)', margin:0, fontSize:13.5}}>
            Tickets are routed to stations based on the menu category. Each station can be assigned to one or more iPads.
          </p>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {stations.map(function(s, i) {
              var count = devices.filter(function(d) { return d.station === s.id; }).length;
              return (
                <div key={s.id} className="list-card" style={{padding:14, alignItems:'center'}}>
                  <div style={{paddingLeft:14, flex:1, display:'flex', alignItems:'center', gap:12}}>
                    <div style={{width:34, height:34, borderRadius:10, background:'var(--canvas-2)', color:'var(--umi-navy)', display:'flex', alignItems:'center', justifyContent:'center'}}>
                      <I.Layout size={16}/>
                    </div>
                    <div style={{flex:1}}>
                      <input
                        className="input"
                        style={{height:36, border:'1px solid transparent', background:'transparent', padding:'0 8px', fontWeight:600, fontSize:14}}
                        value={s.name}
                        onChange={function(e) {
                          setStations(function(prev) {
                            return prev.map(function(p, j) { return j === i ? Object.assign({}, p, { name: e.target.value }) : p; });
                          });
                        }}
                      />
                      <div style={{fontSize:11.5, color:'var(--ink-3)', paddingLeft:8, marginTop:-2}}>
                        {count} device{count !== 1 ? 's' : ''} assigned
                      </div>
                    </div>
                    <button className="btn-icon" aria-label="Delete station"><I.Trash size={15}/></button>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="btn btn-secondary focusable" onClick={function() {
            setStations(function(prev) { return [...prev, { id: 'NEW-' + (prev.length+1), name: 'New station' }]; });
          }}>
            <I.Plus size={16}/> Add station
          </button>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onClose}>Save changes</button>
        </div>
      </aside>
    </>
  );
};

const AddDevicePanel = ({ onClose, stations, pairings, onProvisioned }) => {
  const [name,    setName]    = useState('');
  const [station, setStation] = useState('');
  const [pairing, setPairing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  React.useEffect(function() {
    if (!station && stations && stations[0]) setStation(stations[0].id);
  }, [stations, station]);

  async function createDevice() {
    setSaving(true);
    setError(null);
    try {
      const result = await generateDevicePairingPin({ device_name: name, station_id: station });
      setPairing(result.pairing);
      onProvisioned && onProvisioned();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const selectedStation = (stations || []).find(function(s) { return s.id === station; });
  const activePairings = (pairings || []).filter(function(p) { return p.status === 'pending' || p.status === 'approved'; });

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}/>
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">KDS</div>
            <h2 className="h-section" style={{marginTop:4}}>Pair a new iPad</h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><I.X size={16}/></button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label>Device name</label>
            <input className="input tall" placeholder="e.g. Cocina Caliente 2" value={name} onChange={function(e) { setName(e.target.value); }}/>
          </div>
          <div className="field">
            <label>Assign to station</label>
            <select className="select" style={{height:52, borderRadius:14}} value={station} onChange={function(e) { setStation(e.target.value); }}>
              {(stations || []).map(function(s) { return <option key={s.id} value={s.id}>{s.name}</option>; })}
            </select>
          </div>
          {error && (
            <div style={{fontSize:12.5, color:'var(--danger)', background:'var(--danger-soft)', borderRadius:10, padding:'10px 12px'}}>
              {error}
            </div>
          )}
          {pairing && (
          <div className="field">
            <label>PIN de primer pareo</label>
            <div className="card-warm" style={{padding:'20px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:18}}>
              <div>
                <div className="display" style={{fontSize:42, fontFamily:'var(--font-mono)', letterSpacing:'0.12em', color:'var(--ink-warm)', lineHeight:1}}>
                  {pairing.pin.slice(0, 3)} {pairing.pin.slice(3)}
                </div>
                <div style={{marginTop:8, fontSize:12.5, color:'var(--ink-warm-soft)'}}>
                  Esperando solicitud del iPad
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div className="eyebrow on-warm" style={{marginBottom:4}}>station</div>
                <div style={{fontWeight:600, color:'var(--ink-warm)'}}>{selectedStation?.name || pairing.station_id}</div>
                <div style={{marginTop:6, fontSize:11.5, color:'var(--ink-warm-soft)'}}>
                  Expira {new Date(pairing.expires_at).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })}
                </div>
              </div>
            </div>
            <p style={{margin:0, fontSize:13, color:'var(--ink-3)'}}>
              Enter this PIN on the KDS iPad. When it appears in pending requests, approve it from this screen.
            </p>
          </div>
          )}
          {activePairings.length > 0 && (
            <div className="field">
              <label>Solicitudes activas</label>
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {activePairings.map(function(p) {
                  return (
                    <div key={p.id} className="list-card" style={{padding:12}}>
                      <div style={{paddingLeft:12, flex:1, minWidth:0}}>
                        <div style={{fontWeight:600, fontSize:13.5}}>{p.device_name}</div>
                        <div style={{fontSize:12, color:'var(--ink-3)', marginTop:2}}>
                          {p.requested_name || 'Esperando iPad'} <XSep/> {p.status}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!name.trim() || !station || saving || pairing}
            style={{opacity: name.trim() && station && !saving && !pairing ? 1 : 0.5}}
            onClick={createDevice}
          >
            <I.Refresh size={15}/> {saving ? 'Generando…' : pairing ? 'PIN generado' : 'Generar PIN'}
          </button>
        </div>
      </aside>
    </>
  );
};

export default DevicesScreen

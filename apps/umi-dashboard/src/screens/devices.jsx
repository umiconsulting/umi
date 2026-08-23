import React, { useState, useEffect, useId } from 'react';
import { I } from '@/icons.jsx';
import { RegionHead, XSep } from '@/shell.jsx';
import {
  approvePosEnrollmentRequest,
  approveDevicePairing,
  createPosEnrollmentRequest,
  createKdsStation,
  deleteKdsStation,
  denyDevicePairing,
  denyPosEnrollmentRequest,
  generateDevicePairingPin,
  getPosEnrollmentRequests,
  revokeDevice,
  updateDevice,
  updateKdsStation,
  useDevicePairings,
  useDevicesData,
  useKdsStations,
} from '@/data.jsx';

// Screen 3 — Devices (KDS)
// Data: useDevicesData() → kds.device_sessions from Supabase
// Status derived from local heartbeat: <10s=live, <20s=slow, else=offline.

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
  const [refresh, setRefresh] = useState(0);
  const [stationOpen, setStationOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [posAddOpen, setPosAddOpen] = useState(false);
  const [editDevice, setEditDevice] = useState(null);
  const [countdown, setCountdown] = useState(POLL_INTERVAL);
  const [currentTime, setCurrentTime] = useState(0);
  const [posRequests, setPosRequests] = useState([]);
  const [posRequestError, setPosRequestError] = useState(null);

  // Auto-poll local heartbeat data so offline/online transitions are picked up.
  useEffect(function () {
    setCountdown(POLL_INTERVAL);
    const pollId = setInterval(function () {
      setRefresh(function (r) {
        return r + 1;
      });
      setCountdown(POLL_INTERVAL);
    }, POLL_INTERVAL * 1000);
    const tickId = setInterval(function () {
      setCurrentTime(Date.now());
      setCountdown(function (c) {
        return c <= 1 ? POLL_INTERVAL : c - 1;
      });
    }, 1000);
    return function () {
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, []);

  const { data: rawDevices, loading } = useDevicesData(refresh);
  const { data: stations } = useKdsStations(refresh);
  const { data: pairings } = useDevicePairings(refresh);
  useEffect(
    function () {
      let active = true;
      getPosEnrollmentRequests()
        .then(function (result) {
          if (active) {
            setPosRequests(result.requests || []);
            setPosRequestError(null);
          }
        })
        .catch(function (error) {
          if (active) setPosRequestError(error.message);
        });
      return function () {
        active = false;
      };
    },
    [refresh],
  );
  const devices = (rawDevices || []).map(function (d) {
    // Heartbeat (local, 5-s cadence) is the authoritative connection signal.
    // last_used_at (cloud) only updates on order bumps — not a heartbeat.
    const hbStatus = d._heartbeatStatus || null;
    const hbSeenMs = d._heartbeatSeenMs || null;
    const connectionStatus = hbStatus || deriveStatus(d.last_used_at);
    return {
      id: d.device_id,
      name: d.device_name,
      station: d.station_name || d.station_id,
      stationId: d.station_id,
      status: connectionStatus,
      hasHeartbeat: !!hbStatus,
      open: d.open || 0,
      last: hbSeenMs ? fmtLastSeen(new Date(hbSeenMs).toISOString()) : fmtLastSeen(d.last_used_at),
      pin: d.pin || '• • • • • •',
      model: d.model || 'iPad',
      ip: d.ip || '—',
      _raw: d,
    };
  });

  const liveCount = devices.filter(function (d) {
    return d.status === 'live';
  }).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title="Dispositivos pareados"
        note={loading ? 'Actualizando…' : `${liveCount} en vivo ahora mismo.`}
        count={{ value: devices.length, label: 'dispositivos' }}
        actions={
          <>
            <button
              className="btn btn-ghost btn-sm focusable"
              onClick={() => {
                setRefresh((r) => r + 1);
                setCountdown(POLL_INTERVAL);
              }}
            >
              <I.Refresh size={14} /> Actualizar
            </button>
            <button className="btn btn-secondary focusable" onClick={() => setStationOpen(true)}>
              <I.Layout size={16} /> Estaciones
            </button>
            <button className="btn btn-primary focusable" onClick={() => setAddOpen(true)}>
              <I.Plus size={16} /> Añadir dispositivo
            </button>
            <button className="btn btn-primary focusable" onClick={() => setPosAddOpen(true)}>
              <I.Tablet size={16} /> Registrar UmiPOS
            </button>
          </>
        }
      />

      {/* Devices grid */}
      <div className="grid grid-2" style={{ gap: 12 }}>
        {devices.map(function (d) {
          return (
            <div
              key={d.id}
              className={'list-card ' + d.status}
              style={{
                padding: 0,
                paddingRight: 16,
                cursor: 'pointer',
                transition: 'box-shadow 0.15s',
              }}
              onClick={() => setEditDevice(d)}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-pop)')}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = '')}
            >
              <div className="l-strip" />
              <div
                style={{
                  paddingTop: 14,
                  paddingBottom: 14,
                  flex: 1,
                  display: 'flex',
                  gap: 14,
                  alignItems: 'center',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: 'var(--canvas-2)',
                    color: 'var(--umi-navy)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <I.Tablet size={18} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 3,
                      flexWrap: 'nowrap',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: 'var(--ink-1)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {d.name}
                    </span>
                    <span
                      className="chip"
                      style={{
                        fontSize: 10,
                        height: 20,
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        flexShrink: 0,
                      }}
                    >
                      {d.station || 'SIN ASIGNAR'}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--ink-3)',
                      flexWrap: 'nowrap',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      <span className={'s-dot ' + d.status} />
                      {loading && d.status !== 'live' ? (
                        <span style={{ color: 'var(--warning)', fontStyle: 'italic' }}>
                          Reconectando…
                        </span>
                      ) : d.status === 'live' ? (
                        'Live'
                      ) : d.status === 'slow' ? (
                        'Slow'
                      ) : (
                        'Offline'
                      )}
                    </span>
                    <span style={{ color: 'var(--ink-3)' }} aria-hidden="true">
                      ·
                    </span>
                    <span style={{ whiteSpace: 'nowrap' }}>Visto {d.last}</span>
                    {d.status === 'offline' && !loading && (
                      <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>· en {countdown}s</span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div className="eyebrow" style={{ fontSize: 9, marginBottom: 2 }}>
                    ÓRDENES
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 22,
                      fontWeight: 600,
                      lineHeight: 1,
                      color: d.status === 'offline' ? 'var(--ink-4)' : 'var(--ink-1)',
                    }}
                  >
                    {d.open}
                  </div>
                </div>

                <button
                  className="btn-icon focusable"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditDevice(d);
                  }}
                  aria-label="Editar dispositivo"
                >
                  <I.Edit size={15} />
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
          currentTime={currentTime}
          onChanged={() => setRefresh((r) => r + 1)}
        />
      )}

      <PosEnrollmentRequestsCard
        requests={posRequests}
        error={posRequestError}
        currentTime={currentTime}
        onChanged={() => setRefresh((r) => r + 1)}
      />

      {/* Connection legend */}
      <div
        className="card"
        style={{
          padding: '18px 22px',
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div className="eyebrow">Estados</div>
        <span className="legend">
          <span className="s-dot live" /> En vivo · responde en menos de 10 s
        </span>
        <span className="legend">
          <span className="s-dot slow" /> Lento · responde entre 10 y 20 s
        </span>
        <span className="legend">
          <span className="s-dot offline" /> Sin conexión · sin señal por más de 20 s
        </span>
      </div>

      {stationOpen && (
        <StationPanel
          onClose={() => setStationOpen(false)}
          devices={devices}
          stations={stations || []}
          onChanged={() => setRefresh((r) => r + 1)}
        />
      )}
      {addOpen && (
        <AddDevicePanel
          onClose={() => setAddOpen(false)}
          stations={stations || []}
          pairings={pairings || []}
          onProvisioned={() => setRefresh((r) => r + 1)}
        />
      )}
      {posAddOpen && (
        <AddPosDevicePanel
          onClose={() => setPosAddOpen(false)}
          onCreated={() => setRefresh((r) => r + 1)}
        />
      )}
      {editDevice && (
        <EditDevicePanel
          device={editDevice}
          stations={stations || []}
          onClose={() => setEditDevice(null)}
          onSaved={() => {
            setEditDevice(null);
            setRefresh((r) => r + 1);
          }}
        />
      )}
    </div>
  );
};

const PAIRING_ERROR_MESSAGES = {
  pairing_not_pending: 'Esta solicitud ya expiró o fue atendida. Actualiza la lista.',
  invalid_pairing_id: 'Solicitud inválida.',
};

// Show operators friendly copy; the raw error (code, status, path) goes to the
// console for debugging.
function pairingErrorMessage(err) {
  return (
    PAIRING_ERROR_MESSAGES[err && err.code] || 'No se pudo completar la acción. Intenta de nuevo.'
  );
}

const PairingRequestsCard = ({ pairings, stations, currentTime, onChanged }) => {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const stationById = Object.fromEntries(
    (stations || []).map(function (s) {
      return [s.id, s];
    }),
  );

  async function approve(id) {
    setBusy(id + ':approve');
    setError(null);
    try {
      await approveDevicePairing(id);
    } catch (err) {
      console.error('[kds] approve pairing failed', err);
      setError(pairingErrorMessage(err));
    } finally {
      setBusy(null);
      onChanged && onChanged();
    }
  }

  async function deny(id) {
    setBusy(id + ':deny');
    setError(null);
    try {
      await denyDevicePairing(id);
    } catch (err) {
      console.error('[kds] deny pairing failed', err);
      setError(pairingErrorMessage(err));
    } finally {
      setBusy(null);
      onChanged && onChanged();
    }
  }

  return (
    <div
      className="card"
      style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
      >
        <div>
          <div className="eyebrow">Primer pareo</div>
          <h2 className="h-section" style={{ marginTop: 4 }}>
            Solicitudes KDS pendientes
          </h2>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onChanged}>
          <I.Refresh size={14} /> Actualizar
        </button>
      </div>
      {error && (
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--danger)',
            background: 'var(--danger-soft)',
            borderRadius: 10,
            padding: '9px 12px',
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pairings.map(function (p) {
          const station = stationById[p.station_id];
          const requested = p.requested_name || 'Esperando iPad';
          const pendingApproval = p.status === 'pending' && p.requested_name;
          const expired =
            p.status === 'pending' &&
            p.expires_at &&
            new Date(p.expires_at).getTime() < currentTime;
          return (
            <div key={p.id} className="list-card" style={{ padding: 14, alignItems: 'center' }}>
              <div style={{ paddingLeft: 14, flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                  <b style={{ fontSize: 14 }}>{p.device_name}</b>
                  <span
                    className="chip"
                    style={{ height: 22, fontSize: 10.5, letterSpacing: '0.08em' }}
                  >
                    {station?.name || p.station_id}
                  </span>
                  <span
                    className="chip"
                    style={{
                      height: 22,
                      fontSize: 10.5,
                      color:
                        p.status === 'approved'
                          ? 'var(--success)'
                          : expired
                            ? 'var(--danger)'
                            : 'var(--warning)',
                      background:
                        p.status === 'approved'
                          ? 'var(--success-soft)'
                          : expired
                            ? 'var(--danger-soft)'
                            : 'var(--warning-soft)',
                    }}
                  >
                    {p.status === 'approved'
                      ? 'Aprobado'
                      : expired
                        ? 'Expirada'
                        : pendingApproval
                          ? 'Confirmar'
                          : 'Esperando'}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  iPad · {requested} <XSep /> expira{' '}
                  {new Date(p.expires_at).toLocaleTimeString('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              {p.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy === p.id + ':deny'}
                    onClick={() => deny(p.id)}
                  >
                    <I.X size={14} /> Rechazar
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!p.requested_name || expired || busy === p.id + ':approve'}
                    style={{ opacity: p.requested_name && !expired ? 1 : 0.5 }}
                    onClick={() => approve(p.id)}
                  >
                    <I.Check size={14} /> Aprobar
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
  const uid = useId();
  const [name, setName] = useState(device.name);
  const [station, setStation] = useState(device.stationId || '');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [error, setError] = useState(null);

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

  const statusLabel =
    device.status === 'live' ? 'En vivo' : device.status === 'slow' ? 'Lento' : 'Sin conexión';

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">KDS · Dispositivo</div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              Gestionar dispositivo
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Cerrar">
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          {/* Status summary */}
          <div
            className="card"
            style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'var(--canvas-2)',
                color: 'var(--umi-navy)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <I.Tablet size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span className={'s-dot ' + device.status} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
                  {statusLabel}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Visto {device.last}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow" style={{ fontSize: 9, marginBottom: 3 }}>
                ÓRDENES ABIERTAS
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 26,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: device.status === 'offline' ? 'var(--ink-4)' : 'var(--ink-1)',
                }}
              >
                {device.open}
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor={`${uid}-nombre-del-dispositivo`}>Nombre del dispositivo</label>
            <input
              id={`${uid}-nombre-del-dispositivo`}
              className="input tall"
              placeholder="e.g. Cocina Caliente 1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor={`${uid}-estacion-asignada`}>Estación asignada</label>
            <select
              id={`${uid}-estacion-asignada`}
              className="select"
              style={{ height: 52, borderRadius: 14 }}
              value={station}
              onChange={(e) => setStation(e.target.value)}
            >
              <option value="">Sin asignar</option>
              {(stations || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="field-label">ID de sesión</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                className="pin-box"
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {reveal ? device.id : '••••••••-••••-••••-••••-••••••••••••'}
              </span>
              <button
                className="pin-reveal focusable"
                onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? 'Ocultar' : 'Mostrar'}
              >
                {reveal ? <I.EyeOff size={15} /> : <I.Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--danger)',
                background: 'var(--danger-soft)',
                borderRadius: 10,
                padding: '9px 12px',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 16, marginTop: 4 }}>
            <button
              className="btn btn-ghost btn-sm focusable"
              style={{ color: 'var(--danger)' }}
              disabled={removing}
              onClick={() => setConfirmingRevoke(true)}
            >
              <I.Trash size={14} /> {removing ? 'Revocando…' : 'Revocar dispositivo'}
            </button>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary focusable"
            disabled={!name.trim() || saving}
            style={{ opacity: name.trim() && !saving ? 1 : 0.5 }}
            onClick={save}
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </aside>
      {confirmingRevoke && (
        <>
          <div className="sheet-backdrop" onClick={() => !removing && setConfirmingRevoke(false)} />
          <aside className="sheet" style={{ maxWidth: 420 }}>
            <div className="sheet-head">
              <div>
                <div className="eyebrow">KDS · Acceso</div>
                <h2 className="h-section" style={{ marginTop: 4 }}>
                  Revocar dispositivo
                </h2>
              </div>
              <button
                className="btn-icon"
                disabled={removing}
                onClick={() => setConfirmingRevoke(false)}
                aria-label="Cerrar"
              >
                <I.X size={16} />
              </button>
            </div>
            <div className="sheet-body">
              <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.5 }}>
                Este iPad se cerrará y tendrá que parearse de nuevo con un PIN.
              </p>
              {error && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--danger)',
                    background: 'var(--danger-soft)',
                    borderRadius: 10,
                    padding: '9px 12px',
                  }}
                >
                  {error}
                </div>
              )}
            </div>
            <div className="sheet-foot">
              <button
                className="btn btn-ghost"
                disabled={removing}
                onClick={() => setConfirmingRevoke(false)}
              >
                Cancelar
              </button>
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

// Shared create-station flow (name state + busy + guarded create/reset) used by
// both the Estaciones panel and the add-device empty state. `onCreated` receives
// the created station so callers can react (refresh, auto-select).
function useCreateStation(onCreated) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(onError) {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    onError && onError(null);
    try {
      const res = await createKdsStation({ name: trimmed });
      setName('');
      onCreated && onCreated(res && res.station);
    } catch (err) {
      onError && onError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return { name, setName, busy, create };
}

const StationRow = ({ station, count, onChanged, onError }) => {
  const [name, setName] = useState(station.name);
  const [busy, setBusy] = useState(false);

  useEffect(
    function () {
      setName(station.name);
    },
    [station.name],
  );

  const trimmed = name.trim();
  const dirty = trimmed && trimmed !== station.name;

  async function rename() {
    if (!dirty || busy) {
      if (!trimmed) setName(station.name); // cleared field ⇒ revert, don't persist blank
      return;
    }
    setBusy(true);
    onError && onError(null);
    try {
      await updateKdsStation(station.id, { name: trimmed });
      onChanged && onChanged();
    } catch (err) {
      setName(station.name);
      onError && onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    if (
      !window.confirm(
        `¿Archivar la estación "${station.name}"? Dejará de aparecer al asignar dispositivos.`,
      )
    )
      return;
    setBusy(true);
    onError && onError(null);
    try {
      await deleteKdsStation(station.id);
      onChanged && onChanged();
    } catch (err) {
      onError && onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="list-card" style={{ padding: 14, alignItems: 'center' }}>
      <div style={{ paddingLeft: 14, flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'var(--canvas-2)',
            color: 'var(--umi-navy)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <I.Layout size={16} />
        </div>
        <div style={{ flex: 1 }}>
          <input
            className="input"
            style={{
              height: 36,
              border: '1px solid transparent',
              background: 'transparent',
              padding: '0 8px',
              fontWeight: 600,
              fontSize: 14,
            }}
            value={name}
            disabled={busy}
            onChange={function (e) {
              setName(e.target.value);
            }}
            onBlur={rename}
            onKeyDown={function (e) {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', paddingLeft: 8, marginTop: -2 }}>
            {count} device{count !== 1 ? 's' : ''} assigned{dirty ? ' · sin guardar' : ''}
          </div>
        </div>
        <button
          className="btn-icon"
          aria-label="Archivar estación"
          onClick={remove}
          disabled={busy}
        >
          <I.Trash size={15} />
        </button>
      </div>
    </div>
  );
};

const StationPanel = ({ onClose, devices, stations, onChanged }) => {
  const uid = useId();
  const [error, setError] = useState(null);
  const list = stations || [];
  const {
    name: newName,
    setName: setNewName,
    busy: saving,
    create,
  } = useCreateStation(function () {
    onChanged && onChanged();
  });
  function addStation() {
    return create(setError);
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Devices · KDS</div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              Estaciones
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <p style={{ color: 'var(--ink-2)', margin: 0, fontSize: 13.5 }}>
            Los tickets se enrutan a estaciones según la categoría del menú. Cada estación puede
            asignarse a uno o más iPads.
          </p>
          {list.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              Aún no hay estaciones. Crea la primera abajo.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(function (s) {
              var count = (devices || []).filter(function (d) {
                return d.stationId === s.id;
              }).length;
              return (
                <StationRow
                  key={s.id}
                  station={s}
                  count={count}
                  onChanged={onChanged}
                  onError={setError}
                />
              );
            })}
          </div>
          {error && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--danger)',
                background: 'var(--danger-soft)',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor={`${uid}-nueva-estacion`}>Nueva estación</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id={`${uid}-nueva-estacion`}
                className="input"
                placeholder="e.g. Cocina Caliente"
                value={newName}
                onChange={function (e) {
                  setNewName(e.target.value);
                }}
                onKeyDown={function (e) {
                  if (e.key === 'Enter') addStation();
                }}
              />
              <button
                className="btn btn-primary focusable"
                onClick={addStation}
                disabled={saving || !newName.trim()}
                style={{ whiteSpace: 'nowrap' }}
              >
                <I.Plus size={16} /> {saving ? 'Creando…' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </aside>
    </>
  );
};

const AddDevicePanel = ({ onClose, stations, pairings, onProvisioned }) => {
  const uid = useId();
  const [name, setName] = useState('');
  const [station, setStation] = useState('');
  const [pairing, setPairing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const hasStations = (stations || []).length > 0;
  const {
    name: newStationName,
    setName: setNewStationName,
    busy: creatingStation,
    create: createStationInline,
  } = useCreateStation(function (createdStation) {
    if (createdStation && createdStation.id) setStation(createdStation.id);
    onProvisioned && onProvisioned();
  });

  React.useEffect(
    function () {
      if (!station && stations && stations[0]) setStation(stations[0].id);
    },
    [stations, station],
  );

  function addStation() {
    return createStationInline(setError);
  }

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

  const selectedStation = (stations || []).find(function (s) {
    return s.id === station;
  });
  const activePairings = (pairings || []).filter(function (p) {
    return p.status === 'pending' || p.status === 'approved';
  });

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">KDS</div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              Vincular un iPad nuevo
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor={`${uid}-device-name`}>Nombre del dispositivo</label>
            <input
              id={`${uid}-device-name`}
              className="input tall"
              placeholder="e.g. Cocina Caliente 2"
              value={name}
              onChange={function (e) {
                setName(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-assign-to-station`}>Estación asignada</label>
            {hasStations ? (
              <select
                id={`${uid}-assign-to-station`}
                className="select"
                style={{ height: 52, borderRadius: 14 }}
                value={station}
                onChange={function (e) {
                  setStation(e.target.value);
                }}
              >
                {(stations || []).map(function (s) {
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  );
                })}
              </select>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 8 }}>
                  No hay estaciones todavía. Crea una para asignar este dispositivo.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    placeholder="Nombre de la estación"
                    value={newStationName}
                    onChange={function (e) {
                      setNewStationName(e.target.value);
                    }}
                    onKeyDown={function (e) {
                      if (e.key === 'Enter') addStation();
                    }}
                  />
                  <button
                    className="btn btn-secondary focusable"
                    onClick={addStation}
                    disabled={creatingStation || !newStationName.trim()}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <I.Plus size={16} /> {creatingStation ? 'Creando…' : 'Crear estación'}
                  </button>
                </div>
              </>
            )}
          </div>
          {error && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--danger)',
                background: 'var(--danger-soft)',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              {error}
            </div>
          )}
          {pairing && (
            <div className="field">
              <span className="field-label">PIN de primer pareo</span>
              <div
                className="card-warm"
                style={{
                  padding: '20px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 18,
                }}
              >
                <div>
                  <div
                    className="display"
                    style={{
                      fontSize: 42,
                      fontFamily: 'var(--font-mono)',
                      letterSpacing: '0.12em',
                      color: 'var(--ink-warm)',
                      lineHeight: 1,
                    }}
                  >
                    {pairing.pin.slice(0, 3)} {pairing.pin.slice(3)}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink-warm-soft)' }}>
                    Esperando solicitud del iPad
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="eyebrow on-warm" style={{ marginBottom: 4 }}>
                    station
                  </div>
                  <div style={{ fontWeight: 600, color: 'var(--ink-warm)' }}>
                    {selectedStation?.name || pairing.station_id}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-warm-soft)' }}>
                    Expira{' '}
                    {new Date(pairing.expires_at).toLocaleTimeString('es-MX', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
                Enter this PIN on the KDS iPad. When it appears in pending requests, approve it from
                this screen.
              </p>
            </div>
          )}
          {activePairings.length > 0 && (
            <div className="field">
              <span className="field-label">Solicitudes activas</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activePairings.map(function (p) {
                  return (
                    <div key={p.id} className="list-card" style={{ padding: 12 }}>
                      <div style={{ paddingLeft: 12, flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.device_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                          {p.requested_name || 'Esperando iPad'} <XSep /> {p.status}
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
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim() || !station || saving || pairing}
            style={{ opacity: name.trim() && station && !saving && !pairing ? 1 : 0.5 }}
            onClick={createDevice}
          >
            <I.Refresh size={15} />{' '}
            {saving ? 'Generando…' : pairing ? 'PIN generado' : 'Generar PIN'}
          </button>
        </div>
      </aside>
    </>
  );
};

const POS_STATE_LABELS = {
  created: 'Código creado',
  awaiting_approval: 'Requiere aprobación',
  credential_ready: 'Aprobado',
  credential_delivered: 'Credencial entregada',
  completed: 'Completado',
  denied: 'Denegado',
  expired: 'Expirado',
  cancelled: 'Cancelado',
};

const PosEnrollmentRequestsCard = ({ requests, error, currentTime, onChanged }) => {
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const visible = (requests || []).filter(function (request) {
    return (
      request.state !== 'completed' || currentTime - new Date(request.createdAt).getTime() < 3600000
    );
  });

  async function decide(request, approved) {
    setBusy(request.id);
    setActionError(null);
    try {
      if (approved) await approvePosEnrollmentRequest(request.id);
      else await denyPosEnrollmentRequest(request.id);
    } catch (failure) {
      console.error('[umipos] enrollment decision failed', failure);
      setActionError('No se pudo guardar la decisión. Actualiza y vuelve a intentarlo.');
    } finally {
      setBusy(null);
      onChanged && onChanged();
    }
  }

  return (
    <section className="card fade-up d3" style={{ padding: '18px 22px' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
      >
        <div>
          <div className="eyebrow">UmiPOS</div>
          <h2 className="h-section" style={{ marginTop: 4 }}>
            Solicitudes de registro
          </h2>
        </div>
        <button className="btn btn-ghost btn-sm focusable" onClick={onChanged}>
          <I.Refresh size={14} /> Actualizar
        </button>
      </div>
      {(error || actionError) && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            color: 'var(--danger)',
            background: 'var(--danger-soft)',
            borderRadius: 10,
            padding: '9px 12px',
          }}
        >
          {actionError || error}
        </div>
      )}
      {visible.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', marginBottom: 0 }}>No hay solicitudes de UmiPOS.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {visible.map(function (request) {
            const pending = request.state === 'awaiting_approval';
            return (
              <div key={request.id} className="list-card" style={{ padding: 14 }}>
                <div style={{ paddingLeft: 14, flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>{request.displayName}</b>
                    <span className="chip">{POS_STATE_LABELS[request.state] || request.state}</span>
                  </div>
                  <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 4 }}>
                    {request.type} · {request.requestedPlatform || request.platform}
                    {request.installationReference
                      ? ` · Instalación ${request.installationReference}`
                      : ''}
                  </div>
                </div>
                {pending && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-ghost btn-sm focusable"
                      disabled={busy === request.id}
                      onClick={() => decide(request, false)}
                    >
                      Denegar
                    </button>
                    <button
                      className="btn btn-primary btn-sm focusable"
                      disabled={busy === request.id}
                      onClick={() => decide(request, true)}
                    >
                      Aprobar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

const AddPosDevicePanel = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('web');
  const [deviceType, setDeviceType] = useState('pos_terminal');
  const [created, setCreated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const branchId = window.localStorage.getItem('umi-dashboard-selected-location');

  async function createRequest() {
    setSaving(true);
    setError(null);
    try {
      const result = await createPosEnrollmentRequest({
        branchId: branchId || null,
        displayName: name.trim(),
        type: deviceType,
        platform,
        idempotencyKey: crypto.randomUUID(),
      });
      setCreated(result);
      onCreated && onCreated();
    } catch (failure) {
      console.error('[umipos] enrollment request failed', failure);
      setError('No se pudo crear el código. Verifica la sucursal y vuelve a intentarlo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet" aria-labelledby="pos-enrollment-title">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">UmiPOS</div>
            <h2 id="pos-enrollment-title" className="h-section" style={{ marginTop: 4 }}>
              Registrar dispositivo
            </h2>
          </div>
          <button className="btn-icon focusable" onClick={onClose} aria-label="Cerrar">
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          {!created ? (
            <>
              <div className="field">
                <label htmlFor="pos-device-name">Nombre del dispositivo</label>
                <input
                  id="pos-device-name"
                  className="input tall"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Caja principal"
                />
              </div>
              <div className="field">
                <label htmlFor="pos-device-type">Tipo</label>
                <select
                  id="pos-device-type"
                  className="select"
                  value={deviceType}
                  onChange={(event) => setDeviceType(event.target.value)}
                >
                  <option value="pos_terminal">Terminal UmiPOS</option>
                  <option value="kds">Pantalla KDS</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pos-device-platform">Plataforma</label>
                <select
                  id="pos-device-platform"
                  className="select"
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value)}
                >
                  <option value="web">Web</option>
                  <option value="linux">Linux</option>
                  <option value="macos">macOS</option>
                  <option value="windows">Windows</option>
                  <option value="android">Android</option>
                  <option value="ios">iOS</option>
                </select>
              </div>
              <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                La solicitud queda vinculada al negocio y a la sucursal seleccionada.
              </p>
            </>
          ) : (
            <div className="card-warm" style={{ padding: 24, textAlign: 'center' }}>
              <div className="eyebrow on-warm">Código de configuración</div>
              <div
                aria-label={`Código ${created.setupCode}`}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 38,
                  letterSpacing: '0.12em',
                  marginTop: 12,
                  color: 'var(--ink-warm)',
                }}
              >
                {created.setupCode.slice(0, 4)} {created.setupCode.slice(4)}
              </div>
              <p style={{ color: 'var(--ink-warm-soft)', marginBottom: 0 }}>
                Escribe este código en UmiPOS. Después, aprueba la solicitud en esta pantalla.
              </p>
              <p style={{ color: 'var(--ink-warm-soft)', fontSize: 12 }}>
                Expira a las {new Date(created.expiresAt).toLocaleTimeString('es-MX')}.
              </p>
            </div>
          )}
          {error && (
            <div role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost focusable" onClick={onClose}>
            Cerrar
          </button>
          {!created && (
            <button
              className="btn btn-primary focusable"
              disabled={!name.trim() || saving}
              onClick={createRequest}
            >
              {saving ? 'Creando…' : 'Crear código'}
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

export default DevicesScreen;

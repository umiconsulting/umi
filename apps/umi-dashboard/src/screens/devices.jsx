import { useState, useEffect, useId } from 'react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatTime } from '@/lib/format.js';
import { RegionHead, XSep } from '@/shell.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { REALTIME_STATE, useDevicesRealtime } from '@/lib/device-realtime.js';
import {
  locationName,
  mobilityLabel,
  platformLabel,
  posDeviceCard,
  visiblePosEnrollmentRequests,
} from './device-utils.js';
import {
  approvePosEnrollmentRequest,
  approveDevicePairing,
  createPosEnrollmentRequest,
  createKdsStation,
  deleteKdsStation,
  denyDevicePairing,
  denyPosEnrollmentRequest,
  generateDevicePairingPin,
  getPosDevices,
  getPosEnrollmentRequests,
  revokeDevice,
  revokePosDevice,
  updatePosDevice,
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
function fmtLastSeen(t, lastUsedAt) {
  if (!lastUsedAt) return t`nunca`;
  var ms = Date.now() - new Date(lastUsedAt).getTime();
  if (ms < 10000) return t`hace un momento`;
  if (ms < 60000) return t`hace ${Math.floor(ms / 1000)} s`;
  if (ms < 3600000) return t`hace ${Math.floor(ms / 60000)} min`;
  return t`hace ${Math.floor(ms / 3600000)} h`;
}

function deriveStatus(lastUsedAt) {
  if (!lastUsedAt) return 'offline';
  var ms = Date.now() - new Date(lastUsedAt).getTime();
  if (ms < DEVICE_LIVE_MS) return 'live';
  if (ms < DEVICE_OFFLINE_MS) return 'slow';
  return 'offline';
}

const POLL_INTERVAL = 10; // seconds — REST fallback and offline detection. The socket
// wakes the screen for live transitions so this poll is the safety net, not the
// primary freshness source.

const DevicesScreen = () => {
  const { t } = useLingui();
  const [refresh, setRefresh] = useState(0);
  const [stationOpen, setStationOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editDevice, setEditDevice] = useState(null);
  const [editPosDevice, setEditPosDevice] = useState(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [posRequests, setPosRequests] = useState([]);
  const [posRequestError, setPosRequestError] = useState(null);
  const [posDevices, setPosDevices] = useState([]);
  const {
    capabilities,
    isProductActive,
    selectedMerchantId,
    selectedLocationId,
    setSelectedLocationId,
  } = useMerchant();
  const locations = (capabilities?.locations || []).filter(
    (location) => location.status === 'active',
  );
  const effectiveLocationId =
    selectedLocationId || capabilities?.selectedLocation?.id || locations[0]?.id || '';
  const kdsProductEnabled = isProductActive('kds');
  const posProductEnabled = isProductActive('pos');
  const deviceProducts = {
    kds: kdsProductEnabled,
    pos: posProductEnabled,
  };

  // Auto-poll local heartbeat data so offline/online transitions are picked up.
  useEffect(function () {
    const pollId = setInterval(function () {
      setRefresh(function (r) {
        return r + 1;
      });
    }, POLL_INTERVAL * 1000);
    const tickId = setInterval(function () {
      setCurrentTime(Date.now());
    }, 1000);
    return function () {
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, []);

  const { data: rawDevices, loaded } = useDevicesData(refresh);
  // `loading` is true on EVERY background poll (8-s), not only on the first load, so the
  // header note and per-card labels would flash "Actualizando… / Reconectando…" each poll.
  // `_useAsync` exposes `loaded` — true only after the first successful load — so those
  // transient labels stay stable on a background refresh instead of re-flipping.
  const { data: stations } = useKdsStations(refresh);
  const { data: pairings } = useDevicePairings(refresh);
  // Live channel for connection-status transitions. The socket only wakes the
  // screen (the payload re-reads over REST); when it is down the screen falls
  // back to the 10 s poll below, and the failure is logged loudly in the hook.
  const realtimeState = useDevicesRealtime({
    merchantId: selectedMerchantId,
    enabled: kdsProductEnabled,
    onChanged: () => setRefresh((r) => r + 1),
  });
  const realtimeChip =
    realtimeState === REALTIME_STATE.LIVE
      ? { text: t`En vivo`, cls: 'live' }
      : realtimeState === REALTIME_STATE.CONNECTING
        ? { text: t`Conectando…`, cls: 'connecting' }
        : { text: t`Sondeo 10 s`, cls: 'polling' };
  useEffect(
    function () {
      if (!posProductEnabled) {
        return undefined;
      }
      let active = true;
      // The requests and the devices are one picture — a request disappears exactly as
      // its device appears — so they are read together and fail together. Two effects
      // would let the grid show a terminal while the card above still offered to
      // approve it.
      Promise.all([
        getPosEnrollmentRequests(effectiveLocationId),
        getPosDevices(effectiveLocationId),
      ])
        .then(function ([requestResult, deviceResult]) {
          if (!active) return;
          setPosRequests(requestResult.requests || []);
          setPosDevices(deviceResult.devices || []);
          setPosRequestError(null);
        })
        .catch(function (error) {
          if (active) setPosRequestError(error.message);
        });
      return function () {
        active = false;
      };
    },
    [effectiveLocationId, refresh, posProductEnabled],
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
      locationId: d.location_id || null,
      locationName: d.location_name || locationName(locations, d.location_id),
      status: connectionStatus,
      hasHeartbeat: !!hbStatus,
      open: d.open || 0,
      last: hbSeenMs
        ? fmtLastSeen(t, new Date(hbSeenMs).toISOString())
        : fmtLastSeen(t, d.last_used_at),
      pin: d.pin || '• • • • • •',
      model: d.model || 'iPad',
      ip: d.ip || '—',
      _raw: d,
    };
  });

  const posCards = (posDevices || []).map(function (device) {
    return posDeviceCard(device, locations, currentTime);
  });

  const liveCount = devices.filter(function (d) {
    return d.status === 'live';
  }).length;
  const totalDevices = devices.length + posCards.length;
  const headNote = posCards.length ? (
    <>
      <Trans>{liveCount} KDS en vivo</Trans> ·{' '}
      <Plural value={posCards.length} one="# caja UmiPOS" other="# cajas UmiPOS" />
    </>
  ) : (
    <Trans>{liveCount} en vivo ahora mismo.</Trans>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title={t`Dispositivos pareados`}
        note={loaded ? headNote : t`Actualizando…`}
        count={{ value: totalDevices, label: t`dispositivos` }}
        actions={
          <>
            <span
              className={'chip ' + realtimeChip.cls}
              style={{ fontSize: 10.5, height: 22, alignSelf: 'center' }}
              title={
                realtimeState === REALTIME_STATE.LIVE
                  ? t`Actualización en vivo por el canal en tiempo real.`
                  : t`El canal en tiempo real no responde; la lista se actualiza cada 10 s.`
              }
            >
              {realtimeChip.text}
            </span>
            <button
              className="btn btn-ghost btn-sm focusable"
              onClick={() => {
                setRefresh((r) => r + 1);
              }}
            >
              <I.Refresh size={14} /> <Trans>Actualizar</Trans>
            </button>
            <button className="btn btn-secondary focusable" onClick={() => setStationOpen(true)}>
              <I.Layout size={16} /> <Trans>Estaciones</Trans>
            </button>
            <button className="btn btn-primary focusable" onClick={() => setAddOpen(true)}>
              <I.Plus size={16} /> <Trans>Añadir dispositivo</Trans>
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
                      flexWrap: 'wrap',
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
                      {d.station || t`SIN ASIGNAR`}
                    </span>
                    <span className="chip" style={{ fontSize: 10, height: 20, flexShrink: 0 }}>
                      {d.locationName}
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
                      {!loaded && d.status !== 'live' ? (
                        <span style={{ color: 'var(--warning)', fontStyle: 'italic' }}>
                          <Trans>Reconectando…</Trans>
                        </span>
                      ) : d.status === 'live' ? (
                        <Trans>En vivo</Trans>
                      ) : d.status === 'slow' ? (
                        <Trans>Lento</Trans>
                      ) : (
                        <Trans>Sin conexión</Trans>
                      )}
                    </span>
                    <span style={{ color: 'var(--ink-3)' }} aria-hidden="true">
                      ·
                    </span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <Trans>Visto {d.last}</Trans>
                    </span>
                  </div>
                </div>

                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div className="eyebrow" style={{ fontSize: 9, marginBottom: 2 }}>
                    <Trans>ÓRDENES</Trans>
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
                  aria-label={t`Editar dispositivo`}
                >
                  <I.Edit size={15} />
                </button>
              </div>
            </div>
          );
        })}
        {posCards.map(function (d) {
          return <PosDeviceCard key={d.id} device={d} onEdit={() => setEditPosDevice(d)} />;
        })}
      </div>

      {(pairings || []).length > 0 && (
        <PairingRequestsCard
          pairings={pairings}
          stations={(stations || []).filter(
            (station) => station.location_id === effectiveLocationId,
          )}
          currentTime={currentTime}
          onChanged={() => setRefresh((r) => r + 1)}
        />
      )}

      {posProductEnabled && (
        <PosEnrollmentRequestsCard
          requests={posRequests}
          error={posRequestError}
          locations={locations}
          branchId={effectiveLocationId}
          onChanged={() => setRefresh((r) => r + 1)}
        />
      )}

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
          stations={(stations || []).filter(
            (station) => station.location_id === effectiveLocationId,
          )}
          pairings={pairings || []}
          products={deviceProducts}
          locations={locations}
          branchId={effectiveLocationId}
          onBranchChange={setSelectedLocationId}
          onProvisioned={() => setRefresh((r) => r + 1)}
        />
      )}
      {editPosDevice && (
        <EditPosDevicePanel
          device={editPosDevice}
          branchId={effectiveLocationId}
          onClose={() => setEditPosDevice(null)}
          onSaved={() => {
            setEditPosDevice(null);
            setRefresh((r) => r + 1);
          }}
        />
      )}
      {editDevice && (
        <EditDevicePanel
          device={editDevice}
          stations={(stations || []).filter(
            (station) => !editDevice.locationId || station.location_id === editDevice.locationId,
          )}
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

const POS_STATUS_LABELS = {
  registered: msg`Registrado`,
  rotation: msg`Rotación pendiente`,
};

/**
 * The POS half of the device grid. It shares the KDS card's frame on purpose — one grid,
 * one shape — and differs only where the two devices differ: a register carries a
 * platform and a floor-use label where an iPad carries a station, and it reports no
 * order count because it never had one to report.
 */
export const PosDeviceCard = ({ device, onEdit }) => {
  const { t, i18n } = useLingui();
  return (
    <div
      className={'list-card ' + device.status}
      style={{ padding: 0, paddingRight: 16, cursor: 'pointer', transition: 'box-shadow 0.15s' }}
      onClick={onEdit}
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
          <I.Monitor size={18} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 3,
              flexWrap: 'wrap',
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
              {device.name}
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
              {device.platformLabel.toUpperCase()}
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
              {device.mobilityLabel.toUpperCase()}
            </span>
            <span className="chip" style={{ fontSize: 10, height: 20, flexShrink: 0 }}>
              {device.locationName}
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span className={'s-dot ' + device.status} />
              {POS_STATUS_LABELS[device.status]
                ? i18n._(POS_STATUS_LABELS[device.status])
                : device.status}
            </span>
            <span style={{ color: 'var(--ink-3)' }} aria-hidden="true">
              ·
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>
              <Trans>Visto {device.last}</Trans>
            </span>
          </div>
        </div>

        <button
          className="btn-icon focusable"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={t`Editar caja`}
        >
          <I.Edit size={15} />
        </button>
      </div>
    </div>
  );
};

/**
 * The POS detail sheet. It is a sibling of `EditDevicePanel`, not a branch inside it:
 * that panel edits a station assignment and reads an open-order count, and a register
 * has neither. Sharing it was what made the edit button open a blank sheet.
 */
export const EditPosDevicePanel = ({ device, branchId, onClose, onSaved }) => {
  const { t, i18n } = useLingui();
  const uid = useId();
  const [name, setName] = useState(device.name);
  const [mobility, setMobility] = useState(device.mobility || 'static');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updatePosDevice(device.id, { displayName: name.trim(), mobility }, branchId);
      onSaved && onSaved();
    } catch (failure) {
      console.error('[umipos] device update failed', failure);
      setError(t`No se pudieron guardar los cambios. Intenta de nuevo.`);
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await revokePosDevice(device.id, 'removed_from_dashboard');
      onSaved && onSaved();
    } catch (failure) {
      console.error('[umipos] device revoke failed', failure);
      setError(t`No se pudo revocar la caja. Intenta de nuevo.`);
      setRemoving(false);
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">
              <Trans>UmiPOS · Dispositivo</Trans>
            </div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              <Trans>Gestionar caja</Trans>
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
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
              <I.Monitor size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span className={'s-dot ' + device.status} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
                  {POS_STATUS_LABELS[device.status]
                    ? i18n._(POS_STATUS_LABELS[device.status])
                    : device.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                <Trans>Visto {device.last}</Trans>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow" style={{ fontSize: 9, marginBottom: 3 }}>
                <Trans>CREDENCIAL</Trans>
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: 'var(--ink-1)',
                }}
              >
                v{device.credentialVersion}
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor={`${uid}-pos-device-name`}>
              <Trans>Nombre del dispositivo</Trans>
            </label>
            <input
              id={`${uid}-pos-device-name`}
              className="input tall"
              maxLength={120}
              placeholder={t`Caja principal`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor={`${uid}-pos-device-mobility`}>
              <Trans>Modalidad</Trans>
            </label>
            <select
              id={`${uid}-pos-device-mobility`}
              className="select"
              style={{ height: 52, borderRadius: 14 }}
              value={mobility}
              onChange={(e) => setMobility(e.target.value)}
            >
              <option value="static">{mobilityLabel('static')}</option>
              <option value="mobile">{mobilityLabel('mobile')}</option>
            </select>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              <Trans>
                Estático es una caja fija en el mostrador. Móvil es una terminal que se lleva a la
                mesa.
              </Trans>
            </span>
          </div>

          <div className="field">
            <span className="field-label">
              <Trans>Plataforma</Trans>
            </span>
            <div className="input tall" style={{ display: 'flex', alignItems: 'center' }}>
              {platformLabel(device.platform)}
            </div>
          </div>

          <div className="field">
            <span className="field-label">
              <Trans>Sucursal</Trans>
            </span>
            <div className="input tall" style={{ display: 'flex', alignItems: 'center' }}>
              {device.locationName}
            </div>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              <Trans>Para cambiar la sucursal, registra el dispositivo otra vez.</Trans>
            </span>
          </div>

          <div className="field">
            <span className="field-label">
              <Trans>ID público</Trans>
            </span>
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
                {reveal ? device.publicId : '••••••••-••••-••••-••••-••••••••••••'}
              </span>
              <button
                className="pin-reveal focusable"
                onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? t`Ocultar` : t`Mostrar`}
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
              <I.Trash size={14} />{' '}
              {removing ? <Trans>Revocando…</Trans> : <Trans>Revocar caja</Trans>}
            </button>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            <Trans>Cancelar</Trans>
          </button>
          <button
            className="btn btn-primary focusable"
            disabled={!name.trim() || saving}
            style={{ opacity: name.trim() && !saving ? 1 : 0.5 }}
            onClick={save}
          >
            {saving ? <Trans>Guardando…</Trans> : <Trans>Guardar cambios</Trans>}
          </button>
        </div>
      </aside>
      {confirmingRevoke && (
        <div className="modal-backdrop" onClick={() => !removing && setConfirmingRevoke(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <div>
                <div className="eyebrow">
                  <Trans>UmiPOS · Acceso</Trans>
                </div>
                <h2 className="h-section" style={{ marginTop: 4 }}>
                  <Trans>Revocar caja</Trans>
                </h2>
              </div>
              <button
                className="btn-icon"
                disabled={removing}
                onClick={() => setConfirmingRevoke(false)}
                aria-label={t`Cerrar`}
              >
                <I.X size={16} />
              </button>
            </div>
            <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.5 }}>
              <Trans>
                Esta caja pierde su credencial de inmediato. Para volver a usarla, crea un código de
                registro nuevo y regístrala otra vez.
              </Trans>
            </p>
            {error && (
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--danger)',
                  background: 'var(--danger-soft)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  marginTop: 14,
                }}
              >
                {error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button
                className="btn btn-ghost"
                disabled={removing}
                onClick={() => setConfirmingRevoke(false)}
              >
                <Trans>Cancelar</Trans>
              </button>
              <button className="btn btn-primary focusable" disabled={removing} onClick={remove}>
                {removing ? <Trans>Revocando…</Trans> : <Trans>Revocar</Trans>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const PAIRING_ERROR_MESSAGES = {
  pairing_not_pending: msg`Esta solicitud ya expiró o fue atendida. Actualiza la lista.`,
  invalid_pairing_id: msg`Solicitud inválida.`,
};

// Show operators friendly copy; the raw error (code, status, path) goes to the
// console for debugging.
function pairingErrorMessage(i18n, err) {
  const known = PAIRING_ERROR_MESSAGES[err && err.code];
  return known ? i18n._(known) : i18n._(msg`No se pudo completar la acción. Intenta de nuevo.`);
}

const PairingRequestsCard = ({ pairings, stations, currentTime, onChanged }) => {
  const { t, i18n } = useLingui();
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
      setError(pairingErrorMessage(i18n, err));
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
      setError(pairingErrorMessage(i18n, err));
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
          <div className="eyebrow">
            <Trans>Primer pareo</Trans>
          </div>
          <h2 className="h-section" style={{ marginTop: 4 }}>
            <Trans>Solicitudes KDS pendientes</Trans>
          </h2>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onChanged}>
          <I.Refresh size={14} /> <Trans>Actualizar</Trans>
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
          const requested = p.requested_name || t`Esperando iPad`;
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
                      ? t`Aprobado`
                      : expired
                        ? t`Expirada`
                        : pendingApproval
                          ? t`Confirmar`
                          : t`Esperando`}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  <Trans>iPad · {requested}</Trans> <XSep />{' '}
                  <Trans>expira {formatTime(p.expires_at)}</Trans>
                </div>
              </div>
              {p.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy === p.id + ':deny'}
                    onClick={() => deny(p.id)}
                  >
                    <I.X size={14} /> <Trans>Rechazar</Trans>
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!p.requested_name || expired || busy === p.id + ':approve'}
                    style={{ opacity: p.requested_name && !expired ? 1 : 0.5 }}
                    onClick={() => approve(p.id)}
                  >
                    <I.Check size={14} /> <Trans>Aprobar</Trans>
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
  const { t } = useLingui();
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
    device.status === 'live' ? t`En vivo` : device.status === 'slow' ? t`Lento` : t`Sin conexión`;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">
              <Trans>KDS · Dispositivo</Trans>
            </div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              <Trans>Gestionar dispositivo</Trans>
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label={t`Cerrar`}>
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
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                <Trans>Visto {device.last}</Trans>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow" style={{ fontSize: 9, marginBottom: 3 }}>
                <Trans>ÓRDENES ABIERTAS</Trans>
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
            <label htmlFor={`${uid}-nombre-del-dispositivo`}>
              <Trans>Nombre del dispositivo</Trans>
            </label>
            <input
              id={`${uid}-nombre-del-dispositivo`}
              className="input tall"
              placeholder={t`p. ej. Cocina Caliente 1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor={`${uid}-estacion-asignada`}>
              <Trans>Estación asignada</Trans>
            </label>
            <select
              id={`${uid}-estacion-asignada`}
              className="select"
              style={{ height: 52, borderRadius: 14 }}
              value={station}
              onChange={(e) => setStation(e.target.value)}
            >
              <option value="">{t`Sin asignar`}</option>
              {(stations || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="field-label">
              <Trans>Sucursal</Trans>
            </span>
            <div className="input tall" style={{ display: 'flex', alignItems: 'center' }}>
              {device.locationName}
            </div>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              <Trans>Para cambiar la sucursal, registra el dispositivo otra vez.</Trans>
            </span>
          </div>

          <div className="field">
            <span className="field-label">
              <Trans>ID de sesión</Trans>
            </span>
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
                aria-label={reveal ? t`Ocultar` : t`Mostrar`}
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
              <I.Trash size={14} />{' '}
              {removing ? <Trans>Revocando…</Trans> : <Trans>Revocar dispositivo</Trans>}
            </button>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            <Trans>Cancelar</Trans>
          </button>
          <button
            className="btn btn-primary focusable"
            disabled={!name.trim() || saving}
            style={{ opacity: name.trim() && !saving ? 1 : 0.5 }}
            onClick={save}
          >
            {saving ? <Trans>Guardando…</Trans> : <Trans>Guardar cambios</Trans>}
          </button>
        </div>
      </aside>
      {confirmingRevoke && (
        <div className="modal-backdrop" onClick={() => !removing && setConfirmingRevoke(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <div>
                <div className="eyebrow">
                  <Trans>KDS · Acceso</Trans>
                </div>
                <h2 className="h-section" style={{ marginTop: 4 }}>
                  <Trans>Revocar dispositivo</Trans>
                </h2>
              </div>
              <button
                className="btn-icon"
                disabled={removing}
                onClick={() => setConfirmingRevoke(false)}
                aria-label={t`Cerrar`}
              >
                <I.X size={16} />
              </button>
            </div>
            <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.5 }}>
              <Trans>Este iPad se cerrará y tendrá que parearse de nuevo con un PIN.</Trans>
            </p>
            {error && (
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--danger)',
                  background: 'var(--danger-soft)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  marginTop: 14,
                }}
              >
                {error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button
                className="btn btn-ghost"
                disabled={removing}
                onClick={() => setConfirmingRevoke(false)}
              >
                <Trans>Cancelar</Trans>
              </button>
              <button className="btn btn-primary focusable" disabled={removing} onClick={remove}>
                {removing ? <Trans>Revocando…</Trans> : <Trans>Revocar</Trans>}
              </button>
            </div>
          </div>
        </div>
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
  const { t } = useLingui();
  const [name, setName] = useState(station.name);
  const [busy, setBusy] = useState(false);

  useEffect(
    function () {
      // The row can receive a newer station name while its edit panel stays open.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        t`¿Archivar la estación "${station.name}"? Dejará de aparecer al asignar dispositivos.`,
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
            <Plural value={count} one="# dispositivo asignado" other="# dispositivos asignados" />
            {dirty ? (
              <>
                {' · '}
                <Trans>sin guardar</Trans>
              </>
            ) : null}
          </div>
        </div>
        <button
          className="btn-icon"
          aria-label={t`Archivar estación`}
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
  const { t } = useLingui();
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
            <div className="eyebrow">
              <Trans>Dispositivos · KDS</Trans>
            </div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              <Trans>Estaciones</Trans>
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <p style={{ color: 'var(--ink-2)', margin: 0, fontSize: 13.5 }}>
            <Trans>
              Los tickets se enrutan a estaciones según la categoría del menú. Cada estación puede
              asignarse a uno o más iPads.
            </Trans>
          </p>
          {list.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              <Trans>Aún no hay estaciones. Crea la primera abajo.</Trans>
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
            <label htmlFor={`${uid}-nueva-estacion`}>
              <Trans>Nueva estación</Trans>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id={`${uid}-nueva-estacion`}
                className="input"
                placeholder={t`p. ej. Cocina Caliente`}
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
                <I.Plus size={16} /> {saving ? <Trans>Creando…</Trans> : <Trans>Crear</Trans>}
              </button>
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            <Trans>Cerrar</Trans>
          </button>
        </div>
      </aside>
    </>
  );
};

const AddDevicePanel = ({
  onClose,
  stations,
  pairings,
  products,
  locations,
  branchId,
  onBranchChange,
  onProvisioned,
}) => {
  const { t } = useLingui();
  const uid = useId();
  const purchaseMessageId = `${uid}-purchase-message`;
  const kdsEnabled = products?.kds === true;
  const posEnabled = products?.pos === true;
  const [deviceProduct, setDeviceProduct] = useState(kdsEnabled ? 'kds' : posEnabled ? 'pos' : '');
  const [name, setName] = useState('');
  const [station, setStation] = useState('');
  const [pairing, setPairing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [posName, setPosName] = useState('');
  const [posPlatform, setPosPlatform] = useState('web');
  const [posMobility, setPosMobility] = useState('static');
  const [posCreated, setPosCreated] = useState(null);
  const [posSaving, setPosSaving] = useState(false);
  const [posError, setPosError] = useState(null);
  const activeDeviceProduct =
    deviceProduct === 'kds' && kdsEnabled
      ? 'kds'
      : deviceProduct === 'pos' && posEnabled
        ? 'pos'
        : kdsEnabled
          ? 'kds'
          : posEnabled
            ? 'pos'
            : '';

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

  const selectedStationId = station || stations?.[0]?.id || '';

  function addStation() {
    return createStationInline(setError);
  }

  async function createDevice() {
    setSaving(true);
    setError(null);
    try {
      const result = await generateDevicePairingPin({
        device_name: name,
        station_id: selectedStationId,
      });
      setPairing(result.pairing);
      onProvisioned && onProvisioned();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function createPosRequest() {
    setPosSaving(true);
    setPosError(null);
    try {
      const result = await createPosEnrollmentRequest({
        locationId: branchId || null,
        displayName: posName.trim(),
        type: 'pos_terminal',
        platform: posPlatform,
        mobility: posMobility,
        idempotencyKey: crypto.randomUUID(),
      });
      setPosCreated(result);
      onProvisioned && onProvisioned();
    } catch (failure) {
      console.error('[umipos] enrollment request failed', failure);
      setPosError(t`No se pudo crear el código. Verifica la sucursal y vuelve a intentarlo.`);
    } finally {
      setPosSaving(false);
    }
  }

  const selectedStation = (stations || []).find(function (s) {
    return s.id === selectedStationId;
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
            <div className="eyebrow">
              <Trans>Dispositivos</Trans>
            </div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              <Trans>Añadir dispositivo</Trans>
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor={`${uid}-device-location`}>
              <Trans>Sucursal</Trans>
            </label>
            <select
              id={`${uid}-device-location`}
              className="select"
              style={{ height: 52, borderRadius: 14 }}
              value={branchId || ''}
              disabled={Boolean(pairing || posCreated)}
              onChange={(event) => {
                setStation('');
                setPairing(null);
                setPosCreated(null);
                setError(null);
                setPosError(null);
                onBranchChange?.(event.target.value);
              }}
            >
              <option value="">{t`Selecciona una sucursal`}</option>
              {(locations || []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              <Trans>El dispositivo y sus estaciones quedarán vinculados a esta sucursal.</Trans>
            </span>
          </div>

          <div className="field">
            <label htmlFor={`${uid}-device-product`}>
              <Trans>Producto del dispositivo</Trans>
            </label>
            <select
              id={`${uid}-device-product`}
              className="select"
              style={{ height: 52, borderRadius: 14 }}
              value={activeDeviceProduct}
              aria-describedby={!kdsEnabled || !posEnabled ? purchaseMessageId : undefined}
              onChange={(event) => {
                setDeviceProduct(event.target.value);
                setError(null);
                setPosError(null);
              }}
            >
              {!activeDeviceProduct && <option value="">{t`Selecciona un producto`}</option>}
              <option
                value="kds"
                disabled={!kdsEnabled}
                title={!kdsEnabled ? t`Necesitas comprar este producto primero.` : undefined}
              >
                {kdsEnabled ? 'UmiKDS' : t`UmiKDS — producto no activo`}
              </option>
              <option
                value="pos"
                disabled={!posEnabled}
                title={!posEnabled ? t`Necesitas comprar este producto primero.` : undefined}
              >
                {posEnabled ? 'UmiPOS' : t`UmiPOS — producto no activo`}
              </option>
            </select>
            {(!kdsEnabled || !posEnabled) && (
              <div id={purchaseMessageId} className="device-product-help" role="note">
                <span aria-hidden="true">
                  <I.Lock size={14} />
                </span>
                <span>
                  <Trans>Las opciones en gris requieren un producto activo.</Trans>
                </span>
                <button
                  type="button"
                  className="device-product-tooltip"
                  aria-label={t`Información sobre productos no activos`}
                >
                  <Trans>¿Por qué?</Trans>
                  <span role="tooltip">
                    <Trans>Necesitas comprar este producto primero.</Trans>
                  </span>
                </button>
              </div>
            )}
          </div>

          {activeDeviceProduct === 'kds' && (
            <>
              <div className="field">
                <label htmlFor={`${uid}-device-name`}>
                  <Trans>Nombre del dispositivo</Trans>
                </label>
                <input
                  id={`${uid}-device-name`}
                  className="input tall"
                  placeholder={t`p. ej. Cocina Caliente 2`}
                  value={name}
                  onChange={function (e) {
                    setName(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor={`${uid}-assign-to-station`}>
                  <Trans>Estación asignada</Trans>
                </label>
                {hasStations ? (
                  <select
                    id={`${uid}-assign-to-station`}
                    className="select"
                    style={{ height: 52, borderRadius: 14 }}
                    value={selectedStationId}
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
                      <Trans>
                        No hay estaciones todavía. Crea una para asignar este dispositivo.
                      </Trans>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="input"
                        placeholder={t`Nombre de la estación`}
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
                        <I.Plus size={16} />{' '}
                        {creatingStation ? <Trans>Creando…</Trans> : <Trans>Crear estación</Trans>}
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
                  <span className="field-label">
                    <Trans>PIN de primer pareo</Trans>
                  </span>
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
                        <Trans>Esperando solicitud del iPad</Trans>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="eyebrow on-warm" style={{ marginBottom: 4 }}>
                        <Trans>estación</Trans>
                      </div>
                      <div style={{ fontWeight: 600, color: 'var(--ink-warm)' }}>
                        {selectedStation?.name || pairing.station_id}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-warm-soft)' }}>
                        <Trans>Expira {formatTime(pairing.expires_at)}</Trans>
                      </div>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
                    <Trans>
                      Escribe este PIN en el iPad del KDS. Cuando aparezca en las solicitudes
                      pendientes, apruébalo desde esta pantalla.
                    </Trans>
                  </p>
                </div>
              )}
              {activePairings.length > 0 && (
                <div className="field">
                  <span className="field-label">
                    <Trans>Solicitudes activas</Trans>
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activePairings.map(function (p) {
                      return (
                        <div key={p.id} className="list-card" style={{ padding: 12 }}>
                          <div style={{ paddingLeft: 12, flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.device_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                              {p.requested_name || t`Esperando iPad`} <XSep /> {p.status}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {activeDeviceProduct === 'pos' && (
            <>
              {!posCreated ? (
                <>
                  <div className="field">
                    <label htmlFor={`${uid}-pos-name`}>
                      <Trans>Nombre del dispositivo</Trans>
                    </label>
                    <input
                      id={`${uid}-pos-name`}
                      className="input tall"
                      value={posName}
                      maxLength={120}
                      onChange={(event) => setPosName(event.target.value)}
                      placeholder={t`Caja principal`}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-pos-platform`}>
                      <Trans>Plataforma</Trans>
                    </label>
                    <select
                      id={`${uid}-pos-platform`}
                      className="select"
                      value={posPlatform}
                      onChange={(event) => setPosPlatform(event.target.value)}
                    >
                      <option value="web">Web</option>
                      <option value="linux">Linux</option>
                      <option value="macos">macOS</option>
                      <option value="windows">Windows</option>
                      <option value="android">Android</option>
                      <option value="ios">iOS</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-pos-mobility`}>
                      <Trans>Modalidad</Trans>
                    </label>
                    <select
                      id={`${uid}-pos-mobility`}
                      className="select"
                      value={posMobility}
                      onChange={(event) => setPosMobility(event.target.value)}
                    >
                      <option value="static">{mobilityLabel('static')}</option>
                      <option value="mobile">{mobilityLabel('mobile')}</option>
                    </select>
                    <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                      <Trans>
                        Estático es una caja fija en el mostrador. Móvil es una terminal que se
                        lleva a la mesa.
                      </Trans>
                    </span>
                  </div>
                  <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                    <Trans>
                      La solicitud queda vinculada al negocio y a la sucursal seleccionada.
                    </Trans>
                  </p>
                </>
              ) : (
                <div className="card-warm" style={{ padding: 24, textAlign: 'center' }}>
                  <div className="eyebrow on-warm">
                    <Trans>Código de configuración</Trans>
                  </div>
                  <div
                    aria-label={t`Código ${posCreated.setupCode}`}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 38,
                      letterSpacing: '0.12em',
                      marginTop: 12,
                      color: 'var(--ink-warm)',
                    }}
                  >
                    {posCreated.setupCode.slice(0, 4)} {posCreated.setupCode.slice(4)}
                  </div>
                  <p style={{ color: 'var(--ink-warm-soft)', marginBottom: 0 }}>
                    <Trans>
                      Escribe este código en UmiPOS. Después, aprueba la solicitud en esta pantalla.
                    </Trans>
                  </p>
                  <p style={{ color: 'var(--ink-warm-soft)', fontSize: 12 }}>
                    <Trans>Expira a las {formatTime(posCreated.expiresAt)}.</Trans>
                  </p>
                </div>
              )}
              {posError && (
                <div role="alert" style={{ color: 'var(--danger)' }}>
                  {posError}
                </div>
              )}
            </>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            <Trans>Cerrar</Trans>
          </button>
          {activeDeviceProduct === 'kds' && (
            <button
              className="btn btn-primary"
              disabled={!branchId || !name.trim() || !selectedStationId || saving || pairing}
              style={{
                opacity:
                  branchId && name.trim() && selectedStationId && !saving && !pairing ? 1 : 0.5,
              }}
              onClick={createDevice}
            >
              <I.Refresh size={15} />{' '}
              {saving ? (
                <Trans>Generando…</Trans>
              ) : pairing ? (
                <Trans>PIN generado</Trans>
              ) : (
                <Trans>Generar PIN</Trans>
              )}
            </button>
          )}
          {activeDeviceProduct === 'pos' && !posCreated && (
            <button
              className="btn btn-primary focusable"
              disabled={!branchId || !posName.trim() || posSaving}
              onClick={createPosRequest}
            >
              {posSaving ? <Trans>Creando…</Trans> : <Trans>Crear código</Trans>}
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

const POS_STATE_LABELS = {
  created: msg`Código creado`,
  awaiting_approval: msg`Requiere aprobación`,
  credential_ready: msg`Aprobado`,
  credential_delivered: msg`Credencial entregada`,
  completed: msg`Completado`,
  denied: msg`Denegado`,
  expired: msg`Expirado`,
  cancelled: msg`Cancelado`,
};

const PosEnrollmentRequestsCard = ({ requests, error, locations, branchId, onChanged }) => {
  const { t, i18n } = useLingui();
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const visible = visiblePosEnrollmentRequests(requests);

  async function decide(request, approved) {
    setBusy(request.id);
    setActionError(null);
    try {
      if (approved) await approvePosEnrollmentRequest(request.id, branchId);
      else await denyPosEnrollmentRequest(request.id, branchId);
    } catch (failure) {
      console.error('[umipos] enrollment decision failed', failure);
      setActionError(t`No se pudo guardar la decisión. Actualiza y vuelve a intentarlo.`);
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
            <Trans>Solicitudes de registro</Trans>
          </h2>
        </div>
        <button className="btn btn-ghost btn-sm focusable" onClick={onChanged}>
          <I.Refresh size={14} /> <Trans>Actualizar</Trans>
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
        <p style={{ color: 'var(--ink-3)', marginBottom: 0 }}>
          <Trans>No hay solicitudes de UmiPOS.</Trans>
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {visible.map(function (request) {
            const pending = request.state === 'awaiting_approval';
            return (
              <div key={request.id} className="list-card" style={{ padding: 14 }}>
                <div style={{ paddingLeft: 14, flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>{request.displayName}</b>
                    <span className="chip">
                      {POS_STATE_LABELS[request.state]
                        ? i18n._(POS_STATE_LABELS[request.state])
                        : request.state}
                    </span>
                    <span className="chip">{locationName(locations, request.locationId)}</span>
                  </div>
                  <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 4 }}>
                    {platformLabel(request.requestedPlatform || request.platform)} ·{' '}
                    {mobilityLabel(request.mobility)}
                    {request.installationReference ? (
                      <>
                        {' · '}
                        <Trans>Instalación {request.installationReference}</Trans>
                      </>
                    ) : (
                      ''
                    )}
                  </div>
                </div>
                {pending && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-ghost btn-sm focusable"
                      disabled={busy === request.id}
                      onClick={() => decide(request, false)}
                    >
                      <Trans>Denegar</Trans>
                    </button>
                    <button
                      className="btn btn-primary btn-sm focusable"
                      disabled={busy === request.id}
                      onClick={() => decide(request, true)}
                    >
                      <Trans>Aprobar</Trans>
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

export default DevicesScreen;

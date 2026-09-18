import { useState, useEffect, useId, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Segmented } from '@/components/segmented.jsx';
import { Select } from '@/components/select.jsx';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatDate, formatNumber, formatTime } from '@/lib/format.js';
import { hasRequiredPermission } from '@/lib/module-registry.js';
import { RegionHead, XSep } from '@/shell.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { REALTIME_STATE, useDevicesRealtime } from '@/lib/device-realtime.js';
import {
  locationName,
  mpPointStoreRefusalCode,
  mpPointStoreRefusalMessage,
  mobilityLabel,
  platformLabel,
  posDeviceCard,
  visiblePosEnrollmentRequests,
} from './device-utils.js';
import {
  approvePosEnrollmentRequest,
  approveDevicePairing,
  bindMpPointTerminal,
  createMpPointStore,
  createPosEnrollmentRequest,
  createKdsStation,
  deleteKdsStation,
  denyDevicePairing,
  denyPosEnrollmentRequest,
  disconnectMpPointAccount,
  generateDevicePairingPin,
  getMpPointAuthorization,
  getPosDevices,
  getPosEnrollmentRequests,
  revokeDevice,
  revokePosDevice,
  unbindMpPointTerminal,
  updatePosDevice,
  updateDevice,
  updateKdsStation,
  useDevicePairings,
  useDevicesData,
  useKdsStations,
  useMpPointData,
} from '@/data.jsx';

// Screen 3 — Devices (KDS)
// Data: useDevicesData() → kds.device_sessions from Supabase
// Status derived from local heartbeat: <10s=live, <20s=slow, else=offline.

const DEVICE_LIVE_MS = 10_000;
const DEVICE_OFFLINE_MS = 20_000;

// Derive human-readable last-seen from last_used_at timestamp.
//
// ⚠️ `i18n._(msg…)`, not the `t` a component destructures. The `t` macro belongs to the scope
// that destructures `useLingui()`, so a helper that RECEIVES one gets an untransformed
// template call, and the runtime answers it with an empty string — every KDS card read
// "Visto" with nothing after it. The catalog is the proof: none of these five messages was
// ever extracted from this file, while `data.jsx`/`device-utils.js` carry all of them.
function fmtLastSeen(i18n, lastUsedAt) {
  if (!lastUsedAt) return i18n._(msg`nunca`);
  var ms = Date.now() - new Date(lastUsedAt).getTime();
  if (ms < 10000) return i18n._(msg`hace un momento`);
  if (ms < 60000) return i18n._(msg`hace ${Math.floor(ms / 1000)} s`);
  if (ms < 3600000) return i18n._(msg`hace ${Math.floor(ms / 60000)} min`);
  return i18n._(msg`hace ${Math.floor(ms / 3600000)} h`);
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
  const { t, i18n } = useLingui();
  const [refresh, setRefresh] = useState(0);
  const [stationOpen, setStationOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editDevice, setEditDevice] = useState(null);
  const [editPosDevice, setEditPosDevice] = useState(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [posRequests, setPosRequests] = useState([]);
  const [posRequestError, setPosRequestError] = useState(null);
  const [posDevices, setPosDevices] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  // The Mercado Pago OAuth callback lands back HERE, with the outcome on the query string.
  // It is read ONCE, on mount, into this state and then dropped from the URL by the effect
  // below: a one-shot answer is announced once, a reload does not re-announce a flow that
  // already finished, and a copied URL carries no verdict from someone else's attempt.
  const [mpPointResult, setMpPointResult] = useState(function () {
    const outcome = searchParams.get('mpPoint');
    return outcome ? { outcome: outcome, code: searchParams.get('code') || null } : null;
  });
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
  // Which account receives the café's card money is an owner's decision, and the Phase 5
  // routes are gated on `merchant.manage`. The Devices module's own gate is `device.enroll`,
  // so a cashier reaches this screen without the permission the Mercado Pago surface needs —
  // asking anyway would be one 403 per load for a control they cannot use. Same rule, and
  // same reason, as `_canReadCashSettings` in data.jsx.
  const canManagePayments = hasRequiredPermission(
    { permissions: ['merchant.manage'] },
    capabilities,
  );
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

  useEffect(
    function () {
      if (!searchParams.has('mpPoint') && !searchParams.has('code')) return;
      const next = new URLSearchParams(searchParams);
      next.delete('mpPoint');
      next.delete('code');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

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
        ? fmtLastSeen(i18n, new Date(hbSeenMs).toISOString())
        : fmtLastSeen(i18n, d.last_used_at),
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

      {mpPointResult && (
        <MpPointCallbackNotice result={mpPointResult} onDismiss={() => setMpPointResult(null)} />
      )}

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

      {posProductEnabled && canManagePayments && (
        <MercadoPagoPointCard
          refresh={refresh}
          onChanged={() => setRefresh((r) => r + 1)}
          registers={posCards}
          locations={locations}
          branchId={effectiveLocationId}
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
            <Select
              id={`${uid}-pos-device-mobility`}
              className="select"
              style={{ height: 52, borderRadius: 14 }}
              value={mobility}
              onChange={(e) => setMobility(e.target.value)}
            >
              <option value="static">{mobilityLabel('static')}</option>
              <option value="mobile">{mobilityLabel('mobile')}</option>
            </Select>
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
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          // Two icon+text buttons beside a title: on a narrow console the row wraps rather
          // than pushing them past the card's edge.
          flexWrap: 'wrap',
        }}
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
            <Select
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
            </Select>
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
            <Select
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
            </Select>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              <Trans>El dispositivo y sus estaciones quedarán vinculados a esta sucursal.</Trans>
            </span>
          </div>

          <div className="field">
            <label htmlFor={`${uid}-device-product`}>
              <Trans>Producto del dispositivo</Trans>
            </label>
            <Select
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
            </Select>
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
                  <Select
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
                  </Select>
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
                    <Select
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
                    </Select>
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-pos-mobility`}>
                      <Trans>Modalidad</Trans>
                    </label>
                    <Select
                      id={`${uid}-pos-mobility`}
                      className="select"
                      value={posMobility}
                      onChange={(event) => setPosMobility(event.target.value)}
                    >
                      <option value="static">{mobilityLabel('static')}</option>
                      <option value="mobile">{mobilityLabel('mobile')}</option>
                    </Select>
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

/**
 * The vendor's own outcome vocabulary, as the callback spells it. An outcome that is not
 * in this table is reported as unknown rather than guessed at, and `code` (the vendor's
 * refusal code) rides BESIDE the sentence: the sentence is what a seller can act on, the
 * code is what a support conversation quotes.
 */
const MP_POINT_CALLBACK_OUTCOMES = {
  connected: { tone: 'success', message: msg`Cuenta de Mercado Pago conectada.` },
  failed: { tone: 'danger', message: msg`Mercado Pago rechazó la conexión.` },
  invalid_state: {
    tone: 'warning',
    message: msg`La invitación ya no era válida. Inicia la conexión otra vez.`,
  },
  missing_code: {
    tone: 'warning',
    message: msg`Mercado Pago no devolvió el código de autorización.`,
  },
  unavailable: {
    tone: 'warning',
    message: msg`Este servidor no está configurado para conectar cuentas de Mercado Pago.`,
  },
};

const MP_POINT_NOTICE_TONES = {
  success: { fg: 'var(--success)', bg: 'var(--success-soft)', Icon: I.Check },
  warning: { fg: 'var(--warning)', bg: 'var(--warning-soft)', Icon: I.AlertTriangle },
  danger: { fg: 'var(--danger)', bg: 'var(--danger-soft)', Icon: I.AlertTriangle },
};

/**
 * One line about the flow that just finished, and a way to dismiss it. It is a `status`
 * rather than an `alert` because it arrives with the page, not during it.
 */
export const MpPointCallbackNotice = ({ result, onDismiss }) => {
  const { t, i18n } = useLingui();
  if (!result) return null;
  const known = MP_POINT_CALLBACK_OUTCOMES[result.outcome];
  const tone = MP_POINT_NOTICE_TONES[known ? known.tone : 'warning'];
  const Icon = tone.Icon;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: tone.fg,
        background: tone.bg,
        borderRadius: 12,
        padding: '10px 12px',
      }}
    >
      <Icon size={15} />
      <span style={{ fontSize: 13, fontWeight: 550 }}>
        {known
          ? i18n._(known.message)
          : i18n._(msg`No se pudo confirmar la conexión con Mercado Pago.`)}
      </span>
      {result.code ? (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.75 }}>
          {result.code}
        </span>
      ) : null}
      <button
        className="btn-icon focusable"
        style={{ marginLeft: 'auto' }}
        onClick={onDismiss}
        aria-label={t`Cerrar`}
      >
        <I.X size={14} />
      </button>
    </div>
  );
};

/**
 * D8's renewal margin: the job starts renewing a token 14 days before it expires, and the
 * owner alert of §7 item 4 watches the same window. The console paints that window so a
 * café does not discover the lapse at the counter.
 *
 * The DAYS are never computed here: `daysUntilExpiry` is the server's, floored by the
 * server, so this card and the alert cannot disagree about what "12 days" means.
 */
const MP_POINT_RENEWAL_WINDOW_DAYS = 14;

const MP_POINT_MODE_LABELS = {
  PDV: msg`PDV`,
  STANDALONE: msg`Autónomo`,
};

const MP_POINT_ERROR_MESSAGES = {
  MP_POINT_CREDENTIAL_ABSENT: msg`Conecta la cuenta de Mercado Pago antes de configurar terminales.`,
  MP_POINT_TERMINAL_UNKNOWN: msg`Ese terminal ya no está en la cuenta. Actualiza la lista.`,
  MP_POINT_OAUTH_UNAVAILABLE: msg`Este servidor no está configurado para conectar cuentas de Mercado Pago.`,
  LOCATION_REQUIRED: msg`Elige una sucursal antes de asignar el terminal.`,
  PERMISSION_DENIED: msg`Tu usuario no puede administrar los pagos de este negocio.`,
};

function mpPointErrorMessage(i18n, err) {
  const known = MP_POINT_ERROR_MESSAGES[err && err.code];
  return known ? i18n._(known) : i18n._(msg`No se pudo completar la acción. Intenta de nuevo.`);
}

/**
 * The token's life, in the words of the seller rather than of the OAuth spec.
 *
 * These two take `i18n` and a `msg` descriptor rather than the `t` a component destructures:
 * the `t` macro is bound to the scope that destructures `useLingui()`, so a module-level
 * helper that RECEIVES a `t` gets a runtime call with no message behind it. `i18n._(msg…)`
 * is the form this module already uses for its out-of-component copy (see
 * `pairingErrorMessage`).
 */
function mpPointExpiryLine(i18n, status) {
  const days = status.daysUntilExpiry;
  if (days === null) {
    return status.expiresAt
      ? i18n._(msg`El acceso vence el ${formatDate(status.expiresAt)}`)
      : null;
  }
  const date = formatDate(status.expiresAt);
  if (days < 0) return i18n._(msg`El acceso venció el ${date}`);
  if (days === 0) return i18n._(msg`El acceso vence hoy`);
  if (days === 1) return i18n._(msg`El acceso vence en 1 día (${date})`);
  return i18n._(msg`El acceso vence en ${formatNumber(days)} días (${date})`);
}

/** D8's failure trail, said with its count so an owner can tell one hiccup from a pattern. */
function mpPointRefreshFailure(i18n, status) {
  const date = formatDate(status.refreshFailedAt);
  return status.refreshAttempts === 1
    ? i18n._(msg`La última renovación falló el ${date} (1 intento).`)
    : i18n._(
        msg`La última renovación falló el ${date} (${formatNumber(status.refreshAttempts)} intentos).`,
      );
}

/**
 * ONE TERMINAL, AND THE TWO THINGS THAT DECIDE HOW IT TAKES MONEY.
 *
 * The mode switch and the register share a row because they share a write: the bind route
 * takes the complete binding, so a mode switch that did not restate the register (or the
 * reverse) would be a half-write. A terminal that is not bound to a register yet has
 * nowhere to put a mode — the draft is held here and saved with the binding, which is what
 * the row says out loud rather than pretending the switch already saved something.
 */
const MpPointTerminalRow = ({
  terminal,
  registers,
  locations,
  mode,
  busy,
  onModeChange,
  onRegisterChange,
  onDisconnect,
}) => {
  const { t, i18n } = useLingui();
  const register = (registers || []).find((r) => r.id === terminal.deviceId) || null;
  const bound = Boolean(terminal.deviceId);
  // A terminal the vendor lists as bound to a register this branch's list does not hold is
  // NOT an unbound terminal: it belongs to another register (a branch the operator is not
  // looking at, or one that was renamed away). Saying "sin registro" for it would be a lie,
  // and naming the branch is only worth a chip when we actually know the name.
  const branch = (locations || []).find((l) => l.id === terminal.locationId) || null;
  const registerLabel = register ? register.name : bound ? t`Otro registro` : t`Sin registro`;
  const modeLabel = MP_POINT_MODE_LABELS[terminal.operatingMode];
  return (
    <div className="list-card admin" style={{ padding: '14px 16px 14px 0', alignItems: 'stretch' }}>
      <div className="l-strip" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: 'var(--canvas-2)',
              color: 'var(--umi-navy)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <I.CreditCard size={15} />
          </span>
          <span
            title={terminal.terminalId}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              color: 'var(--ink-1)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {terminal.terminalId}
          </span>
          <span
            className="chip"
            style={{
              fontSize: 10,
              height: 20,
              flexShrink: 0,
              fontWeight: 600,
              letterSpacing: '0.08em',
            }}
          >
            {modeLabel ? i18n._(modeLabel) : terminal.operatingMode}
          </span>
          <span
            className="chip"
            style={{
              fontSize: 10,
              height: 20,
              flexShrink: 0,
              color: register ? undefined : 'var(--ink-3)',
            }}
          >
            {registerLabel}
          </span>
          {!register && branch ? (
            <span className="chip" style={{ fontSize: 10, height: 20, flexShrink: 0 }}>
              {branch.name}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="field-label">
              <Trans>Modo</Trans>
            </span>
            <Segmented
              label={t`Modo de operación del terminal`}
              value={mode}
              options={[
                { id: 'PDV', label: 'PDV' },
                { id: 'STANDALONE', label: i18n._(MP_POINT_MODE_LABELS.STANDALONE) },
              ]}
              onChange={onModeChange}
            />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span className="field-label">
              <Trans>Registro</Trans>
            </span>
            <Select
              className="select"
              style={{ height: 40, minWidth: 170 }}
              value={terminal.deviceId || ''}
              disabled={Boolean(busy)}
              onChange={(event) => {
                const deviceId = event.target.value;
                if (deviceId && deviceId !== terminal.deviceId) onRegisterChange(deviceId);
              }}
            >
              <option value="">{t`Elige un registro`}</option>
              {terminal.deviceId && !register ? (
                <option value={terminal.deviceId}>{t`Otro registro`}</option>
              ) : null}
              {(registers || []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </span>
          {bound && (
            <button
              className="btn btn-ghost btn-sm focusable"
              style={{ color: 'var(--danger)' }}
              disabled={Boolean(busy)}
              onClick={onDisconnect}
            >
              <I.Power size={14} />{' '}
              {busy === 'unbind' ? (
                <Trans>Quitando…</Trans>
              ) : (
                // NOT "Desconectar". That word belongs to the account above, and the two are
                // different acts: this one takes a terminal off a register and leaves the
                // café connected, and an operator who confuses them would unlink an account
                // while meaning to move a device.
                <Trans>Quitar del registro</Trans>
              )}
            </button>
          )}
          {busy ? (
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              <Trans>Guardando…</Trans>
            </span>
          ) : !bound ? (
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              <Trans>El modo se guarda al asignar un registro.</Trans>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const BLANK_MP_POINT_STORE = {
  name: '',
  streetName: '',
  streetNumber: '',
  cityName: '',
  stateName: '',
  latitude: '',
  longitude: '',
  reference: '',
};

/**
 * THE ADDRESS THE VENDOR WILL NOT LET US GUESS — the one form on this screen a person fills.
 *
 * The vendor requires a store before it holds a point of sale, and it validates the address
 * against its own catalogue: `location.city_name` is refused unless it matches a closed list
 * of accented names (research note 01 §6.2, observed live — `Culiacan` refused, `Culiacán`
 * accepted). So the city is FREE TEXT, our own code validates nothing about it, and the ONE
 * thing that corrects a refusal is the vendor's own code coming back — `invalid_city` is a
 * different fix from `invalid_street_number`, and the sheet must say which one it was.
 *
 * Every field except the landmark is required, because the alternative to a required address
 * is a program inventing where a business is: the vendor states the stake itself, that
 * incorrect location data "can cause errors in tax calculations".
 */
export const MpPointStoreSheet = ({ onClose, onCreated }) => {
  const { t, i18n } = useLingui();
  const uid = useId();
  const [form, setForm] = useState(BLANK_MP_POINT_STORE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const firstField = useRef(null);
  const errorRef = useRef(null);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  // A refusal lands BELOW the last field, which on a phone is below the fold — the operator
  // who just pressed the button would be looking at an unchanged screen and conclude nothing
  // happened. The alert is brought into view instead, and `nearest` scrolls only as far as it
  // has to, so a desktop reader who can already see it is not moved.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  // Escape closes, unless a create is in flight — the one keyboard behaviour a panel like
  // this owes the reader.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await createMpPointStore({
        name: form.name.trim(),
        streetName: form.streetName.trim(),
        streetNumber: form.streetNumber.trim(),
        cityName: form.cityName.trim(),
        stateName: form.stateName.trim(),
        // A blank box is NOT 0,0 — that is a real point in the Gulf of Guinea, and the vendor
        // would file it as the business's fiscal address. Blank becomes NaN, which the
        // contract's numeric range refuses; the browser's own `required` is what keeps this
        // from being reachable in the first place.
        latitude: form.latitude.trim() === '' ? Number.NaN : Number(form.latitude),
        longitude: form.longitude.trim() === '' ? Number.NaN : Number(form.longitude),
        reference: form.reference.trim() || null,
      });
      // The card re-reads rather than assuming: what the vendor kept is what the terminal
      // list reports, and the store id a person seeks is the vendor's, not ours.
      onCreated();
    } catch (failure) {
      console.error('[mp-point] store creation failed', failure);
      setError(failure);
      setSaving(false);
    }
  }

  const refusalCode = mpPointStoreRefusalCode(error);

  return (
    <>
      <div className="sheet-backdrop" onClick={saving ? undefined : onClose} />
      <form
        className="sheet"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-store-title`}
      >
        <div className="sheet-head">
          <div className="titles">
            <div className="eyebrow">{t`Mercado Pago Point`}</div>
            <h2 id={`${uid}-store-title`} style={{ margin: '6px 0 0' }}>
              <Trans>Tienda del negocio</Trans>
            </h2>
          </div>
          <button
            type="button"
            className="btn-icon focusable"
            onClick={onClose}
            aria-label={t`Cerrar`}
            disabled={saving}
          >
            <I.X size={18} />
          </button>
        </div>

        <div className="sheet-body">
          <div className="field">
            <label htmlFor={`${uid}-store-name`}>
              <Trans>Nombre del negocio</Trans>
            </label>
            <input
              id={`${uid}-store-name`}
              ref={firstField}
              className="input"
              value={form.name}
              onChange={set('name')}
              required
              maxLength={120}
            />
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label htmlFor={`${uid}-store-street`}>
                <Trans>Calle</Trans>
              </label>
              <input
                id={`${uid}-store-street`}
                className="input"
                value={form.streetName}
                onChange={set('streetName')}
                required
                maxLength={120}
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-store-number`}>
                <Trans>Número</Trans>
              </label>
              {/* A string at the vendor, so it stays a string here: "12-B" is a street number. */}
              <input
                id={`${uid}-store-number`}
                className="input"
                value={form.streetNumber}
                onChange={set('streetNumber')}
                required
                maxLength={20}
              />
            </div>
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label htmlFor={`${uid}-store-city`}>
                <Trans>Ciudad</Trans>
              </label>
              <input
                id={`${uid}-store-city`}
                className="input"
                value={form.cityName}
                onChange={set('cityName')}
                required
                maxLength={80}
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-store-state`}>
                {/* NOT bare "Estado": every other screen in this app uses that word for
                    status, and the shared catalog would hand an English reader "Status" for
                    the vendor's `state_name`. */}
                <Trans>Estado de la dirección</Trans>
              </label>
              <input
                id={`${uid}-store-state`}
                className="input"
                value={form.stateName}
                onChange={set('stateName')}
                required
                maxLength={80}
              />
            </div>
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label htmlFor={`${uid}-store-latitude`}>
                <Trans>Latitud</Trans>
              </label>
              <input
                id={`${uid}-store-latitude`}
                className="input"
                type="number"
                inputMode="decimal"
                step="any"
                min={-90}
                max={90}
                value={form.latitude}
                onChange={set('latitude')}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-store-longitude`}>
                <Trans>Longitud</Trans>
              </label>
              <input
                id={`${uid}-store-longitude`}
                className="input"
                type="number"
                inputMode="decimal"
                step="any"
                min={-180}
                max={180}
                value={form.longitude}
                onChange={set('longitude')}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor={`${uid}-store-reference`}>
              <Trans>Referencia · opcional</Trans>
            </label>
            <input
              id={`${uid}-store-reference`}
              className="input"
              value={form.reference}
              onChange={set('reference')}
              maxLength={160}
            />
          </div>

          {/* One honest line about the ONE validator in this path, and nothing about a
              validation of ours that does not exist: the city is free text and stays as the
              operator typed it, accents and all. */}
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>
            <Trans>
              La dirección la valida Mercado Pago. Si rechaza la ciudad, usa el nombre exacto que
              registra la cuenta.
            </Trans>
          </p>

          {error && (
            <div
              ref={errorRef}
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                flexWrap: 'wrap',
                color: 'var(--danger)',
                background: 'var(--danger-soft)',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 550 }}>
                {mpPointStoreRefusalMessage(i18n, error)}
              </span>
              {refusalCode ? (
                <span
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)' }}
                >
                  {refusalCode}
                </span>
              ) : null}
            </div>
          )}
        </div>

        <div className="sheet-foot">
          <button
            type="button"
            className="btn btn-secondary focusable"
            onClick={onClose}
            disabled={saving}
          >
            <Trans>Cancelar</Trans>
          </button>
          <button type="submit" className="btn btn-primary focusable" disabled={saving}>
            {saving ? <Trans>Creando…</Trans> : <Trans>Crear tienda</Trans>}
          </button>
        </div>
      </form>
    </>
  );
};

/**
 * THE CAFÉ'S STORE, AS THE ACCOUNT'S TERMINALS REPORT IT — and the command that opens one.
 *
 * IT IS DERIVED FROM THE TERMINALS ON PURPOSE. There is no route of ours that reads the
 * vendor's store back, so a terminal reporting a store id is what proves the account has one;
 * the id is shown VERBATIM, because the vendor's store has a name we were never told and
 * inventing one would be a lie. A café with no such terminal is exactly the state the create
 * command exists for.
 *
 * The command hides itself once the store exists: opening a second store with a second fiscal
 * address is the one thing this section must never invite, and the sheet it opens says why the
 * address is the operator's to type.
 */
export const MpPointStoreSection = ({ terminals, onChanged }) => {
  const { t } = useLingui();
  const [storeOpen, setStoreOpen] = useState(false);
  const list = terminals || [];
  const storedTerminals = list.filter((terminal) => Boolean(terminal.storeId));
  const storeId = storedTerminals.length > 0 ? storedTerminals[0].storeId : null;

  return (
    <>
      <div className="eyebrow" style={{ marginTop: 18 }}>
        <Trans>Tienda</Trans>
      </div>
      {storeId ? (
        <div
          className="list-card registered"
          style={{ padding: '14px 18px 14px 0', marginTop: 12, alignItems: 'stretch' }}
        >
          <div className="l-strip" />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <span
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
              <I.Store size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginBottom: 3,
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
                  <Trans>Tienda creada</Trans>
                </span>
                <span
                  className="chip"
                  title={t`Tienda de Mercado Pago`}
                  style={{
                    height: 20,
                    fontSize: 10.5,
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}
                >
                  {storeId}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                <Plural
                  value={storedTerminals.length}
                  one="Este terminal está conciliado con esta tienda."
                  other="Estos # terminales están conciliados con esta tienda."
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="list-card admin"
          style={{ padding: '14px 18px 14px 0', marginTop: 12, alignItems: 'stretch' }}
        >
          <div className="l-strip" />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <span
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
              <I.Store size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
                <Trans>Sin tienda</Trans>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
                <Trans>
                  Mercado Pago pide la dirección del negocio antes de dar de alta la tienda donde
                  cobran los terminales.
                </Trans>
              </div>
            </div>
            <button className="btn btn-primary focusable" onClick={() => setStoreOpen(true)}>
              <I.Plus size={16} /> <Trans>Crear tienda</Trans>
            </button>
          </div>
        </div>
      )}
      {storeOpen && (
        <MpPointStoreSheet
          onClose={() => setStoreOpen(false)}
          // Re-read rather than assume: the store id the operator looks for next is the
          // VENDOR's, and it reaches this screen only through the terminal list.
          onCreated={() => {
            setStoreOpen(false);
            onChanged && onChanged();
          }}
        />
      )}
    </>
  );
};

/**
 * THE CAFÉ'S OWN MERCADO PAGO ACCOUNT, ITS STORE, AND THE TERMINALS IT LISTS — Phase 5.
 *
 * FOUR THINGS, IN ONE PLACE, IN THE ORDER THE OWNER NEEDS THEM: whether an account is
 * connected (and how much life its token has), the connect/reconnect action that changes it,
 * the store the vendor opens the point of sale inside (`MpPointStoreSection`, its own unit
 * because it is a resource of the ACCOUNT rather than of a terminal), and the terminals of
 * that account with the register each one belongs to. The connect action is what makes the
 * rest true: the store and the terminal list are read WITH THE CAFÉ'S TOKEN, so an unconnected
 * café is told to connect rather than being handed a vendor error it cannot act on.
 */
export const MercadoPagoPointCard = ({ refresh, onChanged, registers, locations, branchId }) => {
  const { t, i18n } = useLingui();
  const { data, loading, error, loaded } = useMpPointData(refresh);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  // A mode chosen before a register exists, per terminal. It is a DRAFT and the row says
  // so; it is written by the same call that writes the binding, and dropped once the
  // server's answer is what the list reads from.
  const [draftModes, setDraftModes] = useState({});

  const status = data ? data.status : null;
  const terminals = data ? data.terminals : null;
  const connected = Boolean(status && status.connected);
  const firstLoad = loading && !loaded;
  const refreshFailed = Boolean(status && status.refreshFailedAt);
  const expiryDays = status ? status.daysUntilExpiry : null;

  async function connect() {
    setBusy('connect');
    setActionError(null);
    try {
      const authorization = await getMpPointAuthorization();
      // A FULL navigation, not a fetch: the seller approves at the vendor, and the
      // callback brings the browser back to /devices with the outcome on the query string.
      window.location.assign(authorization.url);
    } catch (failure) {
      console.error('[mp-point] authorization failed', failure);
      setActionError(mpPointErrorMessage(i18n, failure));
      setBusy(null);
    }
  }

  /**
   * STOP CHARGING THIS ACCOUNT. Not `connect`'s inverse in the vendor's own terms — the
   * authorization is revoked at Mercado Pago and the material is erased here — but it is the
   * inverse for the seller, who wants the card method to stop being offered on this café.
   *
   * The server answers with the status AFTER the change, so the reload is not an assumption:
   * `refresh` re-reads, and the screen draws the connect prompt because that is what the
   * account now is.
   */
  async function unlinkAccount() {
    setBusy('unlink');
    setActionError(null);
    try {
      await disconnectMpPointAccount();
      forgetDraftAll();
      onChanged && onChanged();
    } catch (failure) {
      console.error('[mp-point] account unlink failed', failure);
      setActionError(mpPointErrorMessage(i18n, failure));
    } finally {
      setBusy(null);
    }
  }

  /** An unlinked account has no terminals, so every held draft describes nothing. */
  function forgetDraftAll() {
    setDraftModes({});
  }

  function forgetDraft(terminalId) {
    setDraftModes((drafts) => {
      if (!(terminalId in drafts)) return drafts;
      const next = Object.assign({}, drafts);
      delete next[terminalId];
      return next;
    });
  }

  async function bind(terminal, next) {
    const deviceId = next.deviceId || terminal.deviceId;
    const register = (registers || []).find((r) => r.id === deviceId) || null;
    // The register's own location, then the terminal's, then the branch on screen: the
    // route needs a location for the binding and none of the three is a guess about it.
    const locationId = (register && register.locationId) || terminal.locationId || branchId;
    const operatingMode =
      next.operatingMode || draftModes[terminal.terminalId] || terminal.operatingMode;
    if (!deviceId) {
      setActionError(t`Elige un registro para guardar el terminal.`);
      return;
    }
    if (!locationId) {
      setActionError(i18n._(MP_POINT_ERROR_MESSAGES.LOCATION_REQUIRED));
      return;
    }
    setBusy('bind:' + terminal.terminalId);
    setActionError(null);
    try {
      await bindMpPointTerminal(terminal.terminalId, { deviceId, locationId, operatingMode });
      forgetDraft(terminal.terminalId);
      onChanged && onChanged();
    } catch (failure) {
      console.error('[mp-point] terminal bind failed', failure);
      setActionError(mpPointErrorMessage(i18n, failure));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(terminal) {
    setBusy('unbind:' + terminal.terminalId);
    setActionError(null);
    try {
      await unbindMpPointTerminal(terminal.terminalId);
      forgetDraft(terminal.terminalId);
      onChanged && onChanged();
    } catch (failure) {
      console.error('[mp-point] terminal unbind failed', failure);
      setActionError(mpPointErrorMessage(i18n, failure));
    } finally {
      setBusy(null);
    }
  }

  const list = terminals || [];
  const expiryLine = status ? mpPointExpiryLine(i18n, status) : null;
  const expiryTone =
    expiryDays === null
      ? 'var(--ink-3)'
      : expiryDays < 0
        ? 'var(--danger)'
        : expiryDays <= MP_POINT_RENEWAL_WINDOW_DAYS
          ? 'var(--warning)'
          : 'var(--ink-3)';

  return (
    <section className="card fade-up d3" style={{ padding: '18px 22px' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
      >
        <div>
          <div className="eyebrow">{t`Mercado Pago Point`}</div>
          <h2 className="h-section" style={{ marginTop: 4 }}>
            <Trans>Cuenta y terminales</Trans>
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

      {firstLoad ? (
        <p style={{ color: 'var(--ink-3)', margin: '12px 0 0' }}>
          <Trans>Consultando la cuenta…</Trans>
        </p>
      ) : !status ? null : !connected ? (
        <div
          className="list-card"
          style={{ padding: '14px 18px 14px 0', marginTop: 12, alignItems: 'stretch' }}
        >
          <div className="l-strip" />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <span
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
              <I.Wallet size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
                <Trans>Sin conectar</Trans>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
                <Trans>
                  Conecta la cuenta de Mercado Pago que recibe el dinero de este negocio.
                </Trans>
              </div>
            </div>
            <button
              className="btn btn-primary focusable"
              disabled={busy === 'connect'}
              style={{ opacity: busy === 'connect' ? 0.6 : 1 }}
              onClick={connect}
            >
              <I.ArrowRight size={16} />{' '}
              {busy === 'connect' ? <Trans>Abriendo…</Trans> : <Trans>Conectar cuenta</Trans>}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={'list-card ' + (refreshFailed ? 'rotation' : 'registered')}
          style={{ padding: '14px 18px 14px 0', marginTop: 12, alignItems: 'stretch' }}
        >
          <div className="l-strip" />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <span
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
              <I.Wallet size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginBottom: 3,
                }}
              >
                <span className={'s-dot ' + (refreshFailed ? 'slow' : 'live')} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
                  {refreshFailed ? <Trans>Conectado, con avisos</Trans> : <Trans>Conectado</Trans>}
                </span>
                {status.mpUserId ? (
                  <span
                    className="chip"
                    style={{
                      height: 20,
                      fontSize: 10.5,
                      fontFamily: 'var(--font-mono)',
                      flexShrink: 0,
                    }}
                    title={t`Cuenta de Mercado Pago`}
                  >
                    {status.mpUserId}
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 12.5, color: expiryTone }}>
                {expiryLine}
                {refreshFailed ? (
                  <span style={{ color: 'var(--danger)' }}>
                    {expiryLine ? ' · ' : null}
                    {mpPointRefreshFailure(i18n, status)}
                  </span>
                ) : null}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button
                className="btn btn-secondary focusable"
                disabled={busy === 'connect'}
                style={{ opacity: busy === 'connect' ? 0.6 : 1 }}
                onClick={connect}
              >
                <I.Refresh size={14} />{' '}
                {busy === 'connect' ? <Trans>Abriendo…</Trans> : <Trans>Reconectar</Trans>}
              </button>
              <button
                className="btn btn-secondary focusable"
                disabled={busy === 'unlink'}
                style={{ opacity: busy === 'unlink' ? 0.6 : 1 }}
                onClick={unlinkAccount}
                title={t`Dejar de cobrar en la cuenta de este negocio`}
              >
                <I.X size={14} />{' '}
                {busy === 'unlink' ? (
                  <Trans>Desconectando…</Trans>
                ) : (
                  <Trans>Desconectar cuenta</Trans>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* THE STORE COMES BEFORE THE TERMINALS, in the order the work happens: the vendor
          requires the store to exist before it holds a point of sale. */}
      {status && connected ? <MpPointStoreSection terminals={list} onChanged={onChanged} /> : null}

      {/* The list is the ACCOUNT's, so there is nothing honest to say about it until the
          account has been read: a failed status call is not an empty terminal list. */}
      {status ? (
        <>
          <div className="eyebrow" style={{ marginTop: 18 }}>
            <Trans>Terminales</Trans>
          </div>
          {!connected ? (
            <p style={{ color: 'var(--ink-3)', margin: '8px 0 0' }}>
              <Trans>Conecta la cuenta para ver sus terminales.</Trans>
            </p>
          ) : list.length === 0 ? (
            <p style={{ color: 'var(--ink-3)', margin: '8px 0 0' }}>
              <Trans>Esta cuenta de Mercado Pago no tiene terminales.</Trans>
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {list.map((terminal) => {
                const rowBusy =
                  busy === 'bind:' + terminal.terminalId
                    ? 'bind'
                    : busy === 'unbind:' + terminal.terminalId
                      ? 'unbind'
                      : null;
                return (
                  <MpPointTerminalRow
                    key={terminal.terminalId}
                    terminal={terminal}
                    registers={registers}
                    locations={locations}
                    mode={draftModes[terminal.terminalId] || terminal.operatingMode}
                    busy={rowBusy}
                    onModeChange={(mode) => {
                      if (!terminal.deviceId) {
                        // No binding yet, so there is nowhere to write it: the draft is held
                        // and the row says it will be saved with the register. Writing it
                        // would need a register the seller has not chosen.
                        setDraftModes((drafts) =>
                          Object.assign({}, drafts, { [terminal.terminalId]: mode }),
                        );
                        return;
                      }
                      bind(terminal, { operatingMode: mode });
                    }}
                    onRegisterChange={(deviceId) => bind(terminal, { deviceId: deviceId })}
                    onDisconnect={() => disconnect(terminal)}
                  />
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
};

export default DevicesScreen;

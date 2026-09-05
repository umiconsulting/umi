import { useState, useEffect } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { useBusinessHours, saveBusinessHours } from '@/data.jsx';

// Screen 4 — Business Hours & Availability

const DAYS = [
  { id: 'mon', label: msg`Lunes`, abbr: msg`Lun` },
  { id: 'tue', label: msg`Martes`, abbr: msg`Mar` },
  { id: 'wed', label: msg`Miércoles`, abbr: msg`Mié` },
  { id: 'thu', label: msg`Jueves`, abbr: msg`Jue` },
  { id: 'fri', label: msg`Viernes`, abbr: msg`Vie` },
  { id: 'sat', label: msg`Sábado`, abbr: msg`Sáb` },
  { id: 'sun', label: msg`Domingo`, abbr: msg`Dom` },
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
    Object.entries(DEFAULT_HOURS).map(([day, value]) => [day, { ...value }]),
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
  const { t, i18n } = useLingui();
  const { data: hoursData, loading: hoursLoading } = useBusinessHours();
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [savedJson, setSavedJson] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null); // 'saved' | 'error' | null
  // Every control below is seeded from the server payload. None of it holds a
  // literal: this screen used to ship a 45-minute cutoff, a Spanish notice and three
  // real phone numbers as its initial state, so it displayed a bot configuration that
  // nothing had ever read or written — and an operator has no way to tell the two apart.
  const [cutoff, setCutoff] = useState(30);
  const [tz, setTz] = useState('America/Mexico_City');
  const [notice, setNotice] = useState('');
  const [bypass, setBypass] = useState([]);
  const [bypassInput, setBypassInput] = useState('');
  const [confirmPause, setConfirmPause] = useState(null); // {to: bool}

  useEffect(() => {
    if (!hoursData) return;
    const normalized = normalizeHours(hoursData.hours);
    const ord = hoursData.ordering || {};
    const seededCutoff = typeof ord.orderCutoffMinutes === 'number' ? ord.orderCutoffMinutes : 30;
    const seededNotice = ord.specialNotice ?? '';
    const seededBypass = Array.isArray(ord.bypassPhones) ? ord.bypassPhones : [];
    setHours(normalized);
    setCutoff(seededCutoff);
    setNotice(seededNotice);
    setBypass(seededBypass);
    if (hoursData.timezone) setTz(hoursData.timezone);
    if (typeof ord.acceptsOrders === 'boolean') setOrdersPaused(!ord.acceptsOrders);
    setSavedJson(
      JSON.stringify({
        hours: normalized,
        cutoff: seededCutoff,
        notice: seededNotice,
        bypass: seededBypass,
      }),
    );
  }, [hoursData, setOrdersPaused]);

  // Dirty tracking covers everything Save writes. Pause is excluded — it persists on
  // its own confirm, so leaving it here would leave the Save button permanently lit.
  const isDirty =
    savedJson !== null && savedJson !== JSON.stringify({ hours, cutoff, notice, bypass });

  const orderingPayload = () => ({
    acceptsOrders: !ordersPaused,
    orderCutoffMinutes: cutoff,
    specialNotice: notice,
    bypassPhones: bypass,
  });

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveBusinessHours(hours, tz, orderingPayload());
      setSavedJson(JSON.stringify({ hours, cutoff, notice, bypass }));
      setSaveMsg('saved');
      setTimeout(() => setSaveMsg(null), 3000);
    } catch {
      setSaveMsg('error');
    } finally {
      setSaving(false);
    }
  };

  const update = (d, k, v) =>
    setHours((h) => ({ ...h, [d]: { ...(h[d] || DEFAULT_HOURS[d]), [k]: v } }));

  // Only OPEN days receive the copied span. A closed day that silently gained
  // hours would read as open on the next save.
  const copyToAll = (sourceId) =>
    setHours((h) => {
      const src = h[sourceId] || DEFAULT_HOURS[sourceId];
      const next = { ...h };
      for (const d of DAYS) {
        if (d.id === sourceId) continue;
        const day = next[d.id] || DEFAULT_HOURS[d.id];
        if (!day.open) continue;
        next[d.id] = { ...day, from: src.from, to: src.to };
      }
      return next;
    });

  const handlePauseToggle = () => {
    setConfirmPause({ to: !ordersPaused });
  };

  // Pausing is a global action with its own confirmation, so it persists immediately
  // rather than waiting for Save. An ordering-only PATCH — the hours block is omitted,
  // so the server leaves the weekly grid untouched.
  const handlePauseConfirm = async (to) => {
    setOrdersPaused(to);
    setConfirmPause(null);
    try {
      await saveBusinessHours(undefined, undefined, {
        acceptsOrders: !to,
        orderCutoffMinutes: cutoff,
        specialNotice: notice,
        bypassPhones: bypass,
      });
    } catch {
      setSaveMsg('error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Pause banner */}
      <div
        className={'card '}
        style={{
          padding: 0,
          background: ordersPaused ? 'linear-gradient(90deg, #fef3eb, #fceae0)' : undefined,
          borderColor: ordersPaused ? '#f0c79b' : undefined,
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: 4,
            alignSelf: 'stretch',
            background: ordersPaused ? 'var(--warning)' : 'var(--success)',
          }}
        ></div>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '18px 22px', flex: 1 }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: ordersPaused ? 'rgba(181,129,42,0.18)' : 'var(--success-soft)',
              color: ordersPaused ? 'var(--warning)' : 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {ordersPaused ? <I.Pause size={20} /> : <I.WhatsApp size={20} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                className="eyebrow"
                style={{ color: ordersPaused ? 'var(--warning)' : 'var(--success)' }}
              >
                <Trans>ConversaFlow · Pedidos WhatsApp</Trans>
              </span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 16, marginTop: 4 }}>
              {ordersPaused ? (
                <Trans>Los pedidos están en pausa global</Trans>
              ) : (
                <Trans>Pedidos abiertos · se reciben mensajes de WhatsApp</Trans>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>
              {ordersPaused ? (
                <Trans>
                  Los clientes nuevos reciben tu aviso especial. Los pedidos en curso siguen con
                  normalidad.
                </Trans>
              ) : (
                <Trans>
                  Corte activo · los pedidos por WhatsApp se detienen {cutoff} min antes del cierre.
                </Trans>
              )}
            </div>
          </div>
          <button
            className={'btn focusable ' + (ordersPaused ? 'btn-primary' : 'btn-secondary')}
            onClick={handlePauseToggle}
            style={ordersPaused ? { background: 'var(--warning)' } : undefined}
          >
            {ordersPaused ? (
              <>
                <I.Play size={15} /> <Trans>Reanudar pedidos</Trans>
              </>
            ) : (
              <>
                <I.Pause size={15} /> <Trans>Pausar pedidos</Trans>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Hours grid */}
      <div className="split">
        <div className="card" style={{ padding: '22px 22px 14px' }}>
          <div className="ed-head" style={{ marginBottom: 14 }}>
            <div className="titles">
              <h2>
                <Trans>Horas de apertura</Trans>
              </h2>
              <div className="en">
                {hoursLoading ? (
                  <Trans>Cargando…</Trans>
                ) : (
                  <Trans>Cuándo abre y cierra cada día de la semana.</Trans>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <I.Clock size={14} style={{ color: 'var(--ink-3)' }} />
              <select
                aria-label={t`Zona horaria`}
                className="select"
                style={{ height: 36, fontSize: 13, padding: '0 32px 0 12px' }}
                value={tz}
                onChange={(e) => setTz(e.target.value)}
              >
                <option value="America/Mexico_City">America / Mexico_City (GMT−6)</option>
                <option value="America/Monterrey">America / Monterrey (GMT−6)</option>
                <option value="America/Tijuana">America / Tijuana (GMT−7)</option>
                <option value="America/Cancun">America / Cancun (GMT−5)</option>
              </select>
              {isDirty && (
                <button
                  className="btn btn-primary focusable"
                  style={{ height: 36, padding: '0 16px', fontSize: 13 }}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <Trans>Guardando…</Trans>
                  ) : (
                    <>
                      <I.Check size={14} /> <Trans>Guardar</Trans>
                    </>
                  )}
                </button>
              )}
              {saveMsg === 'saved' && !isDirty && (
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--success)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <I.Check size={13} /> <Trans>Guardado</Trans>
                </span>
              )}
              {saveMsg === 'error' && (
                <span style={{ fontSize: 12, color: 'var(--danger)' }}>
                  <Trans>Error al guardar</Trans>
                </span>
              )}
            </div>
          </div>

          <div>
            {DAYS.map((d) => {
              const h = hours[d.id] || DEFAULT_HOURS[d.id];
              const dayName = i18n._(d.label);
              return (
                <div className="day-row" key={d.id}>
                  <div className="dn">
                    {dayName}
                    <small>{i18n._(d.abbr)}</small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      className={'switch ' + (h.open ? 'on' : '')}
                      onClick={() => update(d.id, 'open', !h.open)}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: h.open ? 'var(--ink-1)' : 'var(--ink-3)',
                        minWidth: 50,
                      }}
                    >
                      {h.open ? <Trans>ABIERTO</Trans> : <Trans>CERRADO</Trans>}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="time"
                      aria-label={t`${dayName} · abre`}
                      className="input"
                      style={{
                        height: 38,
                        padding: '0 10px',
                        fontFamily: 'var(--font-mono)',
                        flex: 1,
                      }}
                      value={h.from}
                      disabled={!h.open}
                      onChange={(e) => update(d.id, 'from', e.target.value)}
                    />
                    <span style={{ color: 'var(--ink-3)' }} aria-hidden="true">
                      →
                    </span>
                    <input
                      type="time"
                      aria-label={t`${dayName} · cierra`}
                      className="input"
                      style={{
                        height: 38,
                        padding: '0 10px',
                        fontFamily: 'var(--font-mono)',
                        flex: 1,
                      }}
                      value={h.to}
                      disabled={!h.open}
                      onChange={(e) => update(d.id, 'to', e.target.value)}
                    />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <button
                      className="btn-icon focusable"
                      aria-label={t`Copiar el horario de ${dayName} a los demás días`}
                      title={t`Copiar a los demás días`}
                      disabled={!h.open}
                      onClick={() => copyToAll(d.id)}
                    >
                      <I.Refresh size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right side panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Cutoff */}
          <div className="card" style={{ padding: '22px' }}>
            <div className="eyebrow">ConversaFlow</div>
            <h3 className="h-section" style={{ marginTop: 6, marginBottom: 14, fontSize: 16 }}>
              <Trans>Corte de pedidos</Trans>
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 0, marginBottom: 18 }}>
              <Trans>Deja de aceptar pedidos por WhatsApp estos minutos antes de cerrar.</Trans>
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                className="card-warm"
                style={{
                  padding: '12px 16px',
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                }}
              >
                <div className="display" style={{ fontSize: 32, color: 'var(--ink-warm)' }}>
                  {cutoff}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-warm-soft)' }}>
                  <Trans>min</Trans>
                </div>
              </div>
              <input
                type="range"
                aria-label={t`Minutos antes del cierre para dejar de aceptar pedidos`}
                min={0}
                max={120}
                step={5}
                value={cutoff}
                onChange={(e) => setCutoff(parseInt(e.target.value))}
                style={{
                  flex: 1,
                  height: 6,
                  appearance: 'none',
                  background: `linear-gradient(90deg, var(--umi-navy) ${(cutoff / 120) * 100}%, var(--line-strong) ${(cutoff / 120) * 100}%)`,
                  borderRadius: 3,
                  accentColor: 'var(--umi-navy)',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 8,
                fontSize: 11,
                color: 'var(--ink-3)',
                letterSpacing: '0.06em',
              }}
            >
              <span>
                <Trans>0 MIN</Trans>
              </span>
              <span>
                <Trans>120 MIN</Trans>
              </span>
            </div>
          </div>

          {/* Special notice */}
          <div className="card" style={{ padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <I.Megaphone size={16} style={{ color: 'var(--ink-2)' }} />
              <div className="eyebrow">
                <Trans>Difusión</Trans>
              </div>
            </div>
            <h3 className="h-section" style={{ marginTop: 2, marginBottom: 14, fontSize: 16 }}>
              <Trans>Aviso especial</Trans>
            </h3>
            <textarea
              className="input"
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
              placeholder={t`Mensaje que verán los clientes en su próxima interacción...`}
              style={{ minHeight: 90 }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 8,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                <Trans>
                  Se envía en la próxima interacción del cliente · {notice.length} / 280
                </Trans>
              </span>
              <button
                className="btn-sm btn btn-ghost focusable"
                disabled={!notice}
                onClick={() => setNotice('')}
              >
                <I.X size={13} /> <Trans>Borrar</Trans>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bypass phones */}
      <div className="card" style={{ padding: '22px' }}>
        <div className="ed-head" style={{ marginBottom: 14, paddingBottom: 12 }}>
          <div className="titles">
            {' '}
            <h2>
              <Trans>Teléfonos exentos</Trans>
            </h2>
            <div className="en">
              <Trans>
                Pueden hacer pedidos de prueba aunque el negocio esté cerrado o en pausa.
              </Trans>
            </div>
          </div>
        </div>
        <div className="bypass-zone">
          {bypass.map((p) => (
            <span
              className="chip removable"
              key={p}
              style={{
                height: 32,
                fontFamily: 'var(--font-mono)',
                fontSize: 12.5,
                paddingLeft: 14,
              }}
            >
              {p}
              <button
                className="x focusable"
                onClick={() => setBypass((prev) => prev.filter((x) => x !== p))}
                aria-label={t`Quitar`}
              >
                <I.X size={12} />
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (bypassInput.trim()) {
                setBypass((prev) => [...prev, bypassInput.trim()]);
                setBypassInput('');
              }
            }}
            style={{ display: 'flex', flex: 1, minWidth: 200 }}
          >
            <input
              className="input"
              style={{
                height: 32,
                fontSize: 13,
                border: 'none',
                background: 'transparent',
                flex: 1,
              }}
              placeholder={t`Escribe un teléfono y presiona Enter...`}
              value={bypassInput}
              onChange={(e) => setBypassInput(e.target.value)}
            />
          </form>
        </div>
      </div>

      {confirmPause && (
        <PauseConfirm
          to={confirmPause.to}
          onConfirm={() => handlePauseConfirm(confirmPause.to)}
          onCancel={() => setConfirmPause(null)}
        />
      )}
    </div>
  );
};

const PauseConfirm = ({ to, onConfirm, onCancel }) => (
  <div className="modal-backdrop" onClick={onCancel}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: to ? 'var(--warning-soft)' : 'var(--success-soft)',
            color: to ? 'var(--warning)' : 'var(--success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {to ? <I.AlertTriangle size={20} /> : <I.Play size={20} />}
        </div>
        <div>
          <div className="eyebrow">
            {to ? <Trans>Confirmar pausa</Trans> : <Trans>Reanudar pedidos</Trans>}
          </div>
          <div style={{ fontWeight: 600, fontSize: 17, marginTop: 2 }}>
            {to ? (
              <Trans>¿Pausar los pedidos de WhatsApp en todo el negocio?</Trans>
            ) : (
              <Trans>¿Volver a aceptar pedidos de WhatsApp?</Trans>
            )}
          </div>
        </div>
      </div>
      <p
        style={{
          fontSize: 13.5,
          color: 'var(--ink-2)',
          marginTop: 0,
          marginBottom: 24,
          lineHeight: 1.55,
        }}
      >
        {to ? (
          <Trans>
            Los clientes nuevos recibirán tu aviso especial. <b>Los pedidos en curso</b> siguen con
            normalidad en el KDS. Los teléfonos exentos aún pueden hacer pedidos de prueba. Puedes
            reanudar en cualquier momento.
          </Trans>
        ) : (
          <Trans>
            Los clientes podrán hacer pedidos por WhatsApp otra vez, según tu horario y el corte de
            pedidos.
          </Trans>
        )}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-ghost" onClick={onCancel}>
          <Trans>Cancelar</Trans>
        </button>
        <button
          className={'btn btn-primary'}
          style={to ? { background: 'var(--warning)' } : undefined}
          onClick={onConfirm}
        >
          {to ? <Trans>Pausar pedidos</Trans> : <Trans>Reanudar pedidos</Trans>}
        </button>
      </div>
    </div>
  </div>
);

export default HoursScreen;

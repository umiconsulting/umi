import React, { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatMoneyUnits, formatDateTime } from '@/lib/format.js';
import { RegionHead } from '@/shell.jsx';
import { useOrdersData } from '@/data.jsx';

// Screen 6 — Pedidos / Commercial Orders
// Data: merchant.customer_order (order-writer). Every channel writes here: POS
// (source='pos'), WhatsApp (source='whatsapp'), web, dashboard — ORDER_MODEL §1:
// "The dashboard reads customer_order directly."
//
// Commercial status enum (customer_order.status):
//   placed | preparing | ready | completed | canceled

const ORDER_STATUS_META = {
  placed: { label: msg`Nuevo`, color: 'var(--info)', bg: 'rgba(118,146,203,0.12)' },
  preparing: { label: msg`Preparando`, color: 'var(--warning)', bg: 'var(--warning-soft)' },
  ready: {
    label: msg({ message: 'Listo', context: 'order status' }),
    color: 'var(--success)',
    bg: 'var(--success-soft)',
  },
  completed: { label: msg`Completado`, color: 'var(--ink-3)', bg: 'var(--canvas-2)' },
  canceled: { label: msg`Cancelado`, color: 'var(--danger)', bg: 'var(--danger-soft)' },
};

// Fuller tones for the lifecycle rail DOTS. The muted status tokens (soft periwinkle for
// placed, grey for completed) read washed-out, so completed uses the deep ink instead of
// grey. Only THEME-AWARE tokens here — --umi-navy is not redefined for the dark theme, so
// it would be invisible on a dark canvas; --info/--ink-1/--success/--warning/--danger all
// follow the theme.
const TIMELINE_TONE = {
  placed: 'var(--info)', // theme-aware blue
  preparing: 'var(--warning)', // amber
  ready: 'var(--success)', // green
  completed: 'var(--ink-1)', // deep ink, not grey
  canceled: 'var(--danger)', // red
};

const ACTIVE_STATUSES = ['placed', 'preparing', 'ready'];

// Channel origin of an order. POS and WhatsApp are the two the operator sees today;
// web/dashboard are the console-internal entries.
const CHANNEL_META = {
  pos: { label: 'POS', color: '#6B8F4A', bg: 'rgba(107,143,74,0.12)' },
  whatsapp: { label: 'WhatsApp', color: '#25D366', bg: 'rgba(37,211,102,0.12)' },
  web: { label: 'Web', color: 'var(--info)', bg: 'rgba(118,146,203,0.12)' },
  dashboard: { label: msg`Consola`, color: 'var(--ink-3)', bg: 'var(--canvas-2)' },
};

const CHANNEL_FILTERS = [
  { id: '', label: msg`Todos` },
  { id: 'pos', label: 'POS' },
  { id: 'whatsapp', label: 'WhatsApp' },
];

// How the order is handed off (customer_order.fulfillment_type).
const FULFILLMENT_META = {
  pickup: msg`Para recoger`,
  dine_in: msg`Para comer aquí`,
  delivery: msg`A domicilio`,
};

// Active orders whose current state is still running — the ones that age.
const AGING_WARN_MS = 10 * 60 * 1000;
const AGING_DANGER_MS = 20 * 60 * 1000;

/** Brand names stay as strings; everything else is a message descriptor. */
const text = (i18n, value) => (typeof value === 'string' ? value : i18n._(value));

const OrdersScreen = () => {
  const { t, i18n } = useLingui();
  const [filter, setFilter] = useState('active');
  const [channel, setChannel] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(null);
  const { data: orders, loading } = useOrdersData(filter, refresh, channel);

  const displayed = orders || [];

  // Summary counts across all statuses for the status rail (ignore the channel filter,
  // so the rail stays stable while the list narrows).
  const allOrders = useOrdersData('all', refresh, '').data || [];
  const counts = {};
  allOrders.forEach(function (o) {
    counts[o.status] = (counts[o.status] || 0) + 1;
  });

  const totalToday = allOrders.length;
  const cancelledToday = counts.canceled || 0;
  const totalRevenue = allOrders
    .filter(function (o) {
      return o.status === 'completed' || ACTIVE_STATUSES.indexOf(o.status) !== -1;
    })
    .reduce(function (s, o) {
      // Net of committed refunds/voids, so average ticket reflects money actually kept.
      return s + (parseFloat(o.net_amount ?? o.total_amount) || 0);
    }, 0);

  const activeCount = (counts.placed || 0) + (counts.preparing || 0) + (counts.ready || 0);
  // One status control: the per-status counts and the group shortcuts, merged into a
  // single row of selectable chips (replaces the old status rail + filter tabs).
  const STATUS_FILTERS = [
    { id: 'active', label: t`Activos`, count: activeCount, color: null },
    { id: 'placed', label: t`Nuevos`, count: counts.placed || 0, color: 'var(--info)' },
    {
      id: 'preparing',
      label: t`En preparación`,
      count: counts.preparing || 0,
      color: 'var(--warning)',
    },
    { id: 'ready', label: t`Listos`, count: counts.ready || 0, color: 'var(--success)' },
    { id: 'completed', label: t`Completados`, count: counts.completed || 0, color: 'var(--ink-3)' },
    { id: 'canceled', label: t`Cancelados`, count: counts.canceled || 0, color: 'var(--danger)' },
    { id: 'all', label: t`Todos`, count: totalToday, color: null },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title={t`Pedidos`}
        note={t`${displayed.length} de ${totalToday} mostrados.`}
        count={{ value: totalToday, label: t`hoy` }}
        actions={
          <button
            className="btn btn-ghost btn-sm focusable"
            onClick={() => setRefresh((r) => r + 1)}
          >
            <I.Refresh size={14} /> <Trans>Actualizar</Trans>
          </button>
        }
      />

      {/* One status control — per-status counts and the group shortcuts, merged */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(function (f) {
            var on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 13px',
                  borderRadius: 2,
                  background: on ? 'var(--canvas-2)' : 'transparent',
                  border: '1px solid ' + (on ? 'var(--line-strong)' : 'var(--line)'),
                  cursor: 'pointer',
                }}
              >
                {f.color ? (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: f.color,
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: on ? 'var(--ink-1)' : 'var(--ink-2)',
                  }}
                >
                  {f.count}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: on ? 'var(--ink-2)' : 'var(--ink-3)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>
        {/* Channel filter (order origin) — top-right of the filter row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="seg" role="tablist" aria-label={t`Origen`}>
            {CHANNEL_FILTERS.map(function (f) {
              return (
                <button
                  key={f.id || 'all'}
                  className={channel === f.id ? 'on' : ''}
                  onClick={() => setChannel(f.id)}
                >
                  {text(i18n, f.label)}
                </button>
              );
            })}
          </div>
          {loading && (
            <span
              className="pulse"
              aria-label={t`Cargando…`}
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--umi-blue)',
              }}
            />
          )}
        </div>
      </div>

      {/* Orders list — the day's summary pinned top-right of the container */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 18,
            fontSize: 12.5,
            color: 'var(--ink-3)',
          }}
        >
          <span>
            <Trans>Ticket promedio</Trans>{' '}
            <b style={{ color: 'var(--ink-1)', fontFamily: 'var(--font-mono)' }}>
              ${totalToday > 0 ? Math.round(totalRevenue / Math.max(totalToday, 1)) : '–'}
            </b>
          </span>
          <span>
            <Trans>Cancelaciones</Trans>{' '}
            <b style={{ color: cancelledToday > 0 ? 'var(--danger)' : 'var(--ink-1)' }}>
              {cancelledToday}
            </b>
          </span>
        </div>

        {displayed.length === 0 ? (
          <div
            className="card"
            style={{ padding: '48px 32px', textAlign: 'center', color: 'var(--ink-3)' }}
          >
            <I.Receipt size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
              <Trans>Sin pedidos</Trans>
            </div>
            <div style={{ fontSize: 13 }}>
              <Trans>No hay pedidos en este filtro.</Trans>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayed.map(function (order) {
              return (
                <OrderRow key={order.order_id} order={order} onSelect={() => setSelected(order)} />
              );
            })}
          </div>
        )}
      </div>

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};

const OrderRow = ({ order, onSelect }) => {
  const { t, i18n } = useLingui();
  const meta = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.placed;
  const channel = CHANNEL_META[order.source] || CHANNEL_META.web;
  const isActive = ACTIVE_STATUSES.indexOf(order.status) !== -1;
  const [now] = useState(() => Date.now());

  function fmtAgo(iso) {
    if (!iso) return '—';
    var ms = now - new Date(iso).getTime();
    if (ms < 60000) return Math.floor(ms / 1000) + 's';
    if (ms < 3600000) return Math.floor(ms / 60000) + ' min';
    return Math.floor(ms / 3600000) + 'h';
  }

  return (
    <div
      className={'list-card ' + (isActive ? '' : 'dim')}
      style={{ padding: 0, paddingRight: 18, borderRadius: 0 }}
    >
      {/* Status bar — the solid colour signal (Direction C) */}
      <div className="l-strip" style={{ background: meta.color, borderRadius: 0 }} />
      <div
        style={{
          paddingTop: 16,
          paddingBottom: 16,
          paddingLeft: 18,
          flex: 1,
          display: 'flex',
          gap: 18,
          alignItems: 'center',
        }}
      >
        {/* Status — colour-only caps text; the left bar carries the colour, no fill */}
        <div style={{ width: 96, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: meta.color,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
            }}
          >
            {i18n._(meta.label)}
          </span>
        </div>

        {/* Channel — quiet muted text, no fill */}
        <div style={{ minWidth: 84, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', letterSpacing: '0.03em' }}>
            {text(i18n, channel.label)}
          </span>
        </div>

        {/* Customer */}
        <div style={{ minWidth: 160 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {order.customer_name || t`Sin nombre`}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            {order.customer_phone || '—'}
          </div>
        </div>

        {/* Reference */}
        <div style={{ minWidth: 90 }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>
            <Trans>Ref.</Trans>
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>
            {String(order.public_reference || '').slice(0, 8)}
          </div>
        </div>

        {/* Items */}
        <div style={{ minWidth: 60, textAlign: 'center' }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>
            <Trans>Artículos</Trans>
          </div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {order.items_count ?? itemsCount(order)}
          </div>
        </div>

        {/* Amount */}
        <div style={{ minWidth: 90, textAlign: 'right', marginLeft: 'auto' }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>
            <Trans>Total</Trans>
          </div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 16,
              fontFamily: 'var(--font-display)',
              letterSpacing: '-0.01em',
            }}
          >
            {formatMoneyUnits(
              (order.refunded_amount ?? 0) > 0
                ? (order.net_amount ?? 0)
                : (order.total_amount ?? 0),
            )}
          </div>
          {(order.refunded_amount ?? 0) > 0 ? (
            <div
              style={{ fontSize: 11, color: 'var(--danger)', marginTop: 1 }}
              title={t`Reembolsado`}
            >
              −{formatMoneyUnits(order.refunded_amount)}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>MXN</div>
          )}
        </div>

        {/* Time */}
        <div style={{ minWidth: 52, textAlign: 'right', flexShrink: 0 }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>
            <Trans>Hace</Trans>
          </div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
              color: 'var(--ink-2)',
            }}
          >
            {fmtAgo(order.created_at)}
          </div>
        </div>

        {/* Status is READ-ONLY here: the status is advanced from the kitchen (Cocina/KDS),
            not from the owner's order list. Only the detail entry point remains. */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="btn-icon" onClick={onSelect} aria-label={t`Detalle del pedido`}>
            <I.ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

const OrderDetail = ({ order, onClose }) => {
  const { t, i18n } = useLingui();
  const items = order.items || [];
  const liveItems = items.filter((i) => !i.voided);
  const voidedItems = items.filter((i) => i.voided);
  const discounts = order.discounts || [];
  const channel = CHANNEL_META[order.source] || CHANNEL_META.web;
  const channelLabel = text(i18n, channel.label);
  const statusMeta = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.placed;
  const fulfillment = order.fulfillment_type ? FULFILLMENT_META[order.fulfillment_type] : null;
  const hasDiscount = (order.discount_amount ?? 0) > 0;
  const timeline = buildTimeline(order);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}></div>
      <aside className="sheet">
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">
              <Trans>Pedido · {channelLabel}</Trans>
            </div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              {order.customer_name || t`Sin nombre`}
            </h2>
            {/* Meta strip — status, reference, handoff (were invisible before) */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                marginTop: 10,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: statusMeta.color,
                  background: statusMeta.bg,
                  border: '1px solid ' + statusMeta.color + '40',
                  borderRadius: 8,
                  padding: '3px 9px',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                {i18n._(statusMeta.label)}
              </span>
              {fulfillment && (
                <span
                  style={{
                    fontSize: 11.5,
                    color: 'var(--ink-2)',
                    background: 'var(--canvas-2)',
                    borderRadius: 8,
                    padding: '3px 9px',
                  }}
                >
                  {i18n._(fulfillment)}
                </span>
              )}
              <span
                style={{
                  fontSize: 11.5,
                  color: 'var(--ink-3)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <Trans>Ref.</Trans> {String(order.public_reference || '').slice(0, 8)}
              </span>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="card" style={{ padding: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              <Trans>Cliente</Trans>
            </div>
            <div style={{ fontWeight: 600 }}>{order.customer_name || t`Sin nombre`}</div>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', marginTop: 4 }}>
              {order.customer_phone || '—'}
            </div>
            {order.customer_note && (
              <div style={{ marginTop: 10, color: 'var(--ink-2)' }}>{order.customer_note}</div>
            )}
            {order.pickup_person && (
              <div style={{ marginTop: 10, color: 'var(--ink-2)' }}>
                <Trans>Recoge: {order.pickup_person}</Trans>
              </div>
            )}
          </div>

          {/* Lifecycle — placed → preparing → ready → completed, time in each state */}
          <OrderTimeline timeline={timeline} order={order} i18n={i18n} />

          {/* Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="eyebrow">
              <Trans>Artículos</Trans>
            </div>
            {liveItems.length === 0 && voidedItems.length === 0 ? (
              <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                <Trans>No hay artículos disponibles para este pedido.</Trans>
              </div>
            ) : (
              <>
                {liveItems.map((item) => (
                  <OrderItemLine key={item.item_id} item={item} />
                ))}
                {voidedItems.map((item) => (
                  <OrderItemLine key={item.item_id} item={item} voided i18n={i18n} />
                ))}
              </>
            )}
          </div>

          {/* Money — gross − discount = total (ORDER_MODEL §4) */}
          <div className="card" style={{ padding: 16, marginTop: 6 }}>
            {hasDiscount && (
              <>
                <MoneyRow label={<Trans>Subtotal</Trans>} value={order.gross_amount ?? 0} muted />
                {discounts.length === 0 ? (
                  <MoneyRow
                    label={<Trans>Descuento</Trans>}
                    value={-(order.discount_amount ?? 0)}
                    accent="var(--warning)"
                  />
                ) : (
                  discounts.map((d, idx) => (
                    <MoneyRow
                      key={idx}
                      label={d.label || <Trans>Descuento</Trans>}
                      value={-(d.amount ?? 0)}
                      accent={d.kind === 'comp' ? 'var(--danger)' : 'var(--warning)'}
                    />
                  ))
                )}
                <div
                  style={{ borderTop: '1px solid var(--line)', margin: '10px 0 0', paddingTop: 10 }}
                />
              </>
            )}
            {(order.refunded_amount ?? 0) > 0 && (
              <MoneyRow
                label={<Trans>Reembolsado</Trans>}
                value={-(order.refunded_amount ?? 0)}
                accent="var(--danger)"
              />
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div className="eyebrow">
                {(order.refunded_amount ?? 0) > 0 ? (
                  <Trans>Total neto</Trans>
                ) : (
                  <Trans>Total</Trans>
                )}
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 22,
                  fontFamily: 'var(--font-display)',
                }}
              >
                {formatMoneyUnits(
                  (order.refunded_amount ?? 0) > 0
                    ? (order.net_amount ?? 0)
                    : (order.total_amount ?? 0),
                )}
              </div>
            </div>
          </div>

          {order.status === 'canceled' && order.cancel_reason && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                color: 'var(--danger)',
                fontSize: 12.5,
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger)40',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              <I.AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <Trans>Motivo de cancelación:</Trans> {order.cancel_reason}
              </span>
            </div>
          )}
        </div>
        {/* No status control here: the status is advanced from the kitchen (Cocina/KDS).
            The owner's order view is read-only for the lifecycle. */}
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            <Trans>Cerrar</Trans>
          </button>
        </div>
      </aside>
    </>
  );
};

/** One order line — live or voided — with its modifiers and notes. */
const OrderItemLine = ({ item, voided, i18n }) => {
  const modifiers = item.modifiers || [];
  return (
    <div className="list-card" style={{ padding: 14, opacity: voided ? 0.6 : 1 }}>
      <div style={{ paddingLeft: 14, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <b style={{ textDecoration: voided ? 'line-through' : 'none' }}>
            {item.quantity}× {item.name}
          </b>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>
            {formatMoneyUnits(item.unit_price ?? 0)}
          </span>
        </div>
        {item.variant_name && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
            {item.variant_name}
          </div>
        )}
        {modifiers.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {modifiers.map((m, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontSize: 12,
                  color: 'var(--ink-3)',
                }}
              >
                <span>
                  + {m.quantity > 1 ? m.quantity + '× ' : ''}
                  {m.name}
                </span>
                {m.price_delta !== 0 && (
                  <span style={{ fontFamily: 'var(--font-mono)' }}>
                    {m.price_delta > 0 ? '+' : ''}
                    {formatMoneyUnits(m.price_delta)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {item.notes && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 6 }}>{item.notes}</div>
        )}
        {voided && (
          <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--danger)',
                background: 'var(--danger-soft)',
                borderRadius: 6,
                padding: '2px 6px',
              }}
            >
              {i18n._(msg`Anulado`)}
            </span>
            {item.void_reason && (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{item.void_reason}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** A single money line in the breakdown (subtotal / discount / etc.). */
const MoneyRow = ({ label, value, muted, accent }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
      color: accent || (muted ? 'var(--ink-3)' : 'var(--ink-1)'),
      fontSize: 13,
    }}
  >
    <span>{label}</span>
    <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoneyUnits(value)}</span>
  </div>
);

/** The status spine as a vertical timeline with time-in-state and aging. */
const OrderTimeline = ({ timeline, order, i18n }) => {
  // Captured once (React purity): a still-open state's elapsed time is a snapshot.
  const [now] = useState(() => Date.now());
  if (!timeline || timeline.length === 0) return null;
  const isActive = ACTIVE_STATUSES.indexOf(order.status) !== -1;
  const startMs = timeline[0].at ? new Date(timeline[0].at).getTime() : null;
  const lastMs = timeline[timeline.length - 1].at
    ? new Date(timeline[timeline.length - 1].at).getTime()
    : null;
  const totalMs = startMs != null ? (isActive ? now : (lastMs ?? now)) - startMs : null;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div className="eyebrow">
          <Trans>Ciclo del pedido</Trans>
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <I.Clock size={13} />
          {isActive ? <Trans>Abierto hace</Trans> : <Trans>Duración total</Trans>}{' '}
          <b style={{ color: 'var(--ink-1)', fontFamily: 'var(--font-mono)' }}>
            {fmtDuration(totalMs)}
          </b>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {timeline.map((step, idx) => {
          const meta = ORDER_STATUS_META[step.status] || ORDER_STATUS_META.placed;
          const tone = TIMELINE_TONE[step.status] || meta.color;
          const isLast = idx === timeline.length - 1;
          const stepMs = step.at ? new Date(step.at).getTime() : null;
          const nextMs =
            !isLast && timeline[idx + 1].at ? new Date(timeline[idx + 1].at).getTime() : null;
          // Time spent IN this state: to the next milestone, or (for the current, still-open
          // state of an active order) up to now.
          let durMs = null;
          let ongoing = false;
          if (nextMs != null && stepMs != null) durMs = nextMs - stepMs;
          else if (isLast && isActive && stepMs != null) {
            durMs = now - stepMs;
            ongoing = true;
          }
          const durColor = ongoing ? agingColor(durMs) : 'var(--ink-3)';
          return (
            <div key={idx} style={{ display: 'flex', gap: 12 }}>
              {/* rail: dot + connector */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: '50%',
                    background: tone,
                    boxShadow: '0 0 0 3px var(--surface)',
                    flexShrink: 0,
                    marginTop: 4,
                  }}
                />
                {!isLast && (
                  <span
                    style={{ width: 2, flex: 1, background: 'var(--line-strong)', minHeight: 20 }}
                  />
                )}
              </div>
              {/* content */}
              <div style={{ flex: 1, paddingBottom: isLast ? 0 : 14 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-1)' }}>
                    {i18n._(meta.label)}
                  </span>
                  <span style={{ fontSize: 12, color: durColor, fontFamily: 'var(--font-mono)' }}>
                    {ongoing ? <Trans>en curso · {fmtDuration(durMs)}</Trans> : fmtDuration(durMs)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                  {step.at ? formatDateTime(step.at) : '—'}
                  {step.operator ? ' · ' + step.operator : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function itemsCount(order) {
  return Array.isArray(order.items) ? order.items.filter((i) => !i.voided).length : 0;
}

// Build the lifecycle timeline from the order_event spine. 'placed' always starts at
// placed_at (backfilled orders carry no 'placed' event); each later milestone is the
// FIRST time that status was reached, so a re-fire (preparing after ready) does not
// scramble the line. A current status set without an event still shows, from updated_at.
function buildTimeline(order) {
  const events = Array.isArray(order.events) ? order.events : [];
  const firstByStatus = {};
  events.forEach((e) => {
    if (e.status && !firstByStatus[e.status]) {
      firstByStatus[e.status] = { at: e.occurred_at, operator: e.operator || null };
    }
  });
  const steps = [
    {
      status: 'placed',
      at: order.placed_at || order.created_at || null,
      operator: (firstByStatus.placed && firstByStatus.placed.operator) || null,
    },
  ];
  ['preparing', 'ready', 'completed', 'canceled'].forEach((s) => {
    if (firstByStatus[s]) {
      steps.push({ status: s, at: firstByStatus[s].at, operator: firstByStatus[s].operator });
    }
  });
  if (order.status && order.status !== 'placed' && !firstByStatus[order.status]) {
    steps.push({ status: order.status, at: order.updated_at || null, operator: null });
  }
  return steps;
}

// A coarse, human duration: seconds → minutes → hours → days. Never negative.
function fmtDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    return rem ? h + ' h ' + String(rem).padStart(2, '0') + ' min' : h + ' h';
  }
  const d = Math.floor(h / 24);
  return d + ' d ' + (h % 24) + ' h';
}

// Colour a still-running state by how long it has been sitting — the aging signal.
function agingColor(ms) {
  if (ms == null) return 'var(--ink-3)';
  if (ms >= AGING_DANGER_MS) return 'var(--danger)';
  if (ms >= AGING_WARN_MS) return 'var(--warning)';
  return 'var(--success)';
}

export default OrdersScreen;

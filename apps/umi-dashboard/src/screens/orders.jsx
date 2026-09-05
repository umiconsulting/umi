import React, { useState } from 'react';
import { I } from '@/icons.jsx';
import { RegionHead } from '@/shell.jsx';
import { transitionOrder, useOrdersData } from '@/data.jsx';

// Screen 6 — Pedidos / Commercial Orders
// Data: merchant.customer_order (order-writer). Every channel writes here: POS
// (source='pos'), WhatsApp (source='whatsapp'), web, dashboard — ORDER_MODEL §1:
// "The dashboard reads customer_order directly."
//
// Commercial status enum (customer_order.status):
//   placed | preparing | ready | completed | canceled

const ORDER_STATUS_META = {
  placed: { label: 'Nuevo', color: 'var(--umi-blue)', bg: 'rgba(118,146,203,0.12)' },
  preparing: { label: 'Preparando', color: 'var(--warning)', bg: 'var(--warning-soft)' },
  ready: { label: 'Listo', color: 'var(--success)', bg: 'var(--success-soft)' },
  completed: { label: 'Completado', color: 'var(--ink-3)', bg: 'var(--canvas-2)' },
  canceled: { label: 'Cancelado', color: 'var(--danger)', bg: 'var(--danger-soft)' },
};

const ACTIVE_STATUSES = ['placed', 'preparing', 'ready'];

// Channel origin of an order. POS and WhatsApp are the two the operator sees today;
// web/dashboard are the console-internal entries.
const CHANNEL_META = {
  pos: { label: 'POS', color: '#6B8F4A', bg: 'rgba(107,143,74,0.12)' },
  whatsapp: { label: 'WhatsApp', color: '#25D366', bg: 'rgba(37,211,102,0.12)' },
  web: { label: 'Web', color: 'var(--info)', bg: 'rgba(118,146,203,0.12)' },
  dashboard: { label: 'Consola', color: 'var(--ink-3)', bg: 'var(--canvas-2)' },
};

const CHANNEL_FILTERS = [
  { id: '', label: 'Todos' },
  { id: 'pos', label: 'POS' },
  { id: 'whatsapp', label: 'WhatsApp' },
];

const OrdersScreen = () => {
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
      return s + (parseFloat(o.total_amount) || 0);
    }, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title="Pedidos"
        note={`${displayed.length} de ${totalToday} mostrados.`}
        count={{ value: totalToday, label: 'hoy' }}
        actions={
          <button
            className="btn btn-ghost btn-sm focusable"
            onClick={() => setRefresh((r) => r + 1)}
          >
            <I.Refresh size={14} /> Actualizar
          </button>
        }
      />

      {/* Status summary rail */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { status: 'placed', label: 'Nuevos' },
          { status: 'preparing', label: 'En preparación' },
          { status: 'ready', label: 'Listos' },
          { status: 'completed', label: 'Completados' },
          { status: 'canceled', label: 'Cancelados' },
        ].map(function (item) {
          var meta = ORDER_STATUS_META[item.status];
          var cnt = counts[item.status] || 0;
          return (
            <div
              key={item.status}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderRadius: 10,
                background: meta.bg,
                border: '1px solid ' + meta.color + '33',
                cursor: 'pointer',
              }}
              onClick={() => setFilter(item.status)}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: meta.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: meta.color,
                  letterSpacing: '0.04em',
                }}
              >
                {cnt}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  color: 'var(--ink-2)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 18,
            alignItems: 'center',
            fontSize: 12.5,
            color: 'var(--ink-3)',
          }}
        >
          <span>
            Ticket promedio{' '}
            <b style={{ color: 'var(--ink-1)', fontFamily: 'var(--font-mono)' }}>
              ${totalToday > 0 ? Math.round(totalRevenue / Math.max(totalToday, 1)) : '–'}
            </b>
          </span>
          <span>
            Cancelaciones{' '}
            <b style={{ color: cancelledToday > 0 ? 'var(--danger)' : 'var(--ink-1)' }}>
              {cancelledToday}
            </b>
          </span>
        </div>
      </div>

      {/* Filter tabs + channel filter */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div className="seg" role="tablist">
          {[
            { id: 'active', label: 'Activos' },
            { id: 'completed', label: 'Completados' },
            { id: 'cancelled', label: 'Cancelados' },
            { id: 'all', label: 'Todos' },
          ].map(function (f) {
            return (
              <button
                key={f.id}
                className={filter === f.id ? 'on' : ''}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="seg" role="tablist" aria-label="Origen">
          {CHANNEL_FILTERS.map(function (f) {
            return (
              <button
                key={f.id || 'all'}
                className={channel === f.id ? 'on' : ''}
                onClick={() => setChannel(f.id)}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {loading && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              className="pulse"
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--umi-blue)',
              }}
            />
            Cargando…
          </span>
        )}
      </div>

      {/* Orders list */}
      {displayed.length === 0 ? (
        <div
          className="card"
          style={{ padding: '48px 32px', textAlign: 'center', color: 'var(--ink-3)' }}
        >
          <I.Receipt size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Sin pedidos</div>
          <div style={{ fontSize: 13 }}>No hay pedidos en este filtro.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {displayed.map(function (order) {
            return (
              <OrderRow
                key={order.order_id}
                order={order}
                onSelect={() => setSelected(order)}
                onTransition={async (status) => {
                  await transitionOrder(order.order_id, status);
                  setRefresh((r) => r + 1);
                }}
              />
            );
          })}
        </div>
      )}

      {selected && (
        <OrderDetail
          order={selected}
          onClose={() => setSelected(null)}
          onTransition={async (status) => {
            await transitionOrder(selected.order_id, status);
            setSelected(null);
            setRefresh((r) => r + 1);
          }}
        />
      )}
    </div>
  );
};

const OrderRow = ({ order, onSelect, onTransition }) => {
  const meta = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.placed;
  const channel = CHANNEL_META[order.source] || CHANNEL_META.web;
  const isActive = ACTIVE_STATUSES.indexOf(order.status) !== -1;

  function fmtAgo(iso) {
    if (!iso) return '—';
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return Math.floor(ms / 1000) + 's';
    if (ms < 3600000) return Math.floor(ms / 60000) + ' min';
    return Math.floor(ms / 3600000) + 'h';
  }

  return (
    <div
      className={'list-card ' + (isActive ? '' : 'dim')}
      style={{ padding: 0, paddingRight: 18 }}
    >
      {/* Status strip */}
      <div className="l-strip" style={{ background: meta.color }} />
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
        {/* Status badge */}
        <div
          style={{
            width: 88,
            textAlign: 'center',
            padding: '5px 0',
            borderRadius: 8,
            background: meta.bg,
            border: '1px solid ' + meta.color + '40',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: meta.color,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {meta.label}
          </span>
        </div>

        {/* Channel badge */}
        <div
          style={{
            minWidth: 92,
            textAlign: 'center',
            padding: '5px 0',
            borderRadius: 8,
            background: channel.bg,
            border: '1px solid ' + channel.color + '40',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: channel.color,
              letterSpacing: '0.05em',
            }}
          >
            {channel.label}
          </span>
        </div>

        {/* Customer */}
        <div style={{ minWidth: 160 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{order.customer_name || 'Sin nombre'}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            {order.customer_phone || '—'}
          </div>
        </div>

        {/* Reference */}
        <div style={{ minWidth: 90 }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>
            Ref.
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>
            {String(order.public_reference || '').slice(0, 8)}
          </div>
        </div>

        {/* Items */}
        <div style={{ minWidth: 60, textAlign: 'center' }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>
            Items
          </div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {order.items_count ?? itemsCount(order)}
          </div>
        </div>

        {/* Amount */}
        <div style={{ minWidth: 90, textAlign: 'right', marginLeft: 'auto' }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>
            Total
          </div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 16,
              fontFamily: 'var(--font-display)',
              letterSpacing: '-0.01em',
            }}
          >
            {'$ ' + (order.total_amount ?? 0).toLocaleString('es-MX')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>MXN</div>
        </div>

        {/* Time */}
        <div style={{ minWidth: 52, textAlign: 'right', flexShrink: 0 }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>
            Hace
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

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {order.status === 'placed' && (
            <button className="btn btn-secondary btn-sm" onClick={() => onTransition('preparing')}>
              Cocina
            </button>
          )}
          {order.status === 'preparing' && (
            <button className="btn btn-primary btn-sm" onClick={() => onTransition('ready')}>
              Listo
            </button>
          )}
          {order.status === 'ready' && (
            <button className="btn btn-primary btn-sm" onClick={() => onTransition('completed')}>
              Cerrar
            </button>
          )}
          <button className="btn-icon" onClick={onSelect} aria-label="Order detail">
            <I.ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

const OrderDetail = ({ order, onClose, onTransition }) => {
  const items = order.items || [];
  const channel = CHANNEL_META[order.source] || CHANNEL_META.web;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}></div>
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Pedido · {channel.label}</div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              {order.customer_name || 'Sin nombre'}
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="card" style={{ padding: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Cliente
            </div>
            <div style={{ fontWeight: 600 }}>{order.customer_name || 'Sin nombre'}</div>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', marginTop: 4 }}>
              {order.customer_phone || '—'}
            </div>
            {order.customer_note && (
              <div style={{ marginTop: 10, color: 'var(--ink-2)' }}>{order.customer_note}</div>
            )}
            {order.pickup_person && (
              <div style={{ marginTop: 10, color: 'var(--ink-2)' }}>
                Recoge: {order.pickup_person}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.length === 0 ? (
              <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                No hay items disponibles para este pedido.
              </div>
            ) : (
              items.map((item) => (
                <div key={item.item_id} className="list-card" style={{ padding: 14 }}>
                  <div style={{ paddingLeft: 14, flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <b>
                        {item.quantity}× {item.name}
                      </b>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>
                        {'$ ' + (item.unit_price ?? 0).toLocaleString('es-MX')}
                      </span>
                    </div>
                    {item.variant_name && (
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                        {item.variant_name}
                      </div>
                    )}
                    {item.notes && (
                      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 6 }}>
                        {item.notes}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <div
            style={{
              marginTop: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div className="eyebrow">Total</div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 22,
                fontFamily: 'var(--font-display)',
              }}
            >
              {'$ ' + (order.total_amount ?? 0).toLocaleString('es-MX')}
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
          {order.status !== 'completed' && order.status !== 'canceled' && (
            <button
              className="btn btn-primary"
              onClick={() => onTransition(nextStatus(order.status))}
            >
              Avanzar estado
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

function nextStatus(status) {
  if (status === 'placed') return 'preparing';
  if (status === 'preparing') return 'ready';
  if (status === 'ready') return 'completed';
  return status;
}

function itemsCount(order) {
  return Array.isArray(order.items) ? order.items.length : 0;
}

export default OrdersScreen;

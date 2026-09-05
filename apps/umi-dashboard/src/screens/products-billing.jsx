import React from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { isProductStatusActive } from '@umi/contract/entitlements';
import { I } from '@/icons.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';

const PRODUCT_COPY = {
  dashboard: {
    title: 'Umi Dashboard',
    body: msg`La consola del dueño: cambiar de café, elegir sucursal y administrar la cuenta.`,
    icon: 'Home',
  },
  conversaflow: {
    title: 'ConversaFlow',
    body: msg`Conversaciones de WhatsApp, pedidos automáticos, horarios y flujo de trabajo.`,
    icon: 'WhatsApp',
  },
  kds: {
    title: 'KDS',
    body: msg`Comandas de cocina, estaciones, alta de dispositivos y cambios de estado.`,
    icon: 'Tablet',
  },
  cash: {
    title: 'Umi Cash',
    body: msg`Pases en Wallet, clientes del programa, sellos, abonos y tarjetas de regalo.`,
    icon: 'CreditCard',
  },
  observability: {
    title: msg`Observabilidad`,
    body: msg`Registros de operación, trazas, diagnóstico y revisión de soporte.`,
    icon: 'Activity',
  },
};

/** Entitlement statuses as the owner reads them, not as the table stores them. */
const STATUS_WORDS = {
  active: msg`Activo`,
  trialing: msg`En prueba`,
  past_due: msg`Pago pendiente`,
  canceled: msg`Cancelado`,
  paused: msg`En pausa`,
  missing: msg`Sin contratar`,
};

/** Product names are brands, so they stay as strings; descriptions are messages. */
const text = (i18n, value) => (typeof value === 'string' ? value : value ? i18n._(value) : '');

function ProductCard({ productKey, product }) {
  const { i18n } = useLingui();
  const copy = PRODUCT_COPY[productKey] || { title: productKey, body: '', icon: 'Settings' };
  const Icon = I[copy.icon] || I.Settings;
  const active = isProductStatusActive(product?.status);
  return (
    <div
      className="card"
      style={{ padding: '22px 24px', display: 'flex', gap: 18, alignItems: 'flex-start' }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 12,
          background: active ? 'var(--merchant-brand)' : 'var(--canvas-2)',
          color: active ? '#fff' : 'var(--ink-3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={20} />
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 18 }}>{text(i18n, copy.title)}</h3>
          <span className={'sub-pill' + (active ? '' : ' muted')}>
            <span className="sd" />
            {i18n._(STATUS_WORDS[product?.status] || STATUS_WORDS.missing)}
          </span>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 7, lineHeight: 1.45 }}>
          {text(i18n, copy.body)}
        </div>
        {!active && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12 }}>
            <Trans>Sin este producto activo, la consola no muestra controles para operarlo.</Trans>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductsBillingScreen() {
  const { t } = useLingui();
  const merchantState = useMerchant();
  const merchantName = merchantState?.selectedMerchant?.name || t`este café`;
  const products = merchantState?.capabilities?.products || {};
  const ordered = ['dashboard', 'conversaflow', 'kds', 'cash', 'observability'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="card" style={{ padding: '24px 26px' }}>
        {' '}
        <h2 style={{ margin: '0 0 8px', fontSize: 26 }}>
          <Trans>Productos de {merchantName}</Trans>
        </h2>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 68 * 1 + 'ch' }}>
          <Trans>
            Un producto activo decide qué secciones existen en la consola. El rol de cada persona
            decide qué puede hacer dentro de ellas — pero un rol no activa un producto que falta.
          </Trans>
        </div>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 18 }}
      >
        {ordered.map((productKey) => (
          <ProductCard
            key={productKey}
            productKey={productKey}
            product={products[productKey] || { status: 'missing' }}
          />
        ))}
      </div>
    </div>
  );
}

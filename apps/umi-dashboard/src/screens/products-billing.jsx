import React from 'react';
import { isProductStatusActive } from '@umi/contract/entitlements';
import { I } from '@/icons.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';

const PRODUCT_COPY = {
  dashboard: {
    title: 'Umi Dashboard',
    body: 'La consola del dueño: cambiar de café, elegir sucursal y administrar la cuenta.',
    icon: 'Home',
  },
  conversaflow: {
    title: 'ConversaFlow',
    body: 'Conversaciones de WhatsApp, pedidos automáticos, horarios y flujo de trabajo.',
    icon: 'WhatsApp',
  },
  kds: {
    title: 'KDS',
    body: 'Comandas de cocina, estaciones, alta de dispositivos y cambios de estado.',
    icon: 'Tablet',
  },
  cash: {
    title: 'Umi Cash',
    body: 'Pases en Wallet, clientes del programa, sellos, abonos y tarjetas de regalo.',
    icon: 'CreditCard',
  },
  observability: {
    title: 'Observabilidad',
    body: 'Registros de operación, trazas, diagnóstico y revisión de soporte.',
    icon: 'Activity',
  },
};

/** Entitlement statuses as the owner reads them, not as the table stores them. */
const STATUS_WORDS = {
  active: 'Activo',
  trialing: 'En prueba',
  past_due: 'Pago pendiente',
  canceled: 'Cancelado',
  paused: 'En pausa',
  missing: 'Sin contratar',
};

function ProductCard({ productKey, product }) {
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
          <h3 style={{ margin: 0, fontSize: 18 }}>{copy.title}</h3>
          <span className={'sub-pill' + (active ? '' : ' muted')}>
            <span className="sd" />
            {STATUS_WORDS[product?.status] || STATUS_WORDS.missing}
          </span>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 7, lineHeight: 1.45 }}>
          {copy.body}
        </div>
        {!active && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12 }}>
            Sin este producto activo, la consola no muestra controles para operarlo.
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductsBillingScreen() {
  const merchantState = useMerchant();
  const products = merchantState?.capabilities?.products || {};
  const ordered = ['dashboard', 'conversaflow', 'kds', 'cash', 'observability'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="card" style={{ padding: '24px 26px' }}>
        {' '}
        <h2 style={{ margin: '0 0 8px', fontSize: 26 }}>
          Productos de {merchantState?.selectedMerchant?.name || 'este café'}
        </h2>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 68 * 1 + 'ch' }}>
          Un producto activo decide qué secciones existen en la consola. El rol de cada persona
          decide qué puede hacer dentro de ellas — pero un rol no activa un producto que falta.
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

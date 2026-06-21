import React from 'react'
import { I } from '../icons.jsx'
import { useTenant } from '../lib/tenant-context.jsx'

const PRODUCT_COPY = {
  dashboard: {
    title: 'Umi Dashboard',
    body: 'Owner console, tenant switching, branch context, and account settings.',
    icon: 'Home',
  },
  conversaflow: {
    title: 'ConversaFlow',
    body: 'WhatsApp conversations, ordering automation, hours, and operational workflow.',
    icon: 'WhatsApp',
  },
  kds: {
    title: 'KDS',
    body: 'Kitchen tickets, stations, device provisioning, and status transitions.',
    icon: 'Tablet',
  },
  cash: {
    title: 'Umi Cash',
    body: 'Wallet passes, loyalty members, stamp rewards, top-ups, and gift cards.',
    icon: 'CreditCard',
  },
  observability: {
    title: 'Observability',
    body: 'Operational logs, traces, diagnostics, and support review surfaces.',
    icon: 'Activity',
  },
}

function ProductCard({ productKey, product }) {
  const copy = PRODUCT_COPY[productKey] || { title: productKey, body: '', icon: 'Settings' }
  const Icon = I[copy.icon] || I.Settings
  const active = ['active', 'trialing'].includes(product?.status)
  return (
    <div className="card fade-up" style={{padding:'22px 24px', display:'flex', gap:18, alignItems:'flex-start'}}>
      <div style={{width:46, height:46, borderRadius:12, background: active ? 'var(--tenant-brand)' : 'var(--canvas-2)', color: active ? '#fff' : 'var(--ink-3)', display:'flex', alignItems:'center', justifyContent:'center'}}>
        <Icon size={20}/>
      </div>
      <div style={{flex:1}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12}}>
          <h3 style={{margin:0, fontSize:18}}>{copy.title}</h3>
          <span className={'sub-pill' + (active ? '' : ' muted')}>
            <span className="sd"/>
            {(product?.status || 'missing').toUpperCase()}
          </span>
        </div>
        <div style={{fontSize:13.5, color:'var(--ink-3)', marginTop:7, lineHeight:1.45}}>{copy.body}</div>
        {!active && (
          <div style={{fontSize:12.5, color:'var(--ink-3)', marginTop:12}}>
            No operational controls are exposed while this product is inactive.
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProductsBillingScreen() {
  const tenantState = useTenant()
  const products = tenantState?.capabilities?.products || {}
  const ordered = ['dashboard', 'conversaflow', 'kds', 'cash', 'observability']

  return (
    <div style={{display:'flex', flexDirection:'column', gap:18}}>
      <div className="card fade-up" style={{padding:'24px 26px'}}>
        <div className="sec-index" style={{marginBottom:12}}><span className="nn">PB</span><span>/</span><span>PRODUCTS & BILLING</span></div>
        <h2 style={{margin:'0 0 8px', fontSize:26}}>Product contract for {tenantState?.selectedTenant?.name || 'tenant'}</h2>
        <div style={{fontSize:14, color:'var(--ink-3)', maxWidth:760}}>
          Product status controls which modules exist in the dashboard. Roles decide actions inside active modules, but they do not activate missing products.
        </div>
      </div>

      <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap:18}}>
        {ordered.map(productKey => (
          <ProductCard key={productKey} productKey={productKey} product={products[productKey] || { status: 'missing' }}/>
        ))}
      </div>
    </div>
  )
}

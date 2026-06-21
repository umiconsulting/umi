import React, { useState, useEffect } from 'react'
import { I } from '../icons.jsx'
import { XSep } from '../shell.jsx'
import { useTenantData, saveTenantSettings, saveRewardConfig } from '../data.jsx'
import { useTenant } from '../lib/tenant-context.jsx'

// Screen 5 — Settings (Branding + Loyalty + Promotions)
// Data: useTenantData() → umi-cash GET /api/[slug]/admin/settings + reward-config
// Save: saveTenantSettings(patch) → PATCH /api/[slug]/admin/settings
//       saveRewardConfig(patch)   → PATCH /api/[slug]/admin/reward-config


const DOW = [
  { id: 'dom', l: 'Dom' }, { id: 'lun', l: 'Lun' }, { id: 'mar', l: 'Mar' },
  { id: 'mie', l: 'Mié' }, { id: 'jue', l: 'Jue' }, { id: 'vie', l: 'Vie' }, { id: 'sab', l: 'Sáb' },
];

// promoDays stored as "0,2,4" (getDay() values). Map DOW ids ↔ day numbers.
const DOW_NUM = { dom: '0', lun: '1', mar: '2', mie: '3', jue: '4', vie: '5', sab: '6' };

const PRESET_COLORS = ['#B5605A', '#223979', '#7692CB', '#5B7A4C', '#B5812A', '#1F1410', '#A8463F', '#2D5F8F'];
const MIN_STAMP_TARGET = 1;
const MAX_STAMP_TARGET = 10;
const MAX_REWARD_NAME_LENGTH = 30;

const clampStampTarget = value => Math.max(
  MIN_STAMP_TARGET,
  Math.min(MAX_STAMP_TARGET, parseInt(value, 10) || MIN_STAMP_TARGET)
);

const SettingsScreen = () => {
  const { data: tenant, loading } = useTenantData();
  const tenantState = useTenant();
  const cashActive = tenantState?.isProductActive?.('cash') === true;

  // ── Local editing state ─────────────────────────────────────────────────────
  const [biz, setBiz] = useState(null);
  const [brand, setBrand] = useState(null);
  const [stamps, setStamps] = useState(4);
  const [loyalty, setLoyalty] = useState(null);
  const [birthday, setBirthday] = useState(null);
  const [promo, setPromo] = useState(null);
  const [selfReg, setSelfReg] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  // Populate state from fetched tenant once it arrives
  useEffect(() => {
    if (!tenant) return;
    setBiz({
      name:               tenant.name,
      city:               tenant.city,
      slug:               tenant.slug,
      cardPrefix:         tenant.cardPrefix,
      subscription:       tenant.subscriptionStatus,
    });
    setBrand({
      primary:   tenant.primaryColor   || '#B5605A',
      secondary: tenant.secondaryColor || '#E8C9A3',
      logoUrl: tenant.logoUrl || '',
    });
    setSelfReg(tenant.selfRegistration !== false);
    setBirthday({
      on:          tenant.birthdayRewardEnabled !== false,
      rewardName:  tenant.birthdayRewardName || 'Regalo de cumpleaños',
    });
    const visitsRequired = clampStampTarget(tenant.rewardConfig?.visitsRequired ?? 10);
    setLoyalty(tenant.rewardConfig ? {
      rewardName:     (tenant.rewardConfig.rewardName || '').slice(0, MAX_REWARD_NAME_LENGTH),
      visitsRequired,
      rewardCost:     Math.round(tenant.rewardConfig.rewardCostCentavos / 100),
    } : {
      rewardName:     'Recompensa de temporada',
      visitsRequired,
      rewardCost:     0,
    });
    setStamps(s => Math.min(s, visitsRequired));
    // Parse promoDays "2,3,4" → ['mar','mie','jue']
    const promoNumToId = Object.fromEntries(Object.entries(DOW_NUM).map(([id, n]) => [n, id]));
    const days = tenant.promoDays
      ? tenant.promoDays.split(',').map(n => promoNumToId[n.trim()]).filter(Boolean)
      : ['mar', 'mie', 'jue'];
    setPromo({
      message: tenant.promoMessage || '',
      from:    tenant.promoStartsAt ? tenant.promoStartsAt.slice(0,10) : '2026-05-15',
      to:      tenant.promoEndsAt   ? tenant.promoEndsAt.slice(0,10)   : '2026-06-30',
      days:    days,
    });
  }, [tenant]);

  const toggleDay = id => setPromo(p => ({
    ...p, days: p.days.includes(id) ? p.days.filter(d => d !== id) : [...p.days, id],
  }));

  const setStampTarget = value => {
    const visitsRequired = clampStampTarget(value);
    setLoyalty(l => l ? ({...l, visitsRequired}) : l);
    setStamps(s => Math.min(s, visitsRequired));
  };

  async function handleSave() {
    if (!biz || !brand || !promo) return;
    setSaving(true);
    const promoDayNums = promo.days.map(id => DOW_NUM[id]).filter(Boolean).join(',');
    const [settingsResult] = await Promise.allSettled([
      saveTenantSettings({
        name:               biz.name,
        city:               biz.city,
        primaryColor:       brand.primary,
        secondaryColor:     brand.secondary,
        passStyle:          'stamps',
        promoMessage:       promo.message,
        promoStartsAt:      promo.from ? promo.from + 'T00:00:00.000Z' : null,
        promoEndsAt:        promo.to   ? promo.to   + 'T23:59:59.000Z' : null,
        promoDays:          promoDayNums || null,
        selfRegistration:   selfReg,
        birthdayRewardEnabled: birthday.on,
        birthdayRewardName:    birthday.rewardName,
      }),
      cashActive && loyalty && saveRewardConfig({
        rewardName:          loyalty.rewardName.slice(0, MAX_REWARD_NAME_LENGTH),
        visitsRequired:      loyalty.visitsRequired,
        rewardCostCentavos:  Math.round((loyalty.rewardCost || 0) * 100),
      }),
    ]);
    if (settingsResult.status === 'fulfilled') {
      tenantState?.updateSelectedTenant?.({ name: biz.name });
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // Guard — show skeleton until state is seeded
  if (!biz || !brand || !promo || !birthday || (cashActive && !loyalty)) {
    return (
      <div style={{display:'flex', flexDirection:'column', gap:24}}>
        <div className="card fade-up d1" style={{padding:'40px 26px', textAlign:'center', color:'var(--ink-3)'}}>
          {loading ? 'Cargando ajustes…' : 'Sin datos de configuración.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>

      {/* Save bar */}
      <div className="card fade-up" style={{padding:'12px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16}}>
        <div style={{fontSize:13, color:'var(--ink-2)'}}>
          {saved
            ? <span style={{color:'var(--success)', fontWeight:600}}>✓ Cambios guardados</span>
            : cashActive
              ? 'Los cambios de Cash se guardan solo porque Umi Cash está activo.'
              : 'Cash no está activo: solo se guardan ajustes de negocio y operación.'
          }
        </div>
        <button
          className="btn btn-primary focusable"
          onClick={handleSave}
          disabled={saving}
          style={{opacity: saving ? 0.7 : 1, minWidth:120}}
        >
          {saving ? 'Guardando…' : saved ? <><I.Check size={15}/> Guardado</> : 'Guardar cambios'}
        </button>
      </div>

      {/* Business info */}
      <div className="card fade-up d1" style={{padding:'24px 26px'}}>
        <div className="ed-head" style={{marginBottom:18}}>
          <div className="titles">
            <div className="sec-index"><span className="nn">A</span><span>/</span><span>NEGOCIO</span></div>
            <h2>Información del negocio</h2>
            <div className="en">Business information</div>
          </div>
          <span className="sub-pill">
            <span className="sd"/>
            {biz.subscription} <XSep/> UMI DASH
          </span>
        </div>
        <div className="grid grid-3" style={{gap:18}}>
          <div className="field">
            <label>Business name</label>
            <input className="input tall" value={biz.name} onChange={e => setBiz(b => ({...b, name: e.target.value}))}/>
          </div>
          <div className="field">
            <label>City</label>
            <input className="input tall" value={biz.city || ''} onChange={e => setBiz(b => ({...b, city: e.target.value}))}/>
          </div>
          <div className="field">
            <label>Account status</label>
            <span className="chip read" style={{height:52, fontSize:13, alignSelf:'stretch', justifyContent:'flex-start'}}>
              {(biz.subscription || 'ACTIVE').toUpperCase()} · Managed from Products & Billing
            </span>
          </div>
          <div className="field">
            <label>Slug</label>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span className="chip read" style={{height:44, fontSize:13}}>umi.app/{biz.slug}</span>
              <button className="btn-icon" aria-label="Copy"><I.Refresh size={14}/></button>
            </div>
          </div>
          <div className="field">
            <label>Card prefix</label>
            <span className="chip read" style={{height:44, fontSize:13}}>
              {cashActive ? `${biz.cardPrefix} · • • • •` : 'Unavailable without Umi Cash'}
            </span>
          </div>
          <div className="field">
            <label>Account ID</label>
            <span className="chip read" style={{height:44, fontSize:12, alignSelf:'flex-start', paddingLeft:14, paddingRight:14}}>biz_8a2c4f9e1b6d</span>
          </div>
        </div>
      </div>

      {!cashActive && (
        <div className="card fade-up d2" style={{padding:'24px 26px'}}>
          <div className="ed-head" style={{marginBottom:14}}>
            <div className="titles">
              <div className="sec-index"><span className="nn">B</span><span>/</span><span>PRODUCTOS <XSep/> BILLING</span></div>
              <h2>Umi Cash no está activo</h2>
              <div className="en">Wallet, loyalty, gift cards, and pass personalization are unavailable</div>
            </div>
            <span className="sub-pill"><span className="sd"/> NOT ACTIVE</span>
          </div>
          <div style={{fontSize:14, color:'var(--ink-3)', maxWidth:760}}>
            Kalala tiene activos ConversaFlow y KDS. La configuración de wallet pass, sellos, recompensas, miembros y gift cards queda oculta hasta activar Umi Cash.
          </div>
        </div>
      )}

      {/* Branding + wallet preview */}
      {cashActive && <div className="grid fade-up d2" style={{gridTemplateColumns:'1fr 0.85fr', gap:24}}>
        <div className="card" style={{padding:'24px 26px'}}>
          <div className="ed-head" style={{marginBottom:18}}>
            <div className="titles">
              <div className="sec-index"><span className="nn">B</span><span>/</span><span>MARCA <XSep/> WALLET PASS</span></div>
              <h2>Apariencia de la tarjeta</h2>
              <div className="en">Wallet pass appearance</div>
            </div>
          </div>

          <div className="field" style={{marginBottom:18}}>
            <label>Primary color · card background</label>
            <div style={{display:'flex', alignItems:'center', gap:14}}>
              <input type="color" value={brand.primary} onChange={e => {
                setBrand(b => ({...b, primary: e.target.value}));
                document.documentElement.style.setProperty('--tenant-brand', e.target.value);
              }}/>
              <span className="chip read" style={{height:44, fontFamily:'var(--font-mono)', fontSize:13}}>{brand.primary.toUpperCase()}</span>
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    className={'swatch focusable' + (brand.primary.toLowerCase() === c.toLowerCase() ? ' on' : '')}
                    style={{background:c, width:28, height:28, borderRadius:8}}
                    onClick={() => { setBrand(b => ({...b, primary: c})); document.documentElement.style.setProperty('--tenant-brand', c); }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="field" style={{marginBottom:18}}>
            <label>Secondary color · accents & details</label>
            <div style={{display:'flex', alignItems:'center', gap:14}}>
              <input type="color" value={brand.secondary} onChange={e => setBrand(b => ({...b, secondary: e.target.value}))}/>
              <span className="chip read" style={{height:44, fontFamily:'var(--font-mono)', fontSize:13}}>{brand.secondary.toUpperCase()}</span>
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                {['#E8C9A3','#FFFFFF','#7692CB','#FAF4EC','#C4A882','#1F1410'].map(c => (
                  <button
                    key={c}
                    className={'swatch focusable' + (brand.secondary.toLowerCase() === c.toLowerCase() ? ' on' : '')}
                    style={{background:c, width:28, height:28, borderRadius:8}}
                    onClick={() => setBrand(b => ({...b, secondary: c}))}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
          </div>

          <div style={{borderTop:'1px solid var(--line)', paddingTop:18, marginTop:4}}>
            <div className="sec-index" style={{marginBottom:12}}>
              <span className="nn">C</span><span>/</span><span>SELLOS <XSep/> REWARDCONFIG</span>
            </div>
            <div style={{marginBottom:14}}>
              <h3 style={{margin:'0 0 4px', fontSize:16, lineHeight:1.1}}>Recompensas por sellos</h3>
              <div className="en" style={{fontSize:11, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--ink-3)', fontWeight:600}}>Stamp rewards · RewardConfig</div>
            </div>
            <div className="grid grid-2" style={{gap:14}}>
              <div className="field" style={{gridColumn:'1 / -1'}}>
                <label>Reward name · shown to the customer</label>
                <input
                  className="input tall"
                  value={loyalty.rewardName}
                  maxLength={MAX_REWARD_NAME_LENGTH}
                  onChange={e => setLoyalty(l => ({...l, rewardName: e.target.value.slice(0, MAX_REWARD_NAME_LENGTH)}))}
                />
                <div style={{fontSize:11.5, color:'var(--ink-3)', textAlign:'right'}}>{loyalty.rewardName.length} / {MAX_REWARD_NAME_LENGTH}</div>
              </div>
              <div className="field">
                <label>Visits required</label>
                <input
                  type="number" min={MIN_STAMP_TARGET} max={MAX_STAMP_TARGET}
                  className="input tall"
                  value={loyalty.visitsRequired}
                  onChange={e => setStampTarget(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Reward cost · MXN</label>
                <input
                  type="number" min={0}
                  className="input tall"
                  value={loyalty.rewardCost}
                  onChange={e => setLoyalty(l => ({...l, rewardCost: parseInt(e.target.value) || 0}))}
                />
              </div>
            </div>
          </div>

        </div>

        {/* Wallet pass live preview */}
        <div className="card-warm" style={{padding:'26px 22px', display:'flex', flexDirection:'column', alignItems:'center', gap:18, position:'relative'}}>
          <div style={{position:'absolute', top:18, left:22}}>
            <div className="eyebrow on-warm">Live preview</div>
            <div style={{fontWeight:600, fontSize:13, color:'var(--ink-warm)', marginTop:2}}>iOS wallet pass</div>
          </div>
          <div style={{paddingTop:28}}/>
          <WalletPass
            brand={brand}
            biz={biz}
            stamps={stamps}
            loyalty={loyalty}
            birthday={birthday}
            topupEnabled={tenant.topupEnabled !== false}
          />
          <div style={{display:'flex', alignItems:'center', gap:12, marginTop:6}}>
            <span style={{fontSize:12, color:'var(--ink-warm-soft)'}}>Max stamps</span>
            <input
              type="range" min={MIN_STAMP_TARGET} max={MAX_STAMP_TARGET} step={1}
              value={loyalty.visitsRequired}
              onChange={e => setStampTarget(e.target.value)}
              style={{width:140, accentColor:'var(--umi-navy)'}}
            />
            <span style={{fontSize:12, fontWeight:600, color:'var(--ink-warm)', fontFamily:'var(--font-mono)'}}>{loyalty.visitsRequired} / {MAX_STAMP_TARGET}</span>
          </div>
        </div>
      </div>}

      {/* Birthday config */}
      {cashActive && (
        <div className="card fade-up d3" style={{padding:'24px 26px'}}>
          <div className="ed-head" style={{marginBottom:18}}>
            <div className="titles">
              <div className="sec-index"><span className="nn">D</span><span>/</span><span>CUMPLEAÑOS <XSep/> AUTO</span></div>
              <h2>Boost de cumpleaños</h2>
              <div className="en">Birthday rewards</div>
            </div>
            <div className={'switch lg ' + (birthday.on ? 'on' : '')} onClick={() => setBirthday(b => ({...b, on: !b.on}))}/>
          </div>
          <div className="field">
            <label>Reward name · auto-issued on the customer's birthday</label>
            <input
              className="input tall"
              value={birthday.rewardName}
              onChange={e => setBirthday(b => ({...b, rewardName: e.target.value}))}
              disabled={!birthday.on}
            />
          </div>
          <p style={{fontSize:13, color:'var(--ink-3)', marginTop:10, marginBottom:0}}>
            Sent automatically at 09:00 (local). Valid 7 days. Customers see a notification in WhatsApp.
          </p>
        </div>
      )}

      {/* Promotions */}
      <div className="card fade-up d4" style={{padding:'24px 26px'}}>
        <div className="ed-head" style={{marginBottom:18}}>
          <div className="titles">
            <div className="sec-index"><span className="nn">E</span><span>/</span><span>PROMOCIONES <XSep/> ACTIVA</span></div>
            <h2>Promoción del momento</h2>
            <div className="en">Active promo · Tenant.promoMessage</div>
          </div>
          <button className="btn btn-secondary btn-sm focusable"><I.Plus size={14}/> Nueva</button>
        </div>
        <div className="grid" style={{gridTemplateColumns:'1.4fr 1fr', gap:18}}>
          <div className="field">
            <label>Message · sent on WhatsApp · max 200 chars</label>
            <textarea
              className="input"
              value={promo.message}
              onChange={e => setPromo(p => ({...p, message: e.target.value.slice(0,200)}))}
              style={{minHeight:100}}
              maxLength={200}
            />
            <div style={{fontSize:11.5, color:'var(--ink-3)', textAlign:'right', marginTop:4}}>{promo.message.length} / 200</div>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:14}}>
            <div className="field">
              <label>Active range · Tenant.promoStartsAt → promoEndsAt</label>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <input type="date" className="input" style={{flex:1}} value={promo.from} onChange={e => setPromo(p => ({...p, from: e.target.value}))}/>
                <span style={{color:'var(--ink-4)'}}>→</span>
                <input type="date" className="input" style={{flex:1}} value={promo.to}   onChange={e => setPromo(p => ({...p, to: e.target.value}))}/>
              </div>
            </div>
            <div className="field">
              <label>Days of week · Tenant.promoDays</label>
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                {DOW.map(d => (
                  <button
                    key={d.id}
                    className={'day-pill focusable' + (promo.days.includes(d.id) ? ' on' : '')}
                    onClick={() => toggleDay(d.id)}
                  >{d.l}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Self-registration */}
      {cashActive && <div className="card fade-up d5" style={{padding:'22px 26px', display:'flex', alignItems:'center', gap:20}}>
        <div style={{width:48, height:48, borderRadius:14, background:'var(--canvas-2)', color:'var(--umi-navy)', display:'flex', alignItems:'center', justifyContent:'center'}}>
          <I.Users size={20}/>
        </div>
        <div style={{flex:1}}>
          <div className="eyebrow">Customer onboarding · Tenant.selfRegistration</div>
          <div style={{fontWeight:600, fontSize:16, marginTop:4}}>Self-registration</div>
          <div style={{fontSize:13, color:'var(--ink-3)', marginTop:2}}>
            Customers can join the loyalty program by scanning a QR code at the table, without staff assistance.
          </div>
        </div>
        <div className={'switch lg ' + (selfReg ? 'on' : '')} onClick={() => setSelfReg(s => !s)}/>
      </div>}
    </div>
  );
};

// ── Live wallet pass component ─────────────────────────────────────────────────
const WalletPass = ({ brand, biz, stamps, loyalty, birthday, topupEnabled }) => {
  const remaining = Math.max(0, loyalty.visitsRequired - stamps);
  const logo = normalizeAssetUrl(brand.logoUrl) || assetPath(biz.slug, 'wallet-logo');
  const filledStamp = assetPath(biz.slug, 'stamp-filled');
  const emptyStamp = assetPath(biz.slug, 'stamp-empty');
  const stampCols = loyalty.visitsRequired <= 8 ? 4 : 5;
  const barcode = `${biz.cardPrefix || 'UMI'}-0004821`;

  return (
    <div className="wallet-device" aria-label="iOS Wallet pass preview">
      <div className="wallet-pass" style={{'--wallet-bg': brand.primary, '--wallet-label': brand.secondary || '#FAEBDC'}}>
        <div className="wallet-shine"/>
        <div className="wallet-top">
          <div className="wallet-logo">
            <img src={logo} alt={biz.name} onError={hideBrokenImage}/>
            <span>{biz.name}</span>
          </div>
          {topupEnabled && (
            <div className="wallet-header-field">
              <div>SALDO</div>
              <strong>$245.00</strong>
            </div>
          )}
        </div>

        <div className="wallet-strip" style={{background: brand.secondary || '#EFE0CC'}}>
          <div className="wallet-stamp-grid" style={{gridTemplateColumns: `repeat(${stampCols}, 1fr)`}}>
            {Array.from({length: loyalty.visitsRequired}).map((_, i) => (
              <img
                key={i}
                src={i < stamps ? filledStamp : emptyStamp}
                alt=""
                onError={hideBrokenImage}
              />
            ))}
          </div>
        </div>

        <div className="wallet-fields">
          <PassField label="VISITAS FALTANTES" value={`${remaining} visita${remaining === 1 ? '' : 's'}`}/>
          <PassField label="TIPO DE RECOMPENSA" value={loyalty.rewardName}/>
          {birthday?.on && <PassField label="REGALO DE CUMPLEANOS" value={birthday.rewardName}/>}
        </div>

        <div className="wallet-barcode">
          <FakeQr/>
          <div>{barcode}</div>
        </div>
      </div>
    </div>
  );
};

const PassField = ({ label, value }) => (
  <div className="wallet-field">
    <div>{label}</div>
    <strong>{value}</strong>
  </div>
);

const FakeQr = () => {
  const cells = [
    0,1,2,3,4,6,7,10,12,14,15,16,17,18,
    21,25,28,30,32,35,39,42,43,44,46,48,49,
    51,54,56,57,60,62,64,67,69,70,72,75,77,
    80,81,84,86,88,91,92,94,96,99,101,103,104,
    106,108,111,114,116,118,120,121,123,126,128,
    130,132,134,136,137,138,140,142,144,145,146,147,148,
  ];
  return (
    <svg className="wallet-qr" viewBox="0 0 13 13" aria-hidden="true">
      <rect width="13" height="13" fill="#fff"/>
      {cells.map(cell => (
        <rect key={cell} x={cell % 13} y={Math.floor(cell / 13)} width="1" height="1" fill="#111"/>
      ))}
      <rect x="1" y="1" width="3" height="3" fill="#111"/><rect x="2" y="2" width="1" height="1" fill="#fff"/>
      <rect x="9" y="1" width="3" height="3" fill="#111"/><rect x="10" y="2" width="1" height="1" fill="#fff"/>
      <rect x="1" y="9" width="3" height="3" fill="#111"/><rect x="2" y="10" width="1" height="1" fill="#fff"/>
    </svg>
  );
};

function assetPath(slug, kind) {
  return `/logos/${slug}-${kind}.png`;
}

function normalizeAssetUrl(url) {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

function hideBrokenImage(e) {
  e.currentTarget.style.display = 'none';
}

export default SettingsScreen

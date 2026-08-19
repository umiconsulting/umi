import React, { useState, useEffect, useCallback, useId } from 'react';
import { I } from '@/icons.jsx';
import { XSep } from '@/shell.jsx';
import {
  useMerchantData,
  saveMerchantSettings,
  saveRewardConfig,
  useVoiceConfig,
  saveMerchantVoice,
  getLocationProfiles,
  saveLocationProfile,
  createLocation,
  geocodeAddress,
} from '@/data.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';

// Screen 5 — Settings (Branding + Loyalty + Promotions)
// Data: useMerchantData() → umi-cash GET /api/[merchantRef]/admin/settings + reward-config
// Save: saveMerchantSettings(patch) → PATCH /api/[merchantRef]/admin/settings
//       saveRewardConfig(patch)   → PATCH /api/[merchantRef]/admin/reward-config

const DOW = [
  { id: 'dom', l: 'Dom' },
  { id: 'lun', l: 'Lun' },
  { id: 'mar', l: 'Mar' },
  { id: 'mie', l: 'Mié' },
  { id: 'jue', l: 'Jue' },
  { id: 'vie', l: 'Vie' },
  { id: 'sab', l: 'Sáb' },
];

// promoDays stored as "0,2,4" (getDay() values). Map DOW ids ↔ day numbers.
const DOW_NUM = { dom: '0', lun: '1', mar: '2', mie: '3', jue: '4', vie: '5', sab: '6' };

const PRESET_COLORS = [
  '#B5605A',
  '#223979',
  '#7692CB',
  '#5B7A4C',
  '#B5812A',
  '#1F1410',
  '#A8463F',
  '#2D5F8F',
];

// Mirror of umi-api TONE_PRESETS labels — used only until the live GET resolves.
const VOICE_PRESET_FALLBACK = [
  { key: 'casual', label: 'Casual' },
  { key: 'friendly', label: 'Amigable' },
  { key: 'formal', label: 'Formal' },
];
const MIN_STAMP_TARGET = 1;
const MAX_STAMP_TARGET = 10;
const MAX_REWARD_NAME_LENGTH = 30;

const clampStampTarget = (value) =>
  Math.max(MIN_STAMP_TARGET, Math.min(MAX_STAMP_TARGET, parseInt(value, 10) || MIN_STAMP_TARGET));

const SettingsScreen = () => {
  const uid = useId();
  const [copied, setCopied] = useState(false);

  // Clipboard access can be refused (insecure origin, denied permission). The tick
  // is the receipt: it only appears when the write actually resolved.
  const copyHandle = useCallback(async (handle) => {
    if (!handle) return;
    try {
      await navigator.clipboard.writeText(`umi.app/${handle}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, []);
  const { data: merchant, loading } = useMerchantData();
  const { data: voiceData } = useVoiceConfig();
  const merchantState = useMerchant();
  const cashActive = merchantState?.isProductActive?.('cash') === true;
  const conversaflowActive = merchantState?.isProductActive?.('conversaflow') === true;

  // ── Local editing state ─────────────────────────────────────────────────────
  const [biz, setBiz] = useState(null);
  const [brand, setBrand] = useState(null);
  const [stamps, setStamps] = useState(4);
  const [loyalty, setLoyalty] = useState(null);
  const [birthday, setBirthday] = useState(null);
  const [promo, setPromo] = useState(null);
  const [selfReg, setSelfReg] = useState(true);
  const [voice, setVoice] = useState(null);
  const [bizName, setBizName] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Populate state from fetched merchant once it arrives
  useEffect(() => {
    if (!merchant) return;
    setBiz({
      name: merchant.name,
      city: merchant.city,
      handle: merchant.handle,
      cardPrefix: merchant.cardPrefix,
      subscription: merchant.subscriptionStatus,
    });
    setBrand({
      primary: merchant.primaryColor || '#B5605A',
      secondary: merchant.secondaryColor || '#E8C9A3',
      logoUrl: merchant.logoUrl || '',
    });
    setSelfReg(merchant.selfRegistration !== false);
    setBirthday({
      on: merchant.birthdayRewardEnabled !== false,
      rewardName: merchant.birthdayRewardName || 'Regalo de cumpleaños',
    });
    const visitsRequired = clampStampTarget(merchant.rewardConfig?.visitsRequired ?? 10);
    setLoyalty(
      merchant.rewardConfig
        ? {
            rewardName: (merchant.rewardConfig.rewardName || '').slice(0, MAX_REWARD_NAME_LENGTH),
            visitsRequired,
            rewardCost: Math.round(merchant.rewardConfig.rewardCostCentavos / 100),
          }
        : {
            rewardName: 'Recompensa de temporada',
            visitsRequired,
            rewardCost: 0,
          },
    );
    setStamps((s) => Math.min(s, visitsRequired));
    // Parse promoDays "2,3,4" → ['mar','mie','jue']
    const promoNumToId = Object.fromEntries(Object.entries(DOW_NUM).map(([id, n]) => [n, id]));
    const days = merchant.promoDays
      ? merchant.promoDays
          .split(',')
          .map((n) => promoNumToId[n.trim()])
          .filter(Boolean)
      : ['mar', 'mie', 'jue'];
    setPromo({
      message: merchant.promoMessage || '',
      from: merchant.promoStartsAt ? merchant.promoStartsAt.slice(0, 10) : '2026-05-15',
      to: merchant.promoEndsAt ? merchant.promoEndsAt.slice(0, 10) : '2026-06-30',
      days: days,
    });
  }, [merchant]);

  // Seed the voice editor independently of the cash-gated merchant skeleton, so a
  // conversaflow-only merchant (e.g. Kalala, cashActive=false) still gets its chips.
  useEffect(() => {
    if (!voiceData?.voice) return;
    setVoice({
      tonePreset: voiceData.voice.tone_preset || 'friendly',
      assistantName: voiceData.voice.assistant_name || '',
      customTone: voiceData.voice.tone || '',
      styleNotes: (voiceData.voice.style_notes || []).join('\n'),
    });
    setBizName(voiceData.businessName || voiceData.defaults?.assistant_name || '');
  }, [voiceData]);

  const toggleDay = (id) =>
    setPromo((p) => ({
      ...p,
      days: p.days.includes(id) ? p.days.filter((d) => d !== id) : [...p.days, id],
    }));

  const setStampTarget = (value) => {
    const visitsRequired = clampStampTarget(value);
    setLoyalty((l) => (l ? { ...l, visitsRequired } : l));
    setStamps((s) => Math.min(s, visitsRequired));
  };

  async function handleSave() {
    if (!biz || !brand || !promo) return;
    setSaving(true);
    const promoDayNums = promo.days
      .map((id) => DOW_NUM[id])
      .filter(Boolean)
      .join(',');
    const saveResults = await Promise.allSettled([
      saveMerchantSettings({
        name: biz.name,
        city: biz.city,
        primaryColor: brand.primary,
        secondaryColor: brand.secondary,
        passStyle: 'stamps',
        promoMessage: promo.message,
        promoStartsAt: promo.from ? promo.from + 'T00:00:00.000Z' : null,
        promoEndsAt: promo.to ? promo.to + 'T23:59:59.000Z' : null,
        promoDays: promoDayNums || null,
        selfRegistration: selfReg,
        birthdayRewardEnabled: birthday.on,
        birthdayRewardName: birthday.rewardName,
      }),
      cashActive &&
        loyalty &&
        saveRewardConfig({
          rewardName: loyalty.rewardName.slice(0, MAX_REWARD_NAME_LENGTH),
          visitsRequired: loyalty.visitsRequired,
          rewardCostCentavos: Math.round((loyalty.rewardCost || 0) * 100),
        }),
      // Always send tone + assistant_name together: picking a chip with an empty
      // custom-tone field clears any stale freeform override (preset wins again).
      conversaflowActive &&
        voice &&
        saveMerchantVoice({
          tone_preset: voice.tonePreset,
          assistant_name: voice.assistantName,
          tone: voice.customTone,
          style_notes: voice.styleNotes
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
    ]);
    const [settingsResult] = saveResults;
    if (settingsResult.status === 'fulfilled') {
      merchantState?.updateSelectedMerchant?.({ name: biz.name });
    }
    setSaving(false);
    // Don't flash "Cambios guardados" if any section's save rejected — the user
    // would otherwise lose those edits silently. (Gated `false`/`null` array
    // entries settle as fulfilled, so only real rejections are counted.)
    const failed = saveResults.filter((r) => r.status === 'rejected');
    if (failed.length) {
      console.error(
        'settings save: one or more sections failed',
        failed.map((r) => r.reason),
      );
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // Guard — show skeleton until state is seeded
  if (!biz || !brand || !promo || !birthday || (cashActive && !loyalty)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          className="card fade-up d1"
          style={{ padding: '40px 26px', textAlign: 'center', color: 'var(--ink-3)' }}
        >
          {loading ? 'Cargando ajustes…' : 'Sin datos de configuración.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Save bar */}
      <div
        className="card fade-up"
        style={{
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          {saved ? (
            <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Cambios guardados</span>
          ) : cashActive ? (
            'Los cambios de Cash se guardan solo porque Umi Cash está activo.'
          ) : (
            'Cash no está activo: solo se guardan ajustes de negocio y operación.'
          )}
        </div>
        <button
          className="btn btn-primary focusable"
          onClick={handleSave}
          disabled={saving}
          style={{ opacity: saving ? 0.7 : 1, minWidth: 120 }}
        >
          {saving ? (
            'Guardando…'
          ) : saved ? (
            <>
              <I.Check size={15} /> Guardado
            </>
          ) : (
            'Guardar cambios'
          )}
        </button>
      </div>

      {/* Sucursales — location aliases/descriptor (multi-location, ConversaFlow only) */}
      <LocationProfilesCard conversaflowActive={conversaflowActive} />

      {/* Merchant info */}
      <div className="card fade-up d1" style={{ padding: '24px 26px' }}>
        <div className="ed-head" style={{ marginBottom: 18 }}>
          <div className="titles">
            <div className="sec-index">
              <span className="nn">A</span>
              <span>/</span>
              <span>NEGOCIO</span>
            </div>
            <h2>Información del negocio</h2>
            <div className="en">Información del negocio</div>
          </div>
          <span className="sub-pill">
            <span className="sd" />
            {biz.subscription} <XSep /> UMI DASH
          </span>
        </div>
        <div className="grid grid-3" style={{ gap: 18 }}>
          <div className="field">
            <label htmlFor={`${uid}-business-name`}>Nombre del negocio</label>
            <input
              id={`${uid}-business-name`}
              className="input tall"
              value={biz.name}
              onChange={(e) => setBiz((b) => ({ ...b, name: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-city`}>Ciudad</label>
            <input
              id={`${uid}-city`}
              className="input tall"
              value={biz.city || ''}
              onChange={(e) => setBiz((b) => ({ ...b, city: e.target.value }))}
            />
          </div>
          <div className="field">
            <span className="field-label">Estado de la cuenta</span>
            <span
              className="chip read"
              style={{
                height: 52,
                fontSize: 13,
                alignSelf: 'stretch',
                justifyContent: 'flex-start',
              }}
            >
              {(biz.subscription || 'ACTIVE').toUpperCase()} · Se administra en Productos y
              facturación
            </span>
          </div>
          <div className="field">
            <span className="field-label">Handle</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="chip read" style={{ height: 44, fontSize: 13 }}>
                {biz.handle ? `umi.app/${biz.handle}` : 'Sin dirección publicada'}
              </span>
              <button
                className="btn-icon focusable"
                aria-label="Copiar dirección"
                title="Copiar dirección"
                disabled={!biz.handle}
                onClick={() => copyHandle(biz.handle)}
              >
                {copied ? <I.Check size={14} /> : <I.Receipt size={14} />}
              </button>
            </div>
          </div>
          <div className="field">
            <span className="field-label">Prefijo de tarjeta</span>
            <span className="chip read" style={{ height: 44, fontSize: 13 }}>
              {cashActive ? `${biz.cardPrefix} · • • • •` : 'No disponible sin Umi Cash'}
            </span>
          </div>
          <div className="field">
            <span className="field-label">ID de cuenta</span>
            <span
              className="chip read"
              style={{
                height: 44,
                fontSize: 12,
                alignSelf: 'flex-start',
                paddingLeft: 14,
                paddingRight: 14,
              }}
            >
              biz_8a2c4f9e1b6d
            </span>
          </div>
        </div>
      </div>

      {/* Voice & tone — WhatsApp assistant (ConversaFlow) */}
      {conversaflowActive && voice && (
        <div className="card fade-up d2" style={{ padding: '24px 26px' }}>
          <div className="ed-head" style={{ marginBottom: 18 }}>
            <div className="titles">
              <div className="sec-index">
                <span className="nn">V</span>
                <span>/</span>
                <span>
                  VOZ <XSep /> CONVERSAFLOW
                </span>
              </div>
              <h2>Voz y tono del asistente</h2>
              <div className="en">Voz y tono del asistente de WhatsApp</div>
            </div>
          </div>

          {/* Tone chips — single select */}
          <div className="field" style={{ marginBottom: 18 }}>
            <span className="field-label">Tono · cómo le habla el asistente a tus clientes</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(voiceData?.presets?.length ? voiceData.presets : VOICE_PRESET_FALLBACK).map((p) => (
                <button
                  key={p.key}
                  className={'day-pill focusable' + (voice.tonePreset === p.key ? ' on' : '')}
                  // Picking a chip clears any freeform override so the preset
                  // actually takes effect — the engine gives freeform `tone`
                  // precedence over `tone_preset`, so a stale custom tone would
                  // otherwise make the chip inert.
                  onClick={() => setVoice((v) => ({ ...v, tonePreset: p.key, customTone: '' }))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {voice.customTone.trim() ? (
              <div
                style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8, fontStyle: 'italic' }}
              >
                Usando tono personalizado — anula el chip seleccionado.
              </div>
            ) : (
              voiceData?.presets?.find((p) => p.key === voice.tonePreset)?.description && (
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>
                  {voiceData.presets.find((p) => p.key === voice.tonePreset).description}
                </div>
              )
            )}
          </div>

          {/* Advanced */}
          <div className="grid grid-2" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor={`${uid}-nombre-del-asistente`}>Nombre del asistente · opcional</label>
              <input
                id={`${uid}-nombre-del-asistente`}
                className="input tall"
                value={voice.assistantName}
                placeholder={bizName || 'Asistente'}
                onChange={(e) =>
                  setVoice((v) => ({ ...v, assistantName: e.target.value.slice(0, 60) }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-tono-personalizado-opcional`}>
                Tono personalizado · opcional (anula el chip)
              </label>
              <input
                id={`${uid}-tono-personalizado-opcional`}
                className="input tall"
                value={voice.customTone}
                placeholder="Ej. relajado, con modismos del norte"
                onChange={(e) =>
                  setVoice((v) => ({ ...v, customTone: e.target.value.slice(0, 280) }))
                }
              />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor={`${uid}-notas-de-estilo`}>
                Notas de estilo · una por línea (máx. 8)
              </label>
              <textarea
                id={`${uid}-notas-de-estilo`}
                className="input"
                value={voice.styleNotes}
                onChange={(e) => setVoice((v) => ({ ...v, styleNotes: e.target.value }))}
                style={{ minHeight: 80 }}
              />
            </div>
          </div>
        </div>
      )}

      {!cashActive && (
        <div className="card fade-up d2" style={{ padding: '24px 26px' }}>
          <div className="ed-head" style={{ marginBottom: 14 }}>
            <div className="titles">
              <div className="sec-index">
                <span className="nn">B</span>
                <span>/</span>
                <span>
                  PRODUCTOS <XSep /> BILLING
                </span>
              </div>
              <h2>Umi Cash no está activo</h2>
              <div className="en">
                Wallet, loyalty, gift cards, and pass personalization are unavailable
              </div>
            </div>
            <span className="sub-pill">
              <span className="sd" /> NOT ACTIVE
            </span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 760 }}>
            Kalala tiene activos ConversaFlow y KDS. La configuración de wallet pass, sellos,
            recompensas, miembros y gift cards queda oculta hasta activar Umi Cash.
          </div>
        </div>
      )}

      {/* Branding + wallet preview */}
      {cashActive && (
        <div className="grid fade-up d2" style={{ gridTemplateColumns: '1fr 0.85fr', gap: 24 }}>
          <div className="card" style={{ padding: '24px 26px' }}>
            <div className="ed-head" style={{ marginBottom: 18 }}>
              <div className="titles">
                <div className="sec-index">
                  <span className="nn">B</span>
                  <span>/</span>
                  <span>
                    MARCA <XSep /> WALLET PASS
                  </span>
                </div>
                <h2>Apariencia de la tarjeta</h2>
                <div className="en">Apariencia del pase en Wallet</div>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 18 }}>
              <label htmlFor={`${uid}-primary-color-card`}>
                Color principal · fondo de la tarjeta
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <input
                  id={`${uid}-primary-color-card`}
                  type="color"
                  value={brand.primary}
                  onChange={(e) => {
                    setBrand((b) => ({ ...b, primary: e.target.value }));
                    document.documentElement.style.setProperty('--merchant-brand', e.target.value);
                  }}
                />
                <span
                  className="chip read"
                  style={{ height: 44, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                >
                  {brand.primary.toUpperCase()}
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      className={
                        'swatch focusable' +
                        (brand.primary.toLowerCase() === c.toLowerCase() ? ' on' : '')
                      }
                      style={{ background: c, width: 28, height: 28, borderRadius: 8 }}
                      onClick={() => {
                        setBrand((b) => ({ ...b, primary: c }));
                        document.documentElement.style.setProperty('--merchant-brand', c);
                      }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 18 }}>
              <label htmlFor={`${uid}-secondary-color-accents`}>
                Color secundario · acentos y detalles
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <input
                  id={`${uid}-secondary-color-accents`}
                  type="color"
                  value={brand.secondary}
                  onChange={(e) => setBrand((b) => ({ ...b, secondary: e.target.value }))}
                />
                <span
                  className="chip read"
                  style={{ height: 44, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                >
                  {brand.secondary.toUpperCase()}
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['#E8C9A3', '#FFFFFF', '#7692CB', '#FAF4EC', '#C4A882', '#1F1410'].map((c) => (
                    <button
                      key={c}
                      className={
                        'swatch focusable' +
                        (brand.secondary.toLowerCase() === c.toLowerCase() ? ' on' : '')
                      }
                      style={{ background: c, width: 28, height: 28, borderRadius: 8 }}
                      onClick={() => setBrand((b) => ({ ...b, secondary: c }))}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 18, marginTop: 4 }}>
              <div className="sec-index" style={{ marginBottom: 12 }}>
                <span className="nn">C</span>
                <span>/</span>
                <span>
                  SELLOS <XSep /> REWARDCONFIG
                </span>
              </div>
              <div style={{ marginBottom: 14 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, lineHeight: 1.1 }}>
                  Recompensas por sellos
                </h3>
                <div
                  className="en"
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    fontWeight: 600,
                  }}
                >
                  Stamp rewards · RewardConfig
                </div>
              </div>
              <div className="grid grid-2" style={{ gap: 14 }}>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor={`${uid}-reward-name-shown`}>
                    Nombre del premio · lo ve el cliente
                  </label>
                  <input
                    id={`${uid}-reward-name-shown`}
                    className="input tall"
                    value={loyalty.rewardName}
                    maxLength={MAX_REWARD_NAME_LENGTH}
                    onChange={(e) =>
                      setLoyalty((l) => ({
                        ...l,
                        rewardName: e.target.value.slice(0, MAX_REWARD_NAME_LENGTH),
                      }))
                    }
                  />
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'right' }}>
                    {loyalty.rewardName.length} / {MAX_REWARD_NAME_LENGTH}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor={`${uid}-visits-required`}>Visitas necesarias</label>
                  <input
                    id={`${uid}-visits-required`}
                    type="number"
                    min={MIN_STAMP_TARGET}
                    max={MAX_STAMP_TARGET}
                    className="input tall"
                    value={loyalty.visitsRequired}
                    onChange={(e) => setStampTarget(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${uid}-reward-cost-mxn`}>Costo del premio · MXN</label>
                  <input
                    id={`${uid}-reward-cost-mxn`}
                    type="number"
                    min={0}
                    className="input tall"
                    value={loyalty.rewardCost}
                    onChange={(e) =>
                      setLoyalty((l) => ({ ...l, rewardCost: parseInt(e.target.value) || 0 }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Wallet pass live preview */}
          <div
            className="card-warm"
            style={{
              padding: '26px 22px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 18,
              position: 'relative',
            }}
          >
            <div style={{ position: 'absolute', top: 18, left: 22 }}>
              <div className="eyebrow on-warm">Live preview</div>
              <div
                style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-warm)', marginTop: 2 }}
              >
                iOS wallet pass
              </div>
            </div>
            <div style={{ paddingTop: 28 }} />
            <WalletPass
              brand={brand}
              biz={biz}
              stamps={stamps}
              loyalty={loyalty}
              birthday={birthday}
              topupEnabled={merchant.topupEnabled !== false}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-warm-soft)' }}>Sellos máximos</span>
              <input
                type="range"
                aria-label="Sellos máximos en la tarjeta"
                min={MIN_STAMP_TARGET}
                max={MAX_STAMP_TARGET}
                step={1}
                value={loyalty.visitsRequired}
                onChange={(e) => setStampTarget(e.target.value)}
                style={{ width: 140, accentColor: 'var(--umi-navy)' }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--ink-warm)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {loyalty.visitsRequired} / {MAX_STAMP_TARGET}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Birthday config */}
      {cashActive && (
        <div className="card fade-up d3" style={{ padding: '24px 26px' }}>
          <div className="ed-head" style={{ marginBottom: 18 }}>
            <div className="titles">
              <div className="sec-index">
                <span className="nn">D</span>
                <span>/</span>
                <span>
                  CUMPLEAÑOS <XSep /> AUTO
                </span>
              </div>
              <h2>Boost de cumpleaños</h2>
              <div className="en">Birthday rewards</div>
            </div>
            <div
              className={'switch lg ' + (birthday.on ? 'on' : '')}
              onClick={() => setBirthday((b) => ({ ...b, on: !b.on }))}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-reward-name-auto`}>
              Nombre del premio · se emite solo en el cumpleaños
            </label>
            <input
              id={`${uid}-reward-name-auto`}
              className="input tall"
              value={birthday.rewardName}
              onChange={(e) => setBirthday((b) => ({ ...b, rewardName: e.target.value }))}
              disabled={!birthday.on}
            />
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10, marginBottom: 0 }}>
            Se envía solo a las 09:00 (hora local) y vale 7 días. El cliente recibe un aviso por
            WhatsApp.
          </p>
        </div>
      )}

      {/* Promotions */}
      <div className="card fade-up d4" style={{ padding: '24px 26px' }}>
        <div className="ed-head" style={{ marginBottom: 18 }}>
          <div className="titles">
            <div className="sec-index">
              <span className="nn">E</span>
              <span>/</span>
              <span>
                PROMOCIONES <XSep /> ACTIVA
              </span>
            </div>
            <h2>Promoción del momento</h2>
            <div className="en">Promoción activa</div>
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
          <div className="field">
            <label htmlFor={`${uid}-message-sent-on`}>
              Mensaje · se envía por WhatsApp · máx. 200 caracteres
            </label>
            <textarea
              id={`${uid}-message-sent-on`}
              className="input"
              value={promo.message}
              onChange={(e) => setPromo((p) => ({ ...p, message: e.target.value.slice(0, 200) }))}
              style={{ minHeight: 100 }}
              maxLength={200}
            />
            <div
              style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'right', marginTop: 4 }}
            >
              {promo.message.length} / 200
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor={`${uid}-active-range-business`}>Vigencia · desde / hasta</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id={`${uid}-active-range-business`}
                  type="date"
                  aria-label="Inicio de la vigencia"
                  className="input"
                  style={{ flex: 1 }}
                  value={promo.from}
                  onChange={(e) => setPromo((p) => ({ ...p, from: e.target.value }))}
                />
                <span style={{ color: 'var(--ink-4)' }}>→</span>
                <input
                  type="date"
                  aria-label="Fin de la vigencia"
                  className="input"
                  style={{ flex: 1 }}
                  value={promo.to}
                  onChange={(e) => setPromo((p) => ({ ...p, to: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">Días de la semana</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DOW.map((d) => (
                  <button
                    key={d.id}
                    className={'day-pill focusable' + (promo.days.includes(d.id) ? ' on' : '')}
                    onClick={() => toggleDay(d.id)}
                  >
                    {d.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Self-registration */}
      {cashActive && (
        <div
          className="card fade-up d5"
          style={{ padding: '22px 26px', display: 'flex', alignItems: 'center', gap: 20 }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'var(--canvas-2)',
              color: 'var(--umi-navy)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <I.Users size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="eyebrow">Alta de clientes</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginTop: 4 }}>Self-registration</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
              El cliente entra al programa de lealtad escaneando un código QR en la mesa, sin ayuda
              del personal.
            </div>
          </div>
          <div
            className={'switch lg ' + (selfReg ? 'on' : '')}
            onClick={() => setSelfReg((s) => !s)}
          />
        </div>
      )}
    </div>
  );
};

// ── Live wallet pass component ─────────────────────────────────────────────────
const WalletPass = ({ brand, biz, stamps, loyalty, birthday, topupEnabled }) => {
  const remaining = Math.max(0, loyalty.visitsRequired - stamps);
  const logo = normalizeAssetUrl(brand.logoUrl) || assetPath(biz.handle, 'wallet-logo');
  const filledStamp = assetPath(biz.handle, 'stamp-filled');
  const emptyStamp = assetPath(biz.handle, 'stamp-empty');
  const stampCols = loyalty.visitsRequired <= 8 ? 4 : 5;
  const barcode = `${biz.cardPrefix || 'UMI'}-0004821`;

  return (
    <div className="wallet-device" aria-label="iOS Wallet pass preview">
      <div
        className="wallet-pass"
        style={{ '--wallet-bg': brand.primary, '--wallet-label': brand.secondary || '#FAEBDC' }}
      >
        <div className="wallet-shine" />
        <div className="wallet-top">
          <div className="wallet-logo">
            <img src={logo} alt={biz.name} onError={hideBrokenImage} />
            <span>{biz.name}</span>
          </div>
          {topupEnabled && (
            <div className="wallet-header-field">
              <div>SALDO</div>
              <strong>$245.00</strong>
            </div>
          )}
        </div>

        <div className="wallet-strip" style={{ background: brand.secondary || '#EFE0CC' }}>
          <div
            className="wallet-stamp-grid"
            style={{ gridTemplateColumns: `repeat(${stampCols}, 1fr)` }}
          >
            {Array.from({ length: loyalty.visitsRequired }).map((_, i) => (
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
          <PassField
            label="VISITAS FALTANTES"
            value={`${remaining} visita${remaining === 1 ? '' : 's'}`}
          />
          <PassField label="TIPO DE RECOMPENSA" value={loyalty.rewardName} />
          {birthday?.on && <PassField label="REGALO DE CUMPLEANOS" value={birthday.rewardName} />}
        </div>

        <div className="wallet-barcode">
          <FakeQr />
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
    0, 1, 2, 3, 4, 6, 7, 10, 12, 14, 15, 16, 17, 18, 21, 25, 28, 30, 32, 35, 39, 42, 43, 44, 46, 48,
    49, 51, 54, 56, 57, 60, 62, 64, 67, 69, 70, 72, 75, 77, 80, 81, 84, 86, 88, 91, 92, 94, 96, 99,
    101, 103, 104, 106, 108, 111, 114, 116, 118, 120, 121, 123, 126, 128, 130, 132, 134, 136, 137,
    138, 140, 142, 144, 145, 146, 147, 148,
  ];
  return (
    <svg className="wallet-qr" viewBox="0 0 13 13" aria-hidden="true">
      <rect width="13" height="13" fill="#fff" />
      {cells.map((cell) => (
        <rect key={cell} x={cell % 13} y={Math.floor(cell / 13)} width="1" height="1" fill="#111" />
      ))}
      <rect x="1" y="1" width="3" height="3" fill="#111" />
      <rect x="2" y="2" width="1" height="1" fill="#fff" />
      <rect x="9" y="1" width="3" height="3" fill="#111" />
      <rect x="10" y="2" width="1" height="1" fill="#fff" />
      <rect x="1" y="9" width="3" height="3" fill="#111" />
      <rect x="2" y="10" width="1" height="1" fill="#fff" />
    </svg>
  );
};

// Brand assets are files named for the published handle. A cafe with no handle has no
// such file, so return '' and let the caller fall back rather than fetch /logos/null-*.
function assetPath(handle, kind) {
  return handle ? `/logos/${handle}-${kind}.png` : '';
}

function normalizeAssetUrl(url) {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

function hideBrokenImage(e) {
  e.currentTarget.style.display = 'none';
}

/**
 * A café's branches: where each one is, whether it is open, and what customers
 * call it.
 *
 * ALWAYS RENDERED, and it did not used to be. This card was gated on ConversaFlow
 * and hidden below two locations, because it only held bot nicknames and neither is
 * worth showing for a single café with no bot. It now holds the address, the pin and
 * whether the branch is open — facts a café has whether or not it runs a bot, and a
 * café with one branch is exactly the café that needs to add a second. The old
 * conditions survive where they still apply: the nickname fields.
 */
function LocationProfilesCard({ conversaflowActive }) {
  const [profiles, setProfiles] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    return getLocationProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    let active = true;
    getLocationProfiles()
      .then((rows) => active && setProfiles(rows))
      .catch(() => active && setProfiles([]));
    return () => {
      active = false;
    };
  }, []);

  if (!profiles) return null;
  // Nicknames disambiguate one branch from another, so they need another branch to
  // disambiguate from — and a bot to read them.
  const showAliases = conversaflowActive && profiles.length > 1;

  return (
    // FRAGMENT, and the sheet is OUTSIDE the card on purpose. `.sheet` is
    // `position: fixed`, and `.fade-up` animates a transform — a transformed
    // ancestor becomes the containing block for a fixed descendant, so a sheet
    // rendered inside this card is laid out against the CARD instead of the
    // viewport: a clipped panel a few hundred pixels wide, with its own fields cut
    // off. Staff and Cafés both mount their sheet at screen level; this matches.
    <>
      <div className="card fade-up d2" style={{ padding: '24px 26px' }}>
        <div className="ed-head" style={{ marginBottom: 18 }}>
          <div className="titles">
            <div className="sec-index">
              <span className="nn">S</span>
              <span>/</span>
              <span>SUCURSALES</span>
            </div>
            <h2>Sucursales</h2>
            <div className="en">Branches</div>
          </div>
          <button className="btn btn-secondary btn-sm focusable" onClick={() => setAdding(true)}>
            + Agregar sucursal
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {profiles.map((p) => (
            <LocationProfileRow key={p.id} profile={p} showAliases={showAliases} />
          ))}
        </div>
      </div>
      {adding && (
        <NewLocationSheet
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </>
  );
}

function NewLocationSheet({ onClose, onCreated }) {
  const uid = useId();
  const [form, setForm] = useState({ name: '', address: '', latitude: '', longitude: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const geo = useGeocoder(form.address, (hit) =>
    setForm((f) => ({
      ...f,
      latitude: String(hit.latitude),
      longitude: String(hit.longitude),
    })),
  );
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.name.trim().length > 0;

  async function create() {
    const problem = coordProblem(form);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createLocation({
        name: form.name.trim(),
        address: form.address.trim() || null,
        latitude: coordOrNull(form.latitude),
        longitude: coordOrNull(form.longitude),
      });
      onCreated();
    } catch (e) {
      console.error('location create failed', e);
      setError(e.message || 'No se pudo agregar la sucursal.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}></div>
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Sucursales</div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              Agregar una sucursal
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Cerrar">
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor={`${uid}-nombre`}>Nombre</label>
            <input
              id={`${uid}-nombre`}
              className="input tall"
              placeholder="Chapultepec"
              value={form.name}
              onChange={update('name')}
              maxLength={100}
            />
          </div>
          <AddressFields form={form} update={update} setForm={setForm} geo={geo} />
          {error && (
            <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary focusable"
            disabled={!valid || saving}
            style={{ opacity: valid && !saving ? 1 : 0.5 }}
            onClick={create}
          >
            {saving ? 'Agregando…' : 'Agregar sucursal'}
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * Address, and the pin it resolves to. Shared by the new-branch sheet and the row
 * editor so the two cannot drift — a café should not meet two different address
 * forms in one card.
 *
 * The coordinates are editable text, not a read-out. The geocoder is a donated
 * public gazetteer that does not know every corner in Guadalajara, so the operator
 * must always be able to correct it by hand.
 */
function AddressFields({ form, update, setForm, geo }) {
  const uid = useId();
  const hasPin = Boolean(form.latitude || form.longitude);
  return (
    <>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor={`${uid}-direccion`}>Dirección</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id={`${uid}-direccion`}
            className="input tall"
            style={{ flex: 1 }}
            placeholder="Av. Chapultepec 1, Guadalajara"
            value={form.address}
            onChange={update('address')}
            maxLength={200}
          />
          <button
            className="btn btn-secondary"
            onClick={geo.run}
            disabled={geo.busy || form.address.trim().length < 3}
          >
            {geo.busy ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        {geo.message && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }} role="status">
            {geo.message}
          </div>
        )}
      </div>
      {/* The pin is subordinate to the address, and sized to say so: one short line
          of two small fields, not a second full-width form. An operator types an
          address; the coordinates are what the address resolved to, and are here to
          be corrected rather than composed. */}
      <div
        className="field"
        style={{ margin: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <label style={{ margin: 0, minWidth: 26 }}>Pin</label>
        <input
          className="input"
          inputMode="decimal"
          aria-label="Latitud"
          placeholder="20.6736"
          value={form.latitude}
          onChange={update('latitude')}
          style={{ width: 118, height: 32, fontSize: 12.5 }}
        />
        <input
          className="input"
          inputMode="decimal"
          aria-label="Longitud"
          placeholder="-103.3440"
          value={form.longitude}
          onChange={update('longitude')}
          style={{ width: 118, height: 32, fontSize: 12.5 }}
        />
        {hasPin && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setForm((f) => ({ ...f, latitude: '', longitude: '' }))}
          >
            Quitar
          </button>
        )}
      </div>
    </>
  );
}

/**
 * The "Buscar" button's state machine, in one place.
 *
 * A miss is reported as a sentence, not an error: the endpoint answers 200 with a
 * null body when the gazetteer has nothing, because not finding an address is an
 * answer and the operator can type the pin regardless.
 */
function useGeocoder(address, onHit) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const hit = await geocodeAddress(address.trim());
      if (hit) {
        onHit(hit);
        setMessage(hit.formattedAddress);
      } else {
        setMessage('No encontramos esa dirección. Puedes escribir el pin a mano.');
      }
    } catch (e) {
      console.error('geocode failed', e);
      setMessage('No se pudo buscar ahora. Puedes escribir el pin a mano.');
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, run };
}

/** '' → null, so an empty coordinate clears the pin instead of writing 0. */
function coordOrNull(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Why this form cannot be saved, or null.
 *
 * A coordinate box holding something that is not a number used to save as `null`,
 * which CLEARS the pin — so a typo silently deleted the branch's location and
 * reported success. Refusing the save is the honest answer: the operator can see
 * what they typed and fix it.
 *
 * The ranges are the ones the schema and `@IsLatitude`/`@IsLongitude` enforce, so a
 * number that would come back 400 is caught here with a sentence instead.
 */
function coordProblem(form) {
  const pairs = [
    ['latitude', 'La latitud', 90],
    ['longitude', 'La longitud', 180],
  ];
  for (const [key, label, limit] of pairs) {
    const t = String(form[key] ?? '').trim();
    if (!t) continue;
    const n = Number(t);
    if (!Number.isFinite(n)) return `${label} debe ser un número.`;
    if (Math.abs(n) > limit) return `${label} debe estar entre -${limit} y ${limit}.`;
  }
  return null;
}

/**
 * One branch, editable in place.
 *
 * WHAT IS SENT IS WHAT CHANGED. The patch below carries only the fields this row
 * actually edited, and that is load-bearing rather than tidy: `PATCH .../locations`
 * reads an absent field as "leave it alone" and an explicit null as "clear it", so
 * a row that posted every field on every save would clear the ones it never showed.
 */
function LocationProfileRow({ profile, showAliases }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  /**
   * WHAT IS ON THE SERVER, as far as this row knows.
   *
   * Not `profile`, which is the list's last fetch and never changes again. `dirty`
   * is measured against this, so a saved row stops reporting itself unsaved — it
   * used to keep saying "Sin guardar" about a change that had just landed, because
   * the only thing it could compare against was the value it started with. The PATCH
   * returns the stored row, so this is the server's answer, not an assumption.
   */
  const [base, setBase] = useState(profile);
  const [form, setForm] = useState({
    name: profile.name || '',
    address: profile.address || '',
    latitude: profile.latitude == null ? '' : String(profile.latitude),
    longitude: profile.longitude == null ? '' : String(profile.longitude),
  });
  const [status, setStatus] = useState(profile.status || 'active');
  const [aliases, setAliases] = useState(profile.aliases || []);
  const [descriptor, setDescriptor] = useState(profile.descriptor || '');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const geo = useGeocoder(form.address, (hit) =>
    setForm((f) => ({ ...f, latitude: String(hit.latitude), longitude: String(hit.longitude) })),
  );
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const baseLat = base.latitude == null ? '' : String(base.latitude);
  const baseLng = base.longitude == null ? '' : String(base.longitude);
  const dirty =
    form.name.trim() !== (base.name || '') ||
    form.address.trim() !== (base.address || '') ||
    form.latitude.trim() !== baseLat ||
    form.longitude.trim() !== baseLng ||
    status !== (base.status || 'active') ||
    JSON.stringify(aliases) !== JSON.stringify(base.aliases || []) ||
    descriptor !== (base.descriptor || '');

  function addAlias(v) {
    const t = (v || '').trim();
    setDraft('');
    if (!t || aliases.some((a) => a.toLowerCase() === t.toLowerCase())) return;
    setAliases(aliases.concat(t).slice(0, 24));
  }
  function removeAlias(i) {
    setAliases(aliases.filter((_, idx) => idx !== i));
  }

  async function save() {
    const problem = coordProblem(form);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const patch = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        latitude: coordOrNull(form.latitude),
        longitude: coordOrNull(form.longitude),
        status,
      };
      // Only when this row is showing them. Sending [] and '' from a row that never
      // rendered the fields would erase nicknames a bot depends on.
      if (showAliases) {
        patch.aliases = aliases;
        patch.descriptor = descriptor.trim() || null;
      }
      const stored = await saveLocationProfile(profile.id, patch);
      // The row it actually stored, so `dirty` measures against the server from here.
      if (stored) setBase(stored);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('location save failed', e);
      setError(e.message || 'No se pudo guardar. Reintenta.');
    } finally {
      setSaving(false);
    }
  }

  const closed = status === 'closed';

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: open ? 16 : '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: open ? 12 : 0,
      }}
    >
      {/* CLOSED BY DEFAULT, and that is the point. A branch is read far more often
          than it is edited, so the resting state is one line that answers where it
          is and whether it is open. A café with five branches gets a list; the old
          card gave it five stacked forms.

          The SAME line carries the editor when open — the name becomes the field
          that edits it, rather than a heading repeating what the field below says. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {open ? (
          <input
            className="input"
            aria-label="Nombre de la sucursal"
            value={form.name}
            onChange={update('name')}
            maxLength={100}
            style={{ width: 240, height: 34, fontWeight: 600 }}
          />
        ) : (
          <div style={{ fontWeight: 600, fontSize: 14, opacity: closed ? 0.6 : 1 }}>
            {form.name || profile.name}
          </div>
        )}
        {open ? (
          <div className="seg">
            <button className={!closed ? 'on' : ''} onClick={() => setStatus('active')}>
              Abierta
            </button>
            <button className={closed ? 'on' : ''} onClick={() => setStatus('closed')}>
              Cerrada
            </button>
          </div>
        ) : (
          closed && (
            <span className="chip read" style={{ fontSize: 11 }}>
              Cerrada
            </span>
          )
        )}
        <div
          style={{
            flex: 1,
            fontSize: 12.5,
            color: 'var(--ink-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {open ? '' : form.address || 'Sin dirección'}
        </div>
        {!open && dirty && (
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Sin guardar</span>
        )}
        {open && error && (
          <span role="alert" style={{ color: '#c0392b', fontSize: 12 }}>
            {error}
          </span>
        )}
        {open && (
          <button className="btn btn-secondary btn-sm" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Guardando…' : saved ? '✓ Guardado' : error ? 'Reintentar' : 'Guardar'}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Cerrar' : 'Editar'}
        </button>
      </div>

      {open && (
        <>
          <AddressFields form={form} update={update} setForm={setForm} geo={geo} />
          {showAliases && (
            <>
              <div className="field" style={{ margin: 0 }}>
                <span className="field-label">Apodos (cómo la llaman los clientes)</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {aliases.map((a, i) => (
                    <span
                      key={i}
                      className="chip"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      {a}
                      <button
                        onClick={() => removeAlias(i)}
                        aria-label={'Quitar ' + a}
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          color: 'var(--ink-3)',
                          fontSize: 15,
                          lineHeight: 1,
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addAlias(draft);
                      }
                    }}
                    onBlur={() => addAlias(draft)}
                    placeholder="+ apodo"
                    maxLength={40}
                    style={{ width: 150, height: 32, fontSize: 12.5 }}
                  />
                </div>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor={`${uid}-descripcion-zona-referencia`}>
                  Descripción (zona / referencia)
                </label>
                <input
                  id={`${uid}-descripcion-zona-referencia`}
                  className="input tall"
                  value={descriptor}
                  onChange={(e) => setDescriptor(e.target.value.slice(0, 160))}
                  placeholder="p. ej. la del centro, junto al parque"
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default SettingsScreen;

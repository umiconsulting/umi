import React, { useState, useEffect, useCallback, useId } from 'react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { PageHead } from '@/components/page-head.jsx';
import { Segmented } from '@/components/segmented.jsx';
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
  { id: 'dom', l: msg`Dom` },
  { id: 'lun', l: msg`Lun` },
  { id: 'mar', l: msg`Mar` },
  { id: 'mie', l: msg`Mié` },
  { id: 'jue', l: msg`Jue` },
  { id: 'vie', l: msg`Vie` },
  { id: 'sab', l: msg`Sáb` },
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
  { key: 'casual', label: msg`Casual` },
  { key: 'friendly', label: msg`Amigable` },
  { key: 'formal', label: msg`Formal` },
];

/** API presets carry a plain `label`; the fallback carries a descriptor. */
const presetLabel = (i18n, value) => (typeof value === 'string' ? value : i18n._(value));
const MIN_STAMP_TARGET = 1;
const MAX_STAMP_TARGET = 10;
const MAX_REWARD_NAME_LENGTH = 30;

const clampStampTarget = (value) =>
  Math.max(MIN_STAMP_TARGET, Math.min(MAX_STAMP_TARGET, parseInt(value, 10) || MIN_STAMP_TARGET));

/** `merchant.subscription` holds a storage token; the owner reads a word. */
/**
 * WCAG relative-luminance contrast between a hex colour and white.
 *
 * The pass prints the café's name, its balance and its visit count in WHITE on
 * this colour. A brand colour the owner likes on screen can leave that text at
 * 2:1 on the card in their customer's hand, and nothing in the console said so —
 * the preview simply drew it, faithfully, unreadable.
 */
function contrastWithWhite(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const channel = (v) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const h = m[1];
  const l =
    0.2126 * channel(h.slice(0, 2)) +
    0.7152 * channel(h.slice(2, 4)) +
    0.0722 * channel(h.slice(4, 6));
  return 1.05 / (l + 0.05);
}

const SUBSCRIPTION_WORDS = {
  active: msg`Activa`,
  trialing: msg`En periodo de prueba`,
  past_due: msg`Con pago pendiente`,
  canceled: msg`Cancelada`,
  paused: msg`En pausa`,
};

/**
 * One section of the settings panel.
 *
 * The name is a section title, not a page title: the masthead owns the page name,
 * so this band repeats nothing. A section holds a title, one optional sentence,
 * and its fields. The line between two sections is drawn by the section itself, so
 * no boundary is nested inside another boundary.
 */
function SettingsSection({ title, note, actions }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 16,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1.25,
            letterSpacing: 'normal',
          }}
        >
          {title}
        </h2>
        {note ? (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 13.5,
              color: 'var(--ink-2)',
              maxWidth: '68ch',
              lineHeight: 1.4,
            }}
          >
            {note}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

/**
 * A switch is a control, so it is a button. The old one was a `div` with a click
 * handler, which a keyboard cannot reach and a screen reader cannot name.
 */
function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={'switch lg focusable' + (checked ? ' on' : '')}
      style={{ border: 'none', padding: 0 }}
      onClick={onChange}
    />
  );
}

/**
 * The commit control of one section.
 *
 * The screen was built as one long form and the old save control sat in a banner
 * above the first field, so the control was never with the thing it wrote. Every
 * section now carries its own control, at its own end, and states whether that
 * section holds a pending change. The command behind the control does not change:
 * one PATCH still commits the page, so no edit is lost by saving from here.
 */
function SectionSave({ dirty, saved, saving, onSave }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 12,
        marginTop: 16,
      }}
    >
      <span
        role="status"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 13.5,
          color: saved ? 'var(--success)' : 'var(--ink-2)',
        }}
      >
        {saved ? (
          <>
            <I.Check size={15} /> <Trans>Cambios guardados</Trans>
          </>
        ) : dirty ? (
          <Trans>Sin guardar</Trans>
        ) : null}
      </span>
      <button
        className="btn btn-secondary btn-sm focusable"
        onClick={onSave}
        disabled={saving || !dirty}
      >
        {saving ? <Trans>Guardando…</Trans> : <Trans>Guardar</Trans>}
      </button>
    </div>
  );
}

const SettingsScreen = () => {
  const { t, i18n } = useLingui();
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
  // Customer-segment cutoffs, edited as display strings (spend shown in pesos, not centavos).
  const [seg, setSeg] = useState(null);
  const [brand, setBrand] = useState(null);
  const [stamps, setStamps] = useState(4);
  const [loyalty, setLoyalty] = useState(null);
  const [birthday, setBirthday] = useState(null);
  const [promo, setPromo] = useState(null);
  const [selfReg, setSelfReg] = useState(true);
  const [voice, setVoice] = useState(null);
  const [bizName, setBizName] = useState('');
  /**
   * WHAT THE SERVER HOLDS, as far as this screen knows.
   *
   * Every editable group is compared against this snapshot, so the save control
   * can say whether the page holds a pending change. The snapshot is taken when
   * the form is seeded and again after a save resolves — never from an assumption.
   */
  const [base, setBase] = useState(null);
  const [voiceBase, setVoiceBase] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Which section's control produced the last successful save, so one section
  // shows the receipt and the others stay quiet.
  const [savedSection, setSavedSection] = useState(null);

  // Populate state from fetched merchant once it arrives
  useEffect(() => {
    if (!merchant) return;
    const nextBiz = {
      name: merchant.name,
      city: merchant.city,
      handle: merchant.handle,
      cardPrefix: merchant.cardPrefix,
      subscription: merchant.subscriptionStatus,
      businessDayStart: merchant.businessDayStart || '00:00',
    };
    // Effective cutoffs come merged from the API; show spend in pesos.
    const st = merchant.segmentThresholds || {};
    const nextSeg = {
      vipMinPesos: String(Math.round(Number(st.vipMinSpendCents ?? 100000) / 100)),
      vipMinVisits: String(Number(st.vipMinVisits ?? 8)),
      regularMinVisits: String(Number(st.regularMinVisits ?? 3)),
      activeWindowDays: String(Number(st.activeWindowDays ?? 45)),
      lapsedDays: String(Number(st.lapsedDays ?? 180)),
    };
    const nextBrand = {
      primary: merchant.primaryColor || '#B5605A',
      secondary: merchant.secondaryColor || '#E8C9A3',
      logoUrl: merchant.logoUrl || '',
    };
    const nextSelfReg = merchant.selfRegistration !== false;
    const nextBirthday = {
      on: merchant.birthdayRewardEnabled !== false,
      rewardName: merchant.birthdayRewardName || t`Regalo de cumpleaños`,
    };
    const visitsRequired = clampStampTarget(merchant.rewardConfig?.visitsRequired ?? 10);
    const nextLoyalty = merchant.rewardConfig
      ? {
          rewardName: (merchant.rewardConfig.rewardName || '').slice(0, MAX_REWARD_NAME_LENGTH),
          visitsRequired,
          rewardCost: Math.round(merchant.rewardConfig.rewardCostCentavos / 100),
        }
      : {
          rewardName: t`Recompensa de temporada`,
          visitsRequired,
          rewardCost: 0,
        };
    // Parse promoDays "2,3,4" → ['mar','mie','jue']
    const promoNumToId = Object.fromEntries(Object.entries(DOW_NUM).map(([id, n]) => [n, id]));
    const days = merchant.promoDays
      ? merchant.promoDays
          .split(',')
          .map((n) => promoNumToId[n.trim()])
          .filter(Boolean)
      : ['mar', 'mie', 'jue'];
    const nextPromo = {
      message: merchant.promoMessage || '',
      from: merchant.promoStartsAt ? merchant.promoStartsAt.slice(0, 10) : '2026-05-15',
      to: merchant.promoEndsAt ? merchant.promoEndsAt.slice(0, 10) : '2026-06-30',
      days: days,
    };
    setBiz(nextBiz);
    setSeg(nextSeg);
    setBrand(nextBrand);
    setSelfReg(nextSelfReg);
    setBirthday(nextBirthday);
    setLoyalty(nextLoyalty);
    setStamps((s) => Math.min(s, visitsRequired));
    setPromo(nextPromo);
    setBase({
      biz: nextBiz,
      seg: nextSeg,
      brand: nextBrand,
      loyalty: nextLoyalty,
      birthday: nextBirthday,
      promo: nextPromo,
      selfReg: nextSelfReg,
    });
  }, [merchant, t]);

  // Seed the voice editor independently of the cash-gated merchant skeleton, so a
  // conversaflow-only merchant (e.g. Kalala, cashActive=false) still gets its chips.
  useEffect(() => {
    if (!voiceData?.voice) return;
    const nextVoice = {
      tonePreset: voiceData.voice.tone_preset || 'friendly',
      assistantName: voiceData.voice.assistant_name || '',
      customTone: voiceData.voice.tone || '',
      styleNotes: (voiceData.voice.style_notes || []).join('\n'),
    };
    setVoice(nextVoice);
    setVoiceBase(nextVoice);
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

  async function handleSave(sectionKey) {
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
        businessDayStart: biz.businessDayStart,
        ...(seg
          ? {
              segmentThresholds: {
                vipMinSpendCents: Math.max(0, Math.round(Number(seg.vipMinPesos || 0) * 100)),
                vipMinVisits: Math.max(1, Math.round(Number(seg.vipMinVisits || 1))),
                regularMinVisits: Math.max(1, Math.round(Number(seg.regularMinVisits || 1))),
                activeWindowDays: Math.max(1, Math.round(Number(seg.activeWindowDays || 1))),
                lapsedDays: Math.max(1, Math.round(Number(seg.lapsedDays || 1))),
              },
            }
          : {}),
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
    setSavedSection(sectionKey || null);
    // The server now holds this shape. Measure the next edit against it.
    setBase({ biz, seg, brand, loyalty, birthday, promo, selfReg });
    if (voice) setVoiceBase(voice);
    setTimeout(() => {
      setSaved(false);
      setSavedSection(null);
    }, 2500);
  }

  // One comparison per section, so a save control states the truth about the work
  // that belongs to it. A section with nothing pending keeps its control quiet,
  // and a section with an edit says so next to the edit.
  const asText = (value) => JSON.stringify(value ?? null);
  const pending = {
    biz: Boolean(base) && (asText(biz) !== asText(base.biz) || asText(seg) !== asText(base.seg)),
    card:
      Boolean(base) &&
      (asText(brand) !== asText(base.brand) || asText(loyalty) !== asText(base.loyalty)),
    voice: Boolean(voiceBase) && asText(voice) !== asText(voiceBase),
    birthday: Boolean(base) && asText(birthday) !== asText(base.birthday),
    promo: Boolean(base) && asText(promo) !== asText(base.promo),
    selfreg: Boolean(base) && selfReg !== base.selfReg,
  };

  // Guard — show skeleton until state is seeded
  if (!biz || !brand || !promo || !birthday || (cashActive && !loyalty)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          className="surface"
          style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--ink-2)' }}
        >
          {loading ? <Trans>Cargando ajustes…</Trans> : <Trans>Sin datos de configuración.</Trans>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ONE band, and one shape in it: a sentence that orients the owner. */}
      <PageHead note={<Trans>Configura el negocio, la lealtad y la voz del asistente.</Trans>} />

      {/* ONE surface holds the whole form. Sections divide it with a line, so no
          boundary sits inside another boundary. The save control docks to the
          bottom of this panel, and the panel is exactly what it writes. */}
      <section className="surface">
        {/* Sucursales — location aliases/descriptor (multi-location, ConversaFlow only) */}
        <LocationProfilesCard conversaflowActive={conversaflowActive} />

        {/* Merchant info */}
        <div style={{ padding: 24, borderTop: '1px solid var(--line-soft)' }}>
          <SettingsSection title={<Trans>Información del negocio</Trans>} />
          <div className="grid grid-3" style={{ gap: 16 }}>
            <div className="field">
              <label htmlFor={`${uid}-business-name`}>
                <Trans>Nombre del negocio</Trans>
              </label>
              <input
                id={`${uid}-business-name`}
                className="input tall"
                value={biz.name}
                onChange={(e) => setBiz((b) => ({ ...b, name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-city`}>
                <Trans>Ciudad</Trans>
              </label>
              <input
                id={`${uid}-city`}
                className="input tall"
                value={biz.city || ''}
                onChange={(e) => setBiz((b) => ({ ...b, city: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-business-day-start`}>
                <Trans>Inicio del día operativo</Trans>
              </label>
              <input
                id={`${uid}-business-day-start`}
                type="time"
                className="input tall"
                value={biz.businessDayStart || '00:00'}
                onChange={(e) => setBiz((b) => ({ ...b, businessDayStart: e.target.value }))}
              />
              <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 4 }}>
                <Trans>
                  Hora en que empieza el día de ventas. 00:00 = medianoche local. Un café nocturno
                  usa p. ej. 04:00 para que una venta de la 1 a.m. cuente en la noche que la abrió.
                  No cambia días ya cerrados.
                </Trans>
              </div>
            </div>
            {seg && (
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <span className="field-label">
                  <Trans>Segmentos de clientes</Trans>
                </span>
                <div style={{ fontSize: 13.5, color: 'var(--ink-3)', margin: '4px 0 12px' }}>
                  <Trans>
                    Define cuándo un cliente es Frecuente, VIP, En riesgo o Inactivo. Se usa en el
                    resumen del cliente. Deja los valores por defecto si no estás seguro.
                  </Trans>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 12,
                  }}
                >
                  <div className="field">
                    <label htmlFor={`${uid}-seg-vip-spend`}>
                      <Trans>VIP: gasto mínimo (MXN)</Trans>
                    </label>
                    <input
                      id={`${uid}-seg-vip-spend`}
                      type="number"
                      min="0"
                      className="input tall"
                      value={seg.vipMinPesos}
                      onChange={(e) => setSeg((s) => ({ ...s, vipMinPesos: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-seg-vip-visits`}>
                      <Trans>VIP: visitas mínimas</Trans>
                    </label>
                    <input
                      id={`${uid}-seg-vip-visits`}
                      type="number"
                      min="1"
                      className="input tall"
                      value={seg.vipMinVisits}
                      onChange={(e) => setSeg((s) => ({ ...s, vipMinVisits: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-seg-regular-visits`}>
                      <Trans>Frecuente: visitas mínimas</Trans>
                    </label>
                    <input
                      id={`${uid}-seg-regular-visits`}
                      type="number"
                      min="1"
                      className="input tall"
                      value={seg.regularMinVisits}
                      onChange={(e) => setSeg((s) => ({ ...s, regularMinVisits: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-seg-active-days`}>
                      <Trans>Activo: dentro de (días)</Trans>
                    </label>
                    <input
                      id={`${uid}-seg-active-days`}
                      type="number"
                      min="1"
                      className="input tall"
                      value={seg.activeWindowDays}
                      onChange={(e) => setSeg((s) => ({ ...s, activeWindowDays: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-seg-lapsed-days`}>
                      <Trans>Inactivo: después de (días)</Trans>
                    </label>
                    <input
                      id={`${uid}-seg-lapsed-days`}
                      type="number"
                      min="1"
                      className="input tall"
                      value={seg.lapsedDays}
                      onChange={(e) => setSeg((s) => ({ ...s, lapsedDays: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="field">
              <span className="field-label">
                <Trans>Estado de la cuenta</Trans>
              </span>
              {/* The subscription is a fact this screen does not own, so it reads as a
                value with a consequence, not as a control. The old pill repeated the
                same word next to a cross and said nothing about where to change it. */}
              <div style={{ display: 'flex', alignItems: 'center', minHeight: 52 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {i18n._(SUBSCRIPTION_WORDS[biz.subscription] || SUBSCRIPTION_WORDS.active)}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                <Trans>Se administra en Productos y facturación</Trans>
              </div>
            </div>
            <div className="field">
              <span className="field-label">
                <Trans>Dirección pública</Trans>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="chip read" style={{ height: 44, fontSize: 13.5 }}>
                  {biz.handle ? `umi.app/${biz.handle}` : t`Sin dirección publicada`}
                </span>
                <button
                  className="btn-icon focusable"
                  aria-label={t`Copiar dirección`}
                  title={t`Copiar dirección`}
                  disabled={!biz.handle}
                  onClick={() => copyHandle(biz.handle)}
                >
                  {copied ? <I.Check size={14} /> : <I.Receipt size={14} />}
                </button>
              </div>
            </div>
            <div className="field">
              <span className="field-label">
                <Trans>Prefijo de tarjeta</Trans>
              </span>
              <span className="chip read" style={{ height: 44, fontSize: 13.5 }}>
                {cashActive ? `${biz.cardPrefix} · • • • •` : t`No disponible sin Umi Cash`}
              </span>
            </div>
          </div>
          <SectionSave
            dirty={pending.biz}
            saved={saved && savedSection === 'biz'}
            saving={saving}
            onSave={() => handleSave('biz')}
          />
        </div>

        {/* Voice & tone — WhatsApp assistant (ConversaFlow) */}
        {conversaflowActive && voice && (
          <div style={{ padding: 24, borderTop: '1px solid var(--line-soft)' }}>
            <SettingsSection
              title={<Trans>Voz y tono del asistente</Trans>}
              note={<Trans>Cómo saluda y responde el asistente en WhatsApp.</Trans>}
            />

            {/* Tone chips — single select */}
            <div className="field" style={{ marginBottom: 16 }}>
              <span className="field-label">
                <Trans>Tono · cómo le habla el asistente a tus clientes</Trans>
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(voiceData?.presets?.length ? voiceData.presets : VOICE_PRESET_FALLBACK).map(
                  (p) => (
                    <button
                      key={p.key}
                      className={'day-pill focusable' + (voice.tonePreset === p.key ? ' on' : '')}
                      // Picking a chip clears any freeform override so the preset
                      // actually takes effect — the engine gives freeform `tone`
                      // precedence over `tone_preset`, so a stale custom tone would
                      // otherwise make the chip inert.
                      onClick={() => setVoice((v) => ({ ...v, tonePreset: p.key, customTone: '' }))}
                    >
                      {presetLabel(i18n, p.label)}
                    </button>
                  ),
                )}
              </div>
              {voice.customTone.trim() ? (
                <div
                  style={{
                    fontSize: 13.5,
                    color: 'var(--ink-3)',
                    marginTop: 8,
                    fontStyle: 'italic',
                  }}
                >
                  <Trans>Usando tono personalizado — anula el chip seleccionado.</Trans>
                </div>
              ) : (
                voiceData?.presets?.find((p) => p.key === voice.tonePreset)?.description && (
                  <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 8 }}>
                    {voiceData.presets.find((p) => p.key === voice.tonePreset).description}
                  </div>
                )
              )}
            </div>

            {/* Advanced */}
            <div className="grid grid-2" style={{ gap: 16 }}>
              <div className="field">
                <label htmlFor={`${uid}-nombre-del-asistente`}>
                  <Trans>Nombre del asistente · opcional</Trans>
                </label>
                <input
                  id={`${uid}-nombre-del-asistente`}
                  className="input tall"
                  value={voice.assistantName}
                  placeholder={bizName || t`Asistente`}
                  onChange={(e) =>
                    setVoice((v) => ({ ...v, assistantName: e.target.value.slice(0, 60) }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`${uid}-tono-personalizado-opcional`}>
                  <Trans>Tono personalizado · opcional (anula el chip)</Trans>
                </label>
                <input
                  id={`${uid}-tono-personalizado-opcional`}
                  className="input tall"
                  value={voice.customTone}
                  placeholder={t`Ej. relajado, con modismos del norte`}
                  onChange={(e) =>
                    setVoice((v) => ({ ...v, customTone: e.target.value.slice(0, 280) }))
                  }
                />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor={`${uid}-notas-de-estilo`}>
                  <Trans>Notas de estilo · una por línea (máx. 8)</Trans>
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
            <SectionSave
              dirty={pending.voice}
              saved={saved && savedSection === 'voice'}
              saving={saving}
              onSave={() => handleSave('voice')}
            />
          </div>
        )}

        {!cashActive && (
          <div style={{ padding: 24, borderTop: '1px solid var(--line-soft)' }}>
            <SettingsSection
              title={<Trans>Umi Cash no está activo</Trans>}
              note={
                <Trans>
                  Sin Umi Cash no hay monedero, lealtad, tarjetas de regalo ni pase en Wallet.
                </Trans>
              }
            />
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-2)', maxWidth: '68ch' }}>
              <Trans>
                La configuración de pase en Wallet, sellos, recompensas, miembros y tarjetas de
                regalo queda oculta hasta activar Umi Cash.
              </Trans>
            </p>
          </div>
        )}

        {/* Branding + wallet preview */}
        {cashActive && (
          <div
            className="split"
            style={{ gap: 24, padding: 24, borderTop: '1px solid var(--line-soft)' }}
          >
            <div>
              <SettingsSection
                title={<Trans>Apariencia de la tarjeta</Trans>}
                note={
                  <Trans>Cómo se ve la tarjeta del cliente en Apple Wallet y Google Wallet.</Trans>
                }
              />

              <div className="field" style={{ marginBottom: 16 }}>
                <label htmlFor={`${uid}-primary-color-card`}>
                  <Trans>Color principal · fondo de la tarjeta</Trans>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <input
                    id={`${uid}-primary-color-card`}
                    type="color"
                    value={brand.primary}
                    onChange={(e) => {
                      setBrand((b) => ({ ...b, primary: e.target.value }));
                      document.documentElement.style.setProperty(
                        '--merchant-brand',
                        e.target.value,
                      );
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
                        style={{ '--swatch': c }}
                        onClick={() => {
                          setBrand((b) => ({ ...b, primary: c }));
                          document.documentElement.style.setProperty('--merchant-brand', c);
                        }}
                        aria-label={c}
                      />
                    ))}
                  </div>
                </div>
                {/* Says it; does not override it. The colour is the café's decision. */}
                {(() => {
                  const c = contrastWithWhite(brand.primary);
                  if (c == null || c >= 4.5) return null;
                  return (
                    <div
                      className="field-warning"
                      role="status"
                      style={{ fontSize: 13.5, color: 'var(--warning)', marginTop: 4 }}
                    >
                      <Trans>
                        El texto blanco de la tarjeta queda en {c.toFixed(1)}:1 sobre este color.
                      </Trans>{' '}
                      {c < 3 ? (
                        <Trans>Tu cliente casi no podrá leer su saldo.</Trans>
                      ) : (
                        <Trans>Un color más oscuro se lee mejor en la mano.</Trans>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="field" style={{ marginBottom: 16 }}>
                <label htmlFor={`${uid}-secondary-color-accents`}>
                  <Trans>Color secundario · acentos y detalles</Trans>
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
                        style={{ '--swatch': c }}
                        onClick={() => setBrand((b) => ({ ...b, secondary: c }))}
                        aria-label={c}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div
                style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 16, marginTop: 4 }}
              >
                <div style={{ marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>
                    <Trans>Recompensas por sellos</Trans>
                  </h3>
                </div>
                <div className="grid grid-2" style={{ gap: 16 }}>
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor={`${uid}-reward-name-shown`}>
                      <Trans>Nombre del premio · lo ve el cliente</Trans>
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
                    <label htmlFor={`${uid}-visits-required`}>
                      <Trans>Visitas necesarias</Trans>
                    </label>
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
                    <label htmlFor={`${uid}-reward-cost-mxn`}>
                      <Trans>Costo del premio · MXN</Trans>
                    </label>
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
              <SectionSave
                dirty={pending.card}
                saved={saved && savedSection === 'card'}
                saving={saving}
                onSave={() => handleSave('card')}
              />
            </div>

            {/* Wallet pass live preview */}
            <div
              style={{
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
                position: 'relative',
                // A tonal pane, not a second boundary: the warm field says "this is
                // the card in the customer's hand". The warm hairline is part of that
                // warm field, and it keeps the pane visible in the dark themes, where
                // the warm surface and the panel share the same dark value.
                background: 'var(--surface-warm)',
                border: '1px solid var(--surface-warm-border)',
                borderRadius: 'var(--r-lg)',
              }}
            >
              <div style={{ alignSelf: 'flex-start' }}>
                <div className="eyebrow on-warm">
                  <Trans>Vista previa</Trans>
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 13.5,
                    color: 'var(--ink-warm)',
                    marginTop: 2,
                  }}
                >
                  <Trans>Pase de Apple Wallet</Trans>
                </div>
              </div>
              <WalletPass
                brand={brand}
                biz={biz}
                stamps={stamps}
                loyalty={loyalty}
                birthday={birthday}
                topupEnabled={merchant.topupEnabled !== false}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13.5, color: 'var(--ink-warm-soft)' }}>
                  <Trans>Sellos máximos</Trans>
                </span>
                <input
                  type="range"
                  aria-label={t`Sellos máximos en la tarjeta`}
                  className="range-control"
                  min={MIN_STAMP_TARGET}
                  max={MAX_STAMP_TARGET}
                  step={1}
                  value={loyalty.visitsRequired}
                  onChange={(e) => setStampTarget(e.target.value)}
                  style={{ width: 140, accentColor: 'var(--umi-navy)' }}
                />
                <span
                  style={{
                    fontSize: 13.5,
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
          <div style={{ padding: 24, borderTop: '1px solid var(--line-soft)' }}>
            <SettingsSection
              title={<Trans>Boost de cumpleaños</Trans>}
              note={<Trans>Un premio que se emite solo el día del cumpleaños del cliente.</Trans>}
              actions={
                <Switch
                  checked={birthday.on}
                  label={t`Regalo de cumpleaños`}
                  onChange={() => setBirthday((b) => ({ ...b, on: !b.on }))}
                />
              }
            />
            <div className="field">
              <label htmlFor={`${uid}-reward-name-auto`}>
                <Trans>Nombre del premio · se emite solo en el cumpleaños</Trans>
              </label>
              <input
                id={`${uid}-reward-name-auto`}
                className="input tall"
                value={birthday.rewardName}
                onChange={(e) => setBirthday((b) => ({ ...b, rewardName: e.target.value }))}
                disabled={!birthday.on}
              />
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 12, marginBottom: 0 }}>
              <Trans>
                Se envía solo a las 09:00 (hora local) y vale 7 días. El cliente recibe un aviso por
                WhatsApp.
              </Trans>
            </p>
            <SectionSave
              dirty={pending.birthday}
              saved={saved && savedSection === 'birthday'}
              saving={saving}
              onSave={() => handleSave('birthday')}
            />
          </div>
        )}

        {/* Promotions */}
        <div style={{ padding: 24, borderTop: '1px solid var(--line-soft)' }}>
          <SettingsSection title={<Trans>Promoción del momento</Trans>} />
          <div className="split">
            <div className="field">
              <label htmlFor={`${uid}-message-sent-on`}>
                <Trans>Mensaje · se envía por WhatsApp · máx. 200 caracteres</Trans>
              </label>
              <textarea
                id={`${uid}-message-sent-on`}
                className="input"
                value={promo.message}
                onChange={(e) => setPromo((p) => ({ ...p, message: e.target.value.slice(0, 200) }))}
                style={{ minHeight: 100 }}
                maxLength={200}
              />
              {/* A counter at zero is noise. The label already carries the limit. */}
              {promo.message.length > 0 ? (
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--ink-3)',
                    textAlign: 'right',
                    marginTop: 4,
                  }}
                >
                  {promo.message.length} / 200
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field">
                <label htmlFor={`${uid}-active-range-business`}>
                  <Trans>Vigencia · desde / hasta</Trans>
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    id={`${uid}-active-range-business`}
                    type="date"
                    aria-label={t`Inicio de la vigencia`}
                    className="input"
                    style={{ flex: 1 }}
                    value={promo.from}
                    onChange={(e) => setPromo((p) => ({ ...p, from: e.target.value }))}
                  />
                  <span style={{ color: 'var(--ink-3)' }} aria-hidden="true">
                    →
                  </span>
                  <input
                    type="date"
                    aria-label={t`Fin de la vigencia`}
                    className="input"
                    style={{ flex: 1 }}
                    value={promo.to}
                    onChange={(e) => setPromo((p) => ({ ...p, to: e.target.value }))}
                  />
                </div>
              </div>
              <div className="field">
                <span className="field-label">
                  <Trans>Días de la semana</Trans>
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {DOW.map((d) => (
                    <button
                      key={d.id}
                      className={'day-pill focusable' + (promo.days.includes(d.id) ? ' on' : '')}
                      onClick={() => toggleDay(d.id)}
                    >
                      {i18n._(d.l)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <SectionSave
            dirty={pending.promo}
            saved={saved && savedSection === 'promo'}
            saving={saving}
            onSave={() => handleSave('promo')}
          />
        </div>

        {/* Self-registration */}
        {cashActive && (
          <div style={{ padding: 24, borderTop: '1px solid var(--line-soft)' }}>
            <SettingsSection
              title={<Trans>Autorregistro</Trans>}
              note={
                <Trans>
                  El cliente entra al programa de lealtad escaneando un código QR en la mesa, sin
                  ayuda del personal.
                </Trans>
              }
              actions={
                <Switch
                  checked={selfReg}
                  label={t`Autorregistro`}
                  onChange={() => setSelfReg((s) => !s)}
                />
              }
            />
            <SectionSave
              dirty={pending.selfreg}
              saved={saved && savedSection === 'selfreg'}
              saving={saving}
              onSave={() => handleSave('selfreg')}
            />
          </div>
        )}
      </section>
    </div>
  );
};

// ── Live wallet pass component ─────────────────────────────────────────────────
const WalletPass = ({ brand, biz, stamps, loyalty, birthday, topupEnabled }) => {
  const { t } = useLingui();
  const remaining = Math.max(0, loyalty.visitsRequired - stamps);
  const logo = normalizeAssetUrl(brand.logoUrl) || assetPath(biz.handle, 'wallet-logo');
  const filledStamp = assetPath(biz.handle, 'stamp-filled');
  const emptyStamp = assetPath(biz.handle, 'stamp-empty');
  const stampCols = loyalty.visitsRequired <= 8 ? 4 : 5;
  const barcode = `${biz.cardPrefix || 'UMI'}-0004821`;

  return (
    <div className="wallet-device" aria-label={t`Vista previa del pase de Wallet`}>
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
              <div>
                <Trans>SALDO</Trans>
              </div>
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
            label={t`VISITAS FALTANTES`}
            value={<Plural value={remaining} one="# visita" other="# visitas" />}
          />
          <PassField label={t`TIPO DE RECOMPENSA`} value={loyalty.rewardName} />
          {birthday?.on && (
            <PassField label={t`REGALO DE CUMPLEAÑOS`} value={birthday.rewardName} />
          )}
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
  const { t } = useLingui();
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
    // FRAGMENT, and the sheet is OUTSIDE the section on purpose. `.sheet` is
    // `position: fixed`, and a transformed ancestor becomes the containing block
    // for a fixed descendant — so a sheet rendered inside this section is laid out
    // against it instead of the viewport: a clipped panel a few hundred
    // pixels wide, with its own fields cut off. Staff and Cafés both mount their
    // sheet at screen level; this matches. (The screen's arrival animation is
    // opacity-only for the same reason — see `.screen-body` in styles.css.)
    <>
      <div style={{ padding: 24 }}>
        <SettingsSection
          title={<Trans>Sucursales</Trans>}
          note={<Trans>Los locales de este café. Cada uno tiene su propio horario.</Trans>}
          actions={
            <button className="btn btn-secondary btn-sm focusable" onClick={() => setAdding(true)}>
              <I.Plus size={15} /> {t`Agregar sucursal`}
            </button>
          }
        />
        {profiles.map((profile, index) => (
          <LocationProfileRow
            key={profile.id}
            profile={profile}
            showAliases={showAliases}
            first={index === 0}
          />
        ))}
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
  const { t } = useLingui();
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
    const problem = coordProblem(t, form);
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
      setError(e.message || t`No se pudo agregar la sucursal.`);
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
            <div className="eyebrow">
              <Trans>Sucursales</Trans>
            </div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              <Trans>Agregar una sucursal</Trans>
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor={`${uid}-nombre`}>
              <Trans>Nombre</Trans>
            </label>
            <input
              id={`${uid}-nombre`}
              className="input tall"
              placeholder={t`Chapultepec`}
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
            <Trans>Cancelar</Trans>
          </button>
          <button
            className="btn btn-primary focusable"
            disabled={!valid || saving}
            style={{ opacity: valid && !saving ? 1 : 0.5 }}
            onClick={create}
          >
            {saving ? <Trans>Agregando…</Trans> : <Trans>Agregar sucursal</Trans>}
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
  const { t } = useLingui();
  const uid = useId();
  const hasPin = Boolean(form.latitude || form.longitude);
  return (
    <>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor={`${uid}-direccion`}>
          <Trans>Dirección</Trans>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id={`${uid}-direccion`}
            className="input tall"
            style={{ flex: 1 }}
            placeholder={t`Av. Chapultepec 1, Guadalajara`}
            value={form.address}
            onChange={update('address')}
            maxLength={200}
          />
          <button
            className="btn btn-secondary"
            onClick={geo.run}
            disabled={geo.busy || form.address.trim().length < 3}
          >
            {geo.busy ? <Trans>Buscando…</Trans> : <Trans>Buscar</Trans>}
          </button>
        </div>
        {geo.message && (
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)' }} role="status">
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
        <label style={{ margin: 0, minWidth: 26 }}>
          <Trans>Pin</Trans>
        </label>
        <input
          className="input"
          inputMode="decimal"
          aria-label={t`Latitud`}
          placeholder="20.6736"
          value={form.latitude}
          onChange={update('latitude')}
          style={{ width: 118, height: 32, fontSize: 12.5 }}
        />
        <input
          className="input"
          inputMode="decimal"
          aria-label={t`Longitud`}
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
            <Trans>Quitar</Trans>
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
  const { t } = useLingui();
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
        setMessage(t`No encontramos esa dirección. Puedes escribir el pin a mano.`);
      }
    } catch (e) {
      console.error('geocode failed', e);
      setMessage(t`No se pudo buscar ahora. Puedes escribir el pin a mano.`);
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
function coordProblem(t, form) {
  const pairs = [
    ['latitude', t`La latitud`, 90],
    ['longitude', t`La longitud`, 180],
  ];
  for (const [key, label, limit] of pairs) {
    const raw = String(form[key] ?? '').trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) return t`${label} debe ser un número.`;
    if (Math.abs(n) > limit) return t`${label} debe estar entre -${limit} y ${limit}.`;
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
function LocationProfileRow({ profile, showAliases, first = false }) {
  const { t } = useLingui();
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
    const problem = coordProblem(t, form);
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
      setError(e.message || t`No se pudo guardar. Reintenta.`);
    } finally {
      setSaving(false);
    }
  }

  const closed = status === 'closed';

  return (
    <div
      style={{
        // A branch is a row of the section, not a box inside it: the line belongs
        // to the list, and the row stops drawing a second boundary around itself.
        borderTop: first ? 'none' : '1px solid var(--line-soft)',
        padding: '12px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: open ? 12 : 4,
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
            aria-label={t`Nombre de la sucursal`}
            value={form.name}
            onChange={update('name')}
            maxLength={100}
            style={{ width: 240, height: 34, fontWeight: 600 }}
          />
        ) : (
          <div style={{ fontWeight: 600, fontSize: 13.5, opacity: closed ? 0.6 : 1 }}>
            {form.name || profile.name}
          </div>
        )}
        {open ? (
          <Segmented
            label={t`Estado del negocio`}
            value={closed ? 'closed' : 'active'}
            onChange={setStatus}
            options={[
              { id: 'active', label: <Trans>Abierta</Trans> },
              { id: 'closed', label: <Trans>Cerrada</Trans> },
            ]}
          />
        ) : (
          closed && (
            <span className="chip read" style={{ fontSize: 11 }}>
              <Trans>Cerrada</Trans>
            </span>
          )
        )}
        <div
          style={{
            flex: 1,
            fontSize: 13.5,
            color: 'var(--ink-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {open ? '' : form.address || t`Sin dirección`}
        </div>
        {!open && dirty && (
          <span style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
            <Trans>Sin guardar</Trans>
          </span>
        )}
        {open && error && (
          <span role="alert" style={{ color: 'var(--danger)', fontSize: 13.5 }}>
            {error}
          </span>
        )}
        {open && (
          <button className="btn btn-secondary btn-sm" onClick={save} disabled={!dirty || saving}>
            {saving ? (
              <Trans>Guardando…</Trans>
            ) : saved ? (
              <Trans>✓ Guardado</Trans>
            ) : error ? (
              <Trans>Reintentar</Trans>
            ) : (
              <Trans>Guardar</Trans>
            )}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? <Trans>Cerrar</Trans> : <Trans>Editar</Trans>}
        </button>
      </div>

      {open && (
        <>
          <AddressFields form={form} update={update} setForm={setForm} geo={geo} />
          {showAliases && (
            <>
              <div className="field" style={{ margin: 0 }}>
                <span className="field-label">
                  <Trans>Apodos (cómo la llaman los clientes)</Trans>
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  {aliases.map((a, i) => (
                    <span
                      key={i}
                      className="chip"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {a}
                      <button
                        onClick={() => removeAlias(i)}
                        aria-label={t`Quitar ${a}`}
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
                    placeholder={t`+ apodo`}
                    maxLength={40}
                    style={{ width: 160, height: 32, fontSize: 13.5 }}
                  />
                </div>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor={`${uid}-descripcion-zona-referencia`}>
                  <Trans>Descripción (zona / referencia)</Trans>
                </label>
                <input
                  id={`${uid}-descripcion-zona-referencia`}
                  className="input tall"
                  value={descriptor}
                  onChange={(e) => setDescriptor(e.target.value.slice(0, 160))}
                  placeholder={t`p. ej. la del centro, junto al parque`}
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

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  TONE_PRESETS,
  resolveVoiceConfig,
  type BusinessConfig,
} from './business-config.service';

describe('resolveVoiceConfig', () => {
  it('never throws and fills defaults for an empty config', () => {
    const v = resolveVoiceConfig(null, null, 'tenant-1');
    expect(v.assistant_name).toBe('Asistente');
    expect(v.locale).toBe(DEFAULT_LOCALE);
    expect(v.tone).toBe(TONE_PRESETS.friendly.tone);
    expect(v.style_notes).toBeUndefined();
  });

  it('falls back assistant_name to the business name when no voice name set', () => {
    const v = resolveVoiceConfig(null, 'Kalala', 'tenant-1');
    expect(v.assistant_name).toBe('Kalala');
    expect(v.locale).toBe(DEFAULT_LOCALE);
    expect(v.tone).toBe(TONE_PRESETS.friendly.tone);
  });

  it('maps a formal preset to its Spanish guidance', () => {
    const config: BusinessConfig = { voice: { tone_preset: 'formal' } };
    const v = resolveVoiceConfig(config, 'Kalala', 'tenant-1');
    expect(v.tone).toBe(TONE_PRESETS.formal.tone);
  });

  it('lets a freeform tone override the preset (advanced escape hatch)', () => {
    const config: BusinessConfig = {
      voice: { tone_preset: 'casual', tone: 'usa modismos' },
    };
    const v = resolveVoiceConfig(config, 'Kalala', 'tenant-1');
    expect(v.tone).toBe('usa modismos');
  });

  it('is backward-compatible with legacy {assistant_name, locale, tone} rows', () => {
    const config: BusinessConfig = {
      voice: { assistant_name: 'Kala', locale: 'es-MX', tone: 'cordial' },
    };
    const v = resolveVoiceConfig(config, 'Kalala', 'tenant-1');
    expect(v.assistant_name).toBe('Kala');
    expect(v.locale).toBe('es-MX');
    expect(v.tone).toBe('cordial');
  });

  it('falls back to the friendly default for an unknown preset key', () => {
    const config = { voice: { tone_preset: 'snarky' } } as unknown as BusinessConfig;
    const v = resolveVoiceConfig(config, 'Kalala', 'tenant-1');
    expect(v.tone).toBe(TONE_PRESETS.friendly.tone);
  });

  it('caps an over-long freeform tone and trims excess style notes', () => {
    const longTone = 'a'.repeat(500);
    const config: BusinessConfig = {
      voice: {
        tone: longTone,
        style_notes: Array.from({ length: 12 }, (_, i) => `nota ${i}`),
      },
    };
    const v = resolveVoiceConfig(config, 'Kalala', 'tenant-1');
    expect(v.tone.length).toBe(280);
    expect(v.style_notes).toHaveLength(8);
  });

  it('drops blank/non-string style notes and omits the field when none remain', () => {
    const config = {
      voice: { style_notes: ['   ', 42, '', null] },
    } as unknown as BusinessConfig;
    const v = resolveVoiceConfig(config, 'Kalala', 'tenant-1');
    expect(v.style_notes).toBeUndefined();
  });

  it('caps assistant_name (60) and locale (20) to the DTO bounds for round-trip safety', () => {
    const config: BusinessConfig = {
      voice: { assistant_name: 'N'.repeat(120), locale: 'x'.repeat(40) },
    };
    const v = resolveVoiceConfig(config, 'Kalala', 'tenant-1');
    expect(v.assistant_name.length).toBe(60);
    expect(v.locale.length).toBe(20);
  });

  it('caps a long business-name fallback to the assistant_name bound', () => {
    const v = resolveVoiceConfig(null, 'B'.repeat(120), 'tenant-1');
    expect(v.assistant_name.length).toBe(60);
  });
});

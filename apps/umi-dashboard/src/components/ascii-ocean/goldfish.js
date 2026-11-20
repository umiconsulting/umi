import { smoothstep } from './math';

export function goldfishHalfWidth(s) {
  if (s < 0.12) return 0.086 * Math.pow(Math.sin(((s / 0.12) * Math.PI) / 2), 0.65);
  if (s < 0.26) return 0.086 + 0.011 * smoothstep(0.12, 0.26, s);
  if (s < 0.7) return 0.014 + 0.083 * (1 - smoothstep(0.26, 0.7, s));
  return 0.014 * (1 - smoothstep(0.7, 0.84, s));
}

/** Maximum wave amplitude at the fastest stroke. Keep the head nearly still. */
export function goldfishWaveEnvelope(s) {
  return 0.0015 + 0.065 * Math.pow(s, 2.4);
}

/** A conservative envelope includes the fin reach, body wave, and a small gap. */
export function goldfishClearance(s, length) {
  const p = (s - 0.19) / 0.31;
  const pectoral = p > 0 && p < 1 ? Math.pow(Math.sin(p * Math.PI), 0.75) * 0.21 : 0;
  const tail = s > 0.67 ? 0.191 * Math.pow(Math.sin(((s - 0.67) / 0.33) * Math.PI * 0.78), 0.8) : 0;
  const wave = goldfishWaveEnvelope(s);
  return length * (Math.max(goldfishHalfWidth(s), pectoral, tail) + wave) + 6;
}

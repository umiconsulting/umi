/**
 * Variant synonym dictionaries + text normalizer. Verbatim port of
 * `_shared/synonyms.ts` (behavior-fidelity carry-over, preflight §7). The fuzzy
 * intent matcher (`intent.service.ts`) and the cart tools map free-text size /
 * temperature / milk words onto these canonical codes.
 */

export const SIZE_SYNONYMS: Record<string, 'CH' | 'GDE'> = {
  ch: 'CH',
  chico: 'CH',
  chica: 'CH',
  pequena: 'CH',
  pequeno: 'CH',
  pequeño: 'CH',
  gde: 'GDE',
  grande: 'GDE',
};

export const TEMP_SYNONYMS: Record<string, 'CALIENTE' | 'ROCAS' | 'FRAPPE'> = {
  caliente: 'CALIENTE',
  frio: 'ROCAS',
  cold: 'ROCAS',
  iced: 'ROCAS',
  fria: 'ROCAS',
  fría: 'ROCAS',
  helado: 'ROCAS',
  hielo: 'ROCAS',
  rocas: 'ROCAS',
  frappe: 'FRAPPE',
  frappé: 'FRAPPE',
  frappes: 'FRAPPE',
};

export const MILK_SYNONYMS: Record<
  string,
  'DESLACTOSADA' | 'ALMENDRA' | 'COCO' | 'AVENA' | 'SOYA'
> = {
  deslactosada: 'DESLACTOSADA',
  deslactosado: 'DESLACTOSADA',
  coco: 'COCO',
  almendra: 'ALMENDRA',
  soya: 'SOYA',
  soja: 'SOYA',
  avena: 'AVENA',
};

export function normalizeSynonymText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

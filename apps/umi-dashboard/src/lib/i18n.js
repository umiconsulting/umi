import { i18n } from '@lingui/core';

/**
 * Locale runtime for the dashboard.
 *
 * Spanish is the source locale, English is the first translation. The active
 * locale comes from, in this order: the owner's saved choice, the browser
 * language, then Spanish. `applyMerchantLocale` lets the café record override
 * the browser guess when the owner has not chosen yet.
 *
 * The compiled catalogs are ES modules under `src/locales/<locale>/`; they load
 * on demand so the bundle carries only the active language.
 */
export const LOCALES = Object.freeze([
  { tag: 'es', label: 'Español', bcp47: 'es-MX' },
  { tag: 'en', label: 'English', bcp47: 'en-US' },
]);

export const DEFAULT_LOCALE = 'es';
export const STORAGE_KEY = 'umi.dashboard.locale';

const LOCALE_TAGS = new Set(LOCALES.map((l) => l.tag));

/** Reduces a BCP 47 tag ("es-MX", "en_US") to a supported catalog tag, or null. */
export function toSupportedLocale(value) {
  if (!value) return null;
  const language = String(value).toLowerCase().split(/[-_]/)[0];
  return LOCALE_TAGS.has(language) ? language : null;
}

/** The full BCP 47 tag that `Intl` formatters use for the active locale. */
export function localeTag(locale = i18n.locale) {
  return LOCALES.find((l) => l.tag === locale)?.bcp47 || LOCALES[0].bcp47;
}

export function readStoredLocale() {
  try {
    return toSupportedLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredLocale(locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* private mode or blocked storage: the choice lives for this page only */
  }
}

export function detectLocale() {
  return (
    readStoredLocale() ||
    toSupportedLocale(typeof navigator !== 'undefined' ? navigator.language : null) ||
    DEFAULT_LOCALE
  );
}

const loaded = new Set();

async function loadCatalog(locale) {
  if (loaded.has(locale)) return;
  const { messages } = await import(`../locales/${locale}/messages.mjs`);
  i18n.load(locale, messages);
  loaded.add(locale);
}

/** Loads and activates a locale. Also stamps `<html lang>` for assistive tech and CSS. */
export async function activateLocale(locale, { persist = true } = {}) {
  const next = toSupportedLocale(locale) || DEFAULT_LOCALE;
  await loadCatalog(next);
  i18n.activate(next);
  if (typeof document !== 'undefined') document.documentElement.lang = localeTag(next);
  if (persist) writeStoredLocale(next);
  return next;
}

/**
 * Uses the café's stored locale (`merchant.locale`, e.g. "es-MX") when the owner
 * has not chosen a language. A saved choice always wins.
 */
export async function applyMerchantLocale(merchantLocale) {
  if (readStoredLocale()) return i18n.locale;
  const next = toSupportedLocale(merchantLocale);
  if (!next || next === i18n.locale) return i18n.locale;
  return activateLocale(next, { persist: false });
}

/** Boot: resolve the initial locale before the first render. */
export async function initI18n() {
  return activateLocale(detectLocale(), { persist: false });
}

export { i18n };

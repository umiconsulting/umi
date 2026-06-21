// supabase/functions/_shared/normalize-phone.ts
// Canonical E.164 phone normalizer — Deno/TypeScript.
// Must match platform.normalize_phone() SQL function behavior exactly.
// Shared test vectors in normalize-phone.test.ts keep them in lockstep.

export interface NormalizedPhone {
  e164: string | null;
  last10: string | null;
  confidence: "exact" | "inferred_region" | "last10_candidate" | "unparseable";
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

export function normalizePhone(
  phone: string,
  defaultRegion = "MX",
): NormalizedPhone {
  if (!phone || !phone.trim()) {
    return { e164: null, last10: null, confidence: "unparseable" };
  }

  // Strip whitespace and common separators, keep leading +
  const cleaned = phone.trim().replace(/[()\-\s.]/g, "");

  // Extract last 10 digits as blocking key
  const last10Match = cleaned.match(/\d{10}$/);
  const last10 = last10Match ? last10Match[0] : null;

  // Already E.164
  if (E164_RE.test(cleaned)) {
    // MX: strip mobile "1" prefix after +52
    if (/^\+52\d{11}$/.test(cleaned) && cleaned[3] === "1") {
      const e164 = "+52" + cleaned.slice(4);
      return { e164, last10, confidence: "exact" };
    }
    return { e164: cleaned, last10, confidence: "exact" };
  }

  // 10-digit local number — infer region
  if (/^\d{10}$/.test(cleaned)) {
    let e164: string;
    if (defaultRegion === "MX") {
      e164 = "+52" + cleaned;
    } else if (defaultRegion === "US" || defaultRegion === "CA") {
      e164 = "+1" + cleaned;
    } else {
      e164 = "+" + cleaned;
    }
    return { e164, last10, confidence: "inferred_region" };
  }

  // 11-digit MX mobile (52 + 1 + 10 digits, no +)
  if (/^52\d{11}$/.test(cleaned) && cleaned[2] === "1") {
    const e164 = "+52" + cleaned.slice(3);
    return { e164, last10, confidence: "exact" };
  }

  // Fallback: have digits but can't normalize confidently
  if (last10 && last10.length === 10) {
    return { e164: null, last10, confidence: "last10_candidate" };
  }

  return { e164: null, last10, confidence: "unparseable" };
}

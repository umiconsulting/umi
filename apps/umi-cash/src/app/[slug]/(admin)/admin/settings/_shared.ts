import { authedFetch } from '@/lib/authed-fetch';

export type LifecycleJourneyMeta = { key: string; label: string; description: string };

export interface TenantSettings {
  name: string;
  city: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  logoUrl: string | null;
  stripImageUrl: string | null;
  passStyle: 'default' | 'stamps';
  promoMessage: string | null;
  promoStartsAt: string | null;
  promoEndsAt: string | null;
  promoDays: string | null;
  selfRegistration: boolean;
  birthdayRewardEnabled: boolean;
  birthdayRewardName: string;
  cardPrefix: string;
  slug: string;
  lifecycleCopy: Record<string, string>;
  lifecycleDefaults: Record<string, string>;
  lifecycleJourneys: LifecycleJourneyMeta[];
  lifecycleVariables: Record<string, string[]>;
}

export async function loadSettings(slug: string): Promise<TenantSettings | null> {
  const res = await authedFetch(slug, `/api/${slug}/admin/settings`);
  if (!res.ok) return null;
  return res.json();
}

/** Sends a partial PATCH; the API ignores fields that aren't present. */
export async function saveSettings(
  slug: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await authedFetch(slug, `/api/${slug}/admin/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true };
  return { ok: false, error: (data as { error?: string }).error || 'Error al guardar' };
}

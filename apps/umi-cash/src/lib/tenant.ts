import { cache } from 'react';
import { backendFetch } from './backend';
import type { RewardProfile } from './reward-profile';

export interface TenantConfig {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  city: string | null;
  cardPrefix: string | null;
  topupEnabled: boolean;
  selfRegistration: boolean;
  multiSealEnabled: boolean;
  passStyle: string;
  birthdayRewardEnabled: boolean;
  birthdayRewardName: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  logoUrl: string | null;
  stripImageUrl: string | null;
  promoMessage: string | null;
  promoDays: string | null;
  promoStartsAt: Date | null;
  promoEndsAt: Date | null;
  businessHours: Record<string, unknown> | null;
  locations: { id: string; name: string; address: string | null; latitude: number | null; longitude: number | null; isActive: boolean }[];
  rewardProfile: RewardProfile;
}

export const getTenantConfig = cache(async (reference: string): Promise<TenantConfig | null> => {
  const response = await backendFetch(`/api/${encodeURIComponent(reference)}/config`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Cash configuration is unavailable');
  const row = await response.json();
  return {
    ...row,
    promoStartsAt: row.promoStartsAt ? new Date(row.promoStartsAt) : null,
    promoEndsAt: row.promoEndsAt ? new Date(row.promoEndsAt) : null,
  };
});

export const getTenant = getTenantConfig;
export type TenantWithLocations = TenantConfig;

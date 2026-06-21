// Resolve multi-tenant brand assets from /public/logos by slug convention.
// Add a tenant-specific override here if naming deviates from `{slug}-*.png`.

export type TenantAssets = {
  walletLogo: string;
  stampFilled: string;
  stampEmpty: string;
};

const OVERRIDES: Record<string, Partial<TenantAssets>> = {
  // Example: elgranribera already follows the default convention.
  // Add exceptions here as onboarded.
};

export function getTenantAssets(slug: string): TenantAssets {
  const base = `/logos/${slug}`;
  const defaults: TenantAssets = {
    walletLogo: `${base}-wallet-logo.png`,
    stampFilled: `${base}-stamp-filled.png`,
    stampEmpty: `${base}-stamp-empty.png`,
  };
  return { ...defaults, ...(OVERRIDES[slug] ?? {}) };
}

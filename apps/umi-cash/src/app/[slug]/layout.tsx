import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant';
import { TenantProvider } from '@/context/TenantContext';

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const tenant = await getTenant((await params).slug);
  if (!tenant) notFound();

  // Defense-in-depth: sanitize colors even though DB schema validates on write
  const safeHex = (c: string) => /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#333333';
  const primary = safeHex(tenant.primaryColor);
  const secondary = tenant.secondaryColor ? safeHex(tenant.secondaryColor) : primary;

  const heroShadow = primary.toLowerCase() === '#132642' ? '#E66025' : '#132642';

  const cssVars = `
    :root {
      --color-brand:        ${primary};
      --color-brand-dark:   ${darken(primary)};
      --color-ink:          #132642;
      --color-ink-light:    #586A84;
      --color-accent:       ${secondary};
      --color-surface:      #F8F3E9;
      --color-surface-dark: ${darkSurface(primary)};
      --t-brand:            ${primary};
      --t-brand-dark:       ${darken(primary)};
      --t-strip:            ${secondary};
      --t-tint:             ${darkSurface(primary)};
      --t-hero-shadow:      ${heroShadow};
    }
  `;

  const tenantValue = {
    slug: (await params).slug,
    name: tenant.name,
    city: tenant.city,
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
    cardPrefix: tenant.cardPrefix ?? 'LYL',
    topupEnabled: tenant.topupEnabled,
    multiSealEnabled: tenant.multiSealEnabled,
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cssVars }} />
      <TenantProvider value={tenantValue}>
        {children}
      </TenantProvider>
    </>
  );
}

// Simple color utilities — good enough for the brand palette we use

// Very dark version of the brand color — used for header, dark text
function veryDark(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const factor = 0.3;
  return `#${toHex(Math.round(r * factor))}${toHex(Math.round(g * factor))}${toHex(Math.round(b * factor))}`;
}

// Muted/desaturated version — used for subtle text, inactive icons
function muted(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Blend toward gray at 50%, then lighten
  const gray = 160;
  return `#${toHex(Math.round(r * 0.4 + gray * 0.6))}${toHex(Math.round(g * 0.4 + gray * 0.6))}${toHex(Math.round(b * 0.4 + gray * 0.6))}`;
}

function darken(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const factor = 0.75;
  return `#${toHex(Math.round(r * factor))}${toHex(Math.round(g * factor))}${toHex(Math.round(b * factor))}`;
}

function lightSurface(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Blend toward white at 96%
  return `#${toHex(Math.round(r * 0.04 + 255 * 0.96))}${toHex(Math.round(g * 0.04 + 255 * 0.96))}${toHex(Math.round(b * 0.04 + 255 * 0.96))}`;
}

function darkSurface(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Blend toward white at 88%
  return `#${toHex(Math.round(r * 0.12 + 255 * 0.88))}${toHex(Math.round(g * 0.12 + 255 * 0.88))}${toHex(Math.round(b * 0.12 + 255 * 0.88))}`;
}

function toHex(n: number): string {
  return Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0');
}

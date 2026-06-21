/**
 * Apple Wallet pass generation using passkit-generator.
 *
 * SETUP REQUIRED:
 * 1. Apple Developer account ($99/year): https://developer.apple.com
 * 2. Create a Pass Type ID in the Certificates section
 * 3. Download the Pass Type ID certificate (.cer), convert to PEM:
 *    openssl x509 -in certificate.cer -inform DER -out signerCert.pem -outform PEM
 * 4. Export your private key as signerKey.pem
 * 5. Download Apple WWDR intermediate certificate:
 *    https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
 *    Convert: openssl x509 -in AppleWWDRCAG4.cer -inform DER -out wwdr.pem -outform PEM
 * 6. Place all .pem files in passes/apple/certificates/
 */

import { PKPass } from 'passkit-generator';
import fs from 'fs';
import path from 'path';
import { formatMXN } from './currency';
import { generateStampStrip } from './strip-generator';
import { generatePassSerial, generateRandomToken, signWalletBarcode } from './auth';

const PASSES_DIR = path.join(process.cwd(), 'passes', 'apple');
const TEMPLATE_DIR = path.join(PASSES_DIR, 'template.pass');
const CERTS_DIR = path.join(PASSES_DIR, 'certificates');

// Cached at module load — reads from env vars (production) or filesystem (local dev)
const certCache = (() => {
  // Prefer env vars — certificates stored as base64 strings
  if (process.env.APPLE_SIGNER_CERT && process.env.APPLE_SIGNER_KEY && process.env.APPLE_WWDR_CERT) {
    return {
      wwdr: Buffer.from(process.env.APPLE_WWDR_CERT, 'base64'),
      signerCert: Buffer.from(process.env.APPLE_SIGNER_CERT, 'base64'),
      signerKey: Buffer.from(process.env.APPLE_SIGNER_KEY, 'base64'),
    };
  }
  // Fallback to filesystem for local development
  try {
    return {
      wwdr: fs.readFileSync(path.join(CERTS_DIR, 'wwdr.pem')),
      signerCert: fs.readFileSync(path.join(CERTS_DIR, 'signerCert.pem')),
      signerKey: fs.readFileSync(path.join(CERTS_DIR, 'signerKey.pem')),
    };
  } catch {
    return null;
  }
})();

export function isAppleWalletConfigured(): boolean {
  return certCache !== null && !!process.env.APPLE_PASS_TYPE_ID && !!process.env.APPLE_TEAM_ID;
}

export interface PassData {
  cardId: string;
  cardNumber: string;
  customerName: string;
  balanceCentavos: number;
  visitsThisCycle: number;
  visitsRequired: number;
  pendingRewards: number;
  rewardName: string;
  totalVisits: number;
  authToken?: string;
  serial?: string;
  // Tenant branding
  tenantName?: string;
  tenantSlug?: string;
  primaryColor?: string; // hex, e.g. "#B5605A"
  secondaryColor?: string | null; // hex — used as stamp strip background
  logoUrl?: string | null; // URL to tenant logo image
  stripImageUrl?: string | null; // URL to custom strip image
  passStyle?: string; // "default" or "stamps"
  stampFilledUrl?: string | null; // Custom filled stamp image URL
  stampEmptyUrl?: string | null; // Custom empty stamp image URL
  promoMessage?: string | null; // Current promotion text — triggers notification on change
  lifecycleMessage?: string | null; // One-off lifecycle nudge (welcome, winback, expiring reward)
  birthdayRewardName?: string | null; // if set, active birthday reward is shown on pass
  locations?: { latitude: number; longitude: number; relevantText?: string }[];
  topupEnabled?: boolean; // false = hide balance from pass
}

export async function generateApplePass(data: PassData): Promise<{
  buffer: Buffer;
  serial: string;
  authToken: string;
}> {
  if (!isAppleWalletConfigured() || !certCache) {
    throw new Error('Apple Wallet certificates not configured. See passes/apple/certificates/README.md');
  }

  const serial = data.serial || generatePassSerial();
  const authToken = data.authToken || generateRandomToken();
  const tenantName = data.tenantName || 'Umi Cash';
  const tenantSlug = data.tenantSlug || 'app';

  // Convert hex color to rgb() string for Apple Wallet
  function hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const bgColor = hexToRgb(data.primaryColor || '#B5605A');

  const pass = await PKPass.from(
    {
      model: TEMPLATE_DIR,
      certificates: {
        wwdr: certCache.wwdr,
        signerCert: certCache.signerCert,
        signerKey: certCache.signerKey,
        signerKeyPassphrase: process.env.APPLE_KEY_PASSPHRASE || undefined,
      },
    } as any,
    {
      serialNumber: serial,
      authenticationToken: authToken,
      passTypeIdentifier: (process.env.APPLE_PASS_TYPE_ID || 'pass.co.umicash.loyalty').trim(),
      teamIdentifier: (process.env.APPLE_TEAM_ID || '').trim(),
      organizationName: tenantName,
      description: `Tarjeta de lealtad ${tenantName}`,
      // logoText omitted — logo image is sufficient, text would duplicate the name
      backgroundColor: bgColor,
      foregroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(250, 235, 220)',
      webServiceURL: `${process.env.NEXT_PUBLIC_APP_URL}/api/${tenantSlug}/passes/apple`,
      sharingProhibited: true,
    } as any
  );

  // Set pass type
  pass.type = 'storeCard';

  // Helper to resolve relative URLs and fetch image buffers
  async function fetchImageBuffer(url: string): Promise<Buffer | null> {
    try {
      const fullUrl = url.startsWith('/') ? `${process.env.NEXT_PUBLIC_APP_URL}${url}` : url;
      const res = await fetch(fullUrl);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      console.warn(`[Apple Pass] Image fetch failed: ${res.status} ${fullUrl}`);
    } catch (err) {
      console.warn('[Apple Pass] Image fetch error:', err);
    }
    return null;
  }

  const { default: sharp } = await import('sharp');

  // Generate notification icons with tenant primary color background
  const hex = data.primaryColor || '#B5605A';
  const ir = parseInt(hex.slice(1, 3), 16);
  const ig = parseInt(hex.slice(3, 5), 16);
  const ib = parseInt(hex.slice(5, 7), 16);
  const iconBg = { r: ir, g: ig, b: ib, alpha: 1 };

  // Add tenant logo if available — resize to crisp @2x dimensions
  const logoBuf = data.logoUrl ? await fetchImageBuffer(data.logoUrl) : null;
  if (logoBuf) {
    const logo2x = await sharp(logoBuf)
      .resize({ height: 70, withoutEnlargement: true })
      .png()
      .toBuffer();
    pass.addBuffer('logo@2x.png', logo2x);
    const logo3x = await sharp(logoBuf)
      .resize({ height: 105, withoutEnlargement: true })
      .png()
      .toBuffer();
    pass.addBuffer('logo@3x.png', logo3x);
  }

  // Icons: use tenant-specific pre-made icons if available, otherwise auto-generate
  const iconSizes = [
    { name: 'icon.png', file: 'icon', size: 29, logoSize: 20 },
    { name: 'icon@2x.png', file: 'icon@2x', size: 58, logoSize: 40 },
    { name: 'icon@3x.png', file: 'icon@3x', size: 87, logoSize: 60 },
  ];
  for (const { name, file, size, logoSize } of iconSizes) {
    // Try tenant-specific pre-made icon first
    const customIconPath = path.join(process.cwd(), 'public', 'logos', `${tenantSlug}-${file}.png`);
    let customIcon: Buffer | null = null;
    try { customIcon = fs.readFileSync(customIconPath); } catch {}

    if (customIcon) {
      pass.addBuffer(name, await sharp(customIcon).resize(size, size).png().toBuffer());
    } else {
      const base = sharp({ create: { width: size, height: size, channels: 4, background: iconBg } });
      if (logoBuf) {
        const logoResized = await sharp(logoBuf).resize({ width: logoSize, height: logoSize, fit: 'inside' }).png().toBuffer();
        pass.addBuffer(name, await base.composite([{ input: logoResized, gravity: 'centre' }]).png().toBuffer());
      } else {
        pass.addBuffer(name, await base.png().toBuffer());
      }
    }
  }

  // Add strip image: dynamic stamp card for "stamps" style, static image otherwise
  if (data.passStyle === 'stamps') {
    try {
      // Use tenant-specific stamp images: /logos/{slug}-stamp-filled.png
      const slug = data.tenantSlug || 'app';
      const filledUrl = data.stampFilledUrl || `/logos/${slug}-stamp-filled.png`;
      const emptyUrl = data.stampEmptyUrl || `/logos/${slug}-stamp-empty.png`;
      const welcomeUrl = `/logos/${slug}-stamp-welcome.png`;
      const stripBuf = await generateStampStrip(
        data.visitsThisCycle,
        data.visitsRequired,
        filledUrl,
        emptyUrl,
        data.secondaryColor,
        welcomeUrl,
      );
      pass.addBuffer('strip@2x.png', stripBuf);
    } catch (err) {
      console.warn('[Apple Pass] Dynamic strip generation failed:', err);
    }
  } else if (data.stripImageUrl) {
    const stripBuf = await fetchImageBuffer(data.stripImageUrl);
    if (stripBuf) pass.addBuffer('strip@2x.png', stripBuf);
  }

  // Set barcode with HMAC-signed card number to prevent forged scans
  const signedBarcode = signWalletBarcode(data.cardNumber);
  pass.setBarcodes({
    message: signedBarcode,
    format: 'PKBarcodeFormatQR',
    messageEncoding: 'iso-8859-1',
    altText: data.cardNumber,
  });

  const remaining = data.visitsRequired - data.visitsThisCycle;

  // Balance header — only shown when topup/monedero is enabled
  if (data.topupEnabled !== false) {
    pass.headerFields.push({ key: 'balance', label: 'SALDO', value: formatMXN(data.balanceCentavos), textAlignment: 'PKTextAlignmentRight', changeMessage: 'Tu saldo cambió a %@' });
  }

  if (data.passStyle === 'stamps') {
    // 'stamps' passStyle — used by all seeded tenants (Ribera, Kalala, Néctar).
    // Pairs with the dynamic image strip generated above; text fields show
    // the count remaining and reward type.
    pass.secondaryFields.push({
      key: 'remaining',
      label: 'VISITAS FALTANTES',
      value: `${remaining} visita${remaining !== 1 ? 's' : ''}`,
      changeMessage: 'Visitas faltantes: %@',
    });
    pass.secondaryFields.push({
      key: 'rewards',
      label: 'RECOMPENSA',
      value: data.rewardName,
      changeMessage: 'Recompensa: %@',
    });
    // Néctar Café shows the member name on the front of the stamps pass.
    if (data.tenantSlug === 'nectarcafe') {
      pass.secondaryFields.push({ key: 'memberName', label: 'MIEMBRO', value: data.customerName });
    }
  } else {
    // 'default' passStyle — member name + textual stamp dots (●●●○○○).
    // No seeded tenant uses this; kept as an opt-in via the passStyle chip in admin settings.
    const filled = '●'.repeat(data.visitsThisCycle);
    const empty = '○'.repeat(data.visitsRequired - data.visitsThisCycle);
    pass.secondaryFields.push({ key: 'memberName', label: 'MIEMBRO', value: data.customerName });
    pass.secondaryFields.push({ key: 'stamps', label: data.rewardName.toUpperCase(), value: `${filled}${empty} (${data.visitsThisCycle}/${data.visitsRequired})`, changeMessage: 'Progreso actualizado: %@' });
  }

  // Birthday reward — shown on front of pass with lock-screen notification
  if (data.birthdayRewardName) {
    pass.auxiliaryFields.push({
      key: 'birthdayReward',
      label: 'REGALO DE CUMPLEANOS',
      value: data.birthdayRewardName,
      changeMessage: '¡Feliz cumpleaños! Tu regalo te espera: %@',
    });
  }

  // Back fields
  // Lifecycle message (welcome/winback/expiring) — placed first so it's the first thing
  // a customer sees when flipping the pass. Always present so Apple reliably fires
  // changeMessage when cron updates it from "" → text.
  pass.backFields.push({
    key: 'lifecycleMessage',
    label: 'Mensaje',
    value: data.lifecycleMessage || '',
    changeMessage: '%@',
  });
  // Promotion field on back — changeMessage still triggers lock screen notification
  pass.backFields.push({
    key: 'promo',
    label: 'Promoción especial',
    value: data.promoMessage || 'Sin promoción activa',
    changeMessage: '%@',
  });
  pass.backFields.push({ key: 'totalVisits', label: 'Visitas totales', value: String(data.totalVisits) });
  pass.backFields.push({ key: 'cardNumber', label: 'Número de tarjeta', value: data.cardNumber });
  pass.backFields.push({
    key: 'terms',
    label: 'Términos y condiciones',
    value: data.topupEnabled !== false
      ? `Válido únicamente en ${tenantName}. El saldo no es reembolsable en efectivo. Las recompensas deben canjearse en tienda. El saldo no expira.`
      : `Válido únicamente en ${tenantName}. Las recompensas deben canjearse en tienda.`,
  });
  pass.backFields.push({
    key: 'developer',
    label: '',
    value: 'Developed by Umi Consulting',
  });
  // Add geo-location triggers — surfaces pass on lock screen when nearby
  if (data.locations && data.locations.length > 0) {
    pass.setLocations(
      ...data.locations.map((loc) => ({
        latitude: loc.latitude,
        longitude: loc.longitude,
        ...(loc.relevantText ? { relevantText: loc.relevantText } : {}),
      }))
    );
  }

  const buffer = await pass.getAsBuffer();
  return { buffer, serial, authToken };
}

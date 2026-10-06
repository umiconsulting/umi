import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { PKPass } from 'passkit-generator';
import sharp from 'sharp';
import path from 'node:path';
import type { AppConfig } from '../../shared/config/config.schema';
import { QrService } from '../../shared/auth/qr.service';
import { formatMxn2 } from '../../shared/format/money';
import { generateStampStrip, loadAsset } from './stamp-strip';

/**
 * Signs one `.pkpass`.
 *
 * Ported from umi-cash `pass-apple.ts`. The field keys, their order, and every
 * `changeMessage` are reproduced exactly, because a pass is not re-issued when it
 * changes — it is REBUILT and re-signed on each request, and iOS diffs the new
 * copy against the one on the phone. A renamed key reads as "field removed, field
 * added" and loses the customer's lock-screen notification; a changed
 * `changeMessage` changes what their phone says to them.
 *
 * The pass template is a real directory (`passes/apple/template.pass`) rather
 * than an object literal, matching umi-cash. `PKPass.from` merges it, and
 * reproducing that merge by hand would be a silent behaviour change.
 *
 * WHAT MUST NEVER CHANGE for an already-issued pass:
 *   - `passTypeIdentifier` and `teamIdentifier` — they are the pass identity
 *   - `serialNumber` — the same, per pass
 *   - `authenticationToken` — the phone's copy is immutable
 *   - `webServiceURL` — Apple calls back to the host signed in at issue time
 */
@Injectable()
export class ApplePassBuilder {
  private readonly logger = new Logger(ApplePassBuilder.name);
  private readonly certs: PassCertificates | null;
  private readonly passTypeId: string;
  private readonly teamId: string;
  private readonly keyPassphrase?: string;
  private readonly origin: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly qr: QrService,
  ) {
    const cert = config.get('APPLE_SIGNER_CERT', { infer: true });
    const key = config.get('APPLE_SIGNER_KEY', { infer: true });
    const wwdr = config.get('APPLE_WWDR_CERT', { infer: true });
    this.certs =
      cert && key && wwdr
        ? {
            signerCert: Buffer.from(cert, 'base64'),
            signerKey: Buffer.from(key, 'base64'),
            wwdr: Buffer.from(wwdr, 'base64'),
          }
        : null;
    this.passTypeId = (config.get('APPLE_PASS_TYPE_ID', { infer: true }) ?? '').trim();
    this.teamId = (config.get('APPLE_TEAM_ID', { infer: true }) ?? '').trim();
    this.keyPassphrase = config.get('APPLE_KEY_PASSPHRASE', { infer: true });
    this.origin = (config.get('WALLET_PUBLIC_ORIGIN', { infer: true }) ?? '').replace(/\/$/, '');
  }

  /** False when any of the three PEMs, the pass type or the team is missing. */
  isConfigured(): boolean {
    return this.certs !== null && !!this.passTypeId && !!this.teamId && !!this.origin;
  }

  /** Where `/logos/*` brand assets live. They stay in umi-cash's `public/`. */
  assetOrigin(): string {
    return this.origin;
  }

  /** A fresh pass serial. Hex, upper case — the umi-cash format, unchanged. */
  newSerial(): string {
    return randomBytes(8).toString('hex').toUpperCase();
  }

  /** A fresh `authenticationToken`. */
  newAuthToken(): string {
    return this.qr.generateRandomToken();
  }

  async build(data: ApplePassData): Promise<Buffer> {
    if (!this.certs || !this.isConfigured()) {
      throw new Error('Apple Wallet signing is not configured');
    }
    if (!data.merchantHandle) {
      // The handle is a path segment of webServiceURL. Without it the pass would
      // install and then never update, which is the exact silent failure this
      // whole layer exists to prevent.
      throw new Error(`merchant ${data.merchantName} has no handle; cannot issue a pass`);
    }

    const handle = data.merchantHandle;
    const background = hexToRgb(data.primaryColor ?? DEFAULT_PRIMARY);

    const pass = await PKPass.from(
      {
        model: path.join(TEMPLATE_ROOT, 'template.pass'),
        certificates: {
          wwdr: this.certs.wwdr,
          signerCert: this.certs.signerCert,
          signerKey: this.certs.signerKey,
          signerKeyPassphrase: this.keyPassphrase,
        },
      },
      {
        serialNumber: data.serial,
        authenticationToken: data.authToken,
        passTypeIdentifier: this.passTypeId,
        teamIdentifier: this.teamId,
        organizationName: data.merchantName,
        description: `Tarjeta de lealtad ${data.merchantName}`,
        backgroundColor: background,
        foregroundColor: 'rgb(255, 255, 255)',
        labelColor: 'rgb(250, 235, 220)',
        webServiceURL: `${this.origin}/api/${handle}/passes/apple`,
        sharingProhibited: true,
      },
    );

    pass.type = 'storeCard';

    await this.addImages(pass, data, handle);
    this.addBarcode(pass, data);
    this.addFields(pass, data, handle);
    this.addLocations(pass, data);

    return pass.getAsBuffer();
  }

  // ─── images ────────────────────────────────────────────────────────────────

  private async addImages(pass: PKPass, data: ApplePassData, handle: string): Promise<void> {
    const logoBuf = data.logoUrl ? await this.tryAsset(data.logoUrl) : null;

    if (logoBuf) {
      pass.addBuffer(
        'logo@2x.png',
        await sharp(logoBuf).resize({ height: 70, withoutEnlargement: true }).png().toBuffer(),
      );
      pass.addBuffer(
        'logo@3x.png',
        await sharp(logoBuf).resize({ height: 105, withoutEnlargement: true }).png().toBuffer(),
      );
    }

    // Icons: a café-supplied icon if one is published, otherwise the logo centred
    // on the brand colour. An icon is mandatory — a pass without one fails to
    // install, so this branch may never produce nothing.
    const brand = hexToRgba(data.primaryColor ?? DEFAULT_PRIMARY);
    for (const { name, file, size, logoSize } of ICON_SIZES) {
      const custom = await this.tryAsset(`/logos/${handle}-${file}.png`);
      if (custom) {
        pass.addBuffer(name, await sharp(custom).resize(size, size).png().toBuffer());
        continue;
      }
      const base = sharp({
        create: { width: size, height: size, channels: 4, background: brand },
      });
      if (logoBuf) {
        const inner = await sharp(logoBuf)
          .resize({ width: logoSize, height: logoSize, fit: 'inside' })
          .png()
          .toBuffer();
        pass.addBuffer(
          name,
          await base
            .composite([{ input: inner, gravity: 'centre' }])
            .png()
            .toBuffer(),
        );
      } else {
        pass.addBuffer(name, await base.png().toBuffer());
      }
    }

    // The strip: a drawn stamp card for the 'stamps' style, a fixed image
    // otherwise. A failure here degrades the pass, it does not invalidate it, so
    // it is logged and swallowed exactly as umi-cash does.
    if (data.passStyle === 'stamps') {
      try {
        pass.addBuffer(
          'strip@2x.png',
          await generateStampStrip({
            visitsThisCycle: data.visitsThisCycle,
            visitsRequired: data.visitsRequired,
            filledStampUrl: `/logos/${handle}-stamp-filled.png`,
            emptyStampUrl: `/logos/${handle}-stamp-empty.png`,
            welcomeStampUrl: `/logos/${handle}-stamp-welcome.png`,
            backgroundColor: data.secondaryColor,
            assetBase: this.origin,
          }),
        );
      } catch (err) {
        this.logger.warn(`strip generation failed for ${handle}: ${String(err)}`);
      }
    } else if (data.stripImageUrl) {
      const strip = await this.tryAsset(data.stripImageUrl);
      if (strip) pass.addBuffer('strip@2x.png', strip);
    }
  }

  private async tryAsset(url: string): Promise<Buffer | null> {
    return loadAsset(url, this.origin).catch(() => null);
  }

  // ─── content ───────────────────────────────────────────────────────────────

  private addBarcode(pass: PKPass, data: ApplePassData): void {
    pass.setBarcodes({
      message: this.qr.signWalletBarcode(data.cardNumber),
      format: 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
      altText: data.cardNumber,
    });
  }

  private addFields(pass: PKPass, data: ApplePassData, handle: string): void {
    const remaining = data.visitsRequired - data.visitsThisCycle;

    // Saldo only exists for cafés that sell stored value.
    if (data.topupEnabled) {
      pass.headerFields.push({
        key: 'balance',
        label: 'SALDO',
        value: formatMxn2(data.balanceCentavos),
        textAlignment: 'PKTextAlignmentRight',
        changeMessage: 'Tu saldo cambió a %@',
      });
    }

    if (data.passStyle === 'stamps') {
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
      // Néctar Café asked for the member name on the front of the stamps pass.
      if (handle === 'nectarcafe') {
        pass.secondaryFields.push({
          key: 'memberName',
          label: 'MIEMBRO',
          value: data.customerName,
        });
      }
    } else {
      const filled = '●'.repeat(data.visitsThisCycle);
      const empty = '○'.repeat(remaining);
      pass.secondaryFields.push({ key: 'memberName', label: 'MIEMBRO', value: data.customerName });
      pass.secondaryFields.push({
        key: 'stamps',
        label: data.rewardName.toUpperCase(),
        value: `${filled}${empty} (${data.visitsThisCycle}/${data.visitsRequired})`,
        changeMessage: 'Progreso actualizado: %@',
      });
    }

    if (data.birthdayRewardName) {
      pass.auxiliaryFields.push({
        key: 'birthdayReward',
        label: 'REGALO DE CUMPLEANOS',
        value: data.birthdayRewardName,
        changeMessage: '¡Feliz cumpleaños! Tu regalo te espera: %@',
      });
    }

    // The lifecycle message is always present, even empty. Apple fires a
    // changeMessage on a value that CHANGES; a field that appears for the first
    // time is a new field and stays silent. Keeping the empty string means the
    // cron's "" → text write reaches the lock screen.
    pass.backFields.push({
      key: 'lifecycleMessage',
      label: 'Mensaje',
      value: data.lifecycleMessage ?? '',
      changeMessage: '%@',
    });
    pass.backFields.push({
      key: 'promo',
      label: 'Promoción especial',
      value: data.promoMessage ?? 'Sin promoción activa',
      changeMessage: '%@',
    });
    pass.backFields.push({
      key: 'totalVisits',
      label: 'Visitas totales',
      value: String(data.totalVisits),
    });
    pass.backFields.push({
      key: 'cardNumber',
      label: 'Número de tarjeta',
      value: data.cardNumber,
    });
    pass.backFields.push({
      key: 'terms',
      label: 'Términos y condiciones',
      value: data.topupEnabled
        ? `Válido únicamente en ${data.merchantName}. El saldo no es reembolsable en efectivo. Las recompensas deben canjearse en tienda. El saldo no expira.`
        : `Válido únicamente en ${data.merchantName}. Las recompensas deben canjearse en tienda.`,
    });
    pass.backFields.push({ key: 'developer', label: '', value: 'Developed by Umi Consulting' });
  }

  /**
   * The geofences that put the pass on the lock screen near the café.
   *
   * These are rebuilt on every render and never carried over from the copy on the
   * phone, so an empty list here silently REMOVES nearby behaviour from a pass
   * that had it. That is worth a log line: nothing else reports it.
   */
  private addLocations(pass: PKPass, data: ApplePassData): void {
    if (data.locations.length === 0) {
      this.logger.warn(
        `pass ${data.serial} built with no geofences; ` +
          `merchant.location has no active row with coordinates`,
      );
      return;
    }
    pass.setLocations(
      ...data.locations.map((l) => ({
        latitude: l.latitude,
        longitude: l.longitude,
        relevantText: `¡Bienvenido a ${data.merchantName}!`,
      })),
    );
  }
}

// ─── types and constants ─────────────────────────────────────────────────────

export interface ApplePassData {
  serial: string;
  authToken: string;
  cardNumber: string;
  customerName: string;
  merchantName: string;
  merchantHandle: string | null;
  balanceCentavos: number;
  visitsThisCycle: number;
  visitsRequired: number;
  totalVisits: number;
  rewardName: string;
  passStyle: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  stripImageUrl: string | null;
  promoMessage: string | null;
  lifecycleMessage: string | null;
  birthdayRewardName?: string | null;
  topupEnabled: boolean;
  locations: { latitude: number; longitude: number }[];
}

interface PassCertificates {
  signerCert: Buffer;
  signerKey: Buffer;
  wwdr: Buffer;
}

/** The umi-cash default brand colour, kept so an unbranded café looks the same. */
const DEFAULT_PRIMARY = '#B5605A';

const TEMPLATE_ROOT = path.join(process.cwd(), 'passes', 'apple');

const ICON_SIZES = [
  { name: 'icon.png', file: 'icon', size: 29, logoSize: 20 },
  { name: 'icon@2x.png', file: 'icon@2x', size: 58, logoSize: 40 },
  { name: 'icon@3x.png', file: 'icon@3x', size: 87, logoSize: 60 },
] as const;

function hexToRgb(hex: string): string {
  const { r, g, b } = splitHex(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgba(hex: string): { r: number; g: number; b: number; alpha: number } {
  return { ...splitHex(hex), alpha: 1 };
}

function splitHex(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

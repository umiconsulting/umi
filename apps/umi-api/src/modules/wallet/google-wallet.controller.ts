import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CustomerTokenService } from '../../shared/auth/customer-token.service';
import { WalletPassService } from './wallet-pass.service';
import { generateStampStrip } from './stamp-strip';

/** No real loyalty program asks for more stamps than this. */
const MAX_REQUIRED = 20;

/**
 * The Google Wallet surface: one customer route, one anonymous image route.
 *
 * Google is push-only. Nothing calls back, so — unlike Apple — no URL is frozen
 * inside an issued pass and there is no web service to host. The one exception is
 * the hero image below, whose URL Google stores on the object and fetches
 * server-side, which is why it lives on the same host and is proxied the same way.
 */
@Controller('api/:handle')
export class GoogleWalletController {
  constructor(
    private readonly wallet: WalletPassService,
    private readonly customerToken: CustomerTokenService,
  ) {}

  /** The "Add to Google Wallet" link. Called by the umi-cash card page. */
  @Get('passes/google')
  async save(
    @Param('handle') handle: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const claims = await this.customerToken.fromHeader(req.headers.authorization);
    if (!claims) return void reply.status(401).send({ error: 'No autorizado' });
    if (!this.wallet.isGoogleConfigured()) {
      return void reply
        .status(503)
        .send({ error: 'Google Wallet no está configurado.', configured: false });
    }

    const merchant = await this.wallet.merchantByHandle(handle);
    if (!merchant) return void reply.status(404).send({ error: 'Merchant no encontrado' });
    if (merchant.id !== claims.merchantId) {
      return void reply.status(403).send({ error: 'No autorizado' });
    }

    const saveUrl = await this.wallet.googleSaveUrl(merchant.id, claims.subjectId);
    reply.status(200).send({ saveUrl });
  }

  /**
   * The stamp-card image Google shows on the pass.
   *
   * CONTENT-ADDRESSED, and that is the whole design. The URL carries the exact
   * state — `/stamp-strip/{filled}-{required}.png` — so the bytes for a state
   * never change and the response can be cached forever. When a customer earns a
   * stamp, the object points at a DIFFERENT url and Google fetches it fresh. A
   * fixed url would be served from Google's image cache and never update again.
   *
   * ANONYMOUS on purpose: Google fetches it server-side with no credentials, and
   * the url carries no personal data — only a handle and two counts — so every
   * customer at the same state shares one cached image.
   */
  @Get('stamp-strip/:state')
  async stampStrip(
    @Param('handle') handle: string,
    @Param('state') state: string,
    @Query('bg') bg: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const match = state.replace(/\.png$/i, '').match(/^(\d+)-(\d+)$/);
    if (!match) return void reply.status(400).send('Invalid state');

    const required = Number.parseInt(match[2], 10);
    if (!Number.isInteger(required) || required < 1 || required > MAX_REQUIRED) {
      return void reply.status(400).send('Invalid required');
    }
    const filled = Math.max(0, Math.min(Number.parseInt(match[1], 10), required));

    // Background colour, in order: an explicit override, then the café's secondary
    // colour, then transparent — which inherits the card background. The lookup is
    // best-effort: this route is a pure image and must not need the database.
    let background: string | null = bg ? (bg.startsWith('#') ? bg : `#${bg}`) : null;
    if (!background) {
      background = await this.wallet.stripBackgroundForHandle(handle).catch(() => null);
    }

    try {
      const png = await generateStampStrip({
        visitsThisCycle: filled,
        visitsRequired: required,
        filledStampUrl: `/logos/${handle}-stamp-filled.png`,
        emptyStampUrl: `/logos/${handle}-stamp-empty.png`,
        welcomeStampUrl: `/logos/${handle}-stamp-welcome.png`,
        backgroundColor: background,
        assetBase: this.wallet.assetOrigin(),
      });
      reply
        .status(200)
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(png);
    } catch {
      reply.status(500).send('Error generating strip');
    }
  }
}

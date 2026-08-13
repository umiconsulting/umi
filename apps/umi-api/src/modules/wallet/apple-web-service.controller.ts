import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Query,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CustomerTokenService } from '../../shared/auth/customer-token.service';
import { WalletPassService } from './wallet-pass.service';

/**
 * Apple's PassKit web service, exactly as Apple calls it.
 *
 * THE PATH IS FROZEN. Every issued `.pkpass` carries
 * `https://cash.umiconsulting.co/api/{handle}/passes/apple` as its
 * `webServiceURL`, signed in at issue time, and the copy on a customer's phone
 * can never be changed. Apple appends `/v1/...` to it. The routes below reproduce
 * that shape character for character so umi-cash can forward the prefix
 * untouched — a rewrite anywhere in this path is a 404 that no test and no gate
 * would see, on a real customer's phone.
 *
 * NO UMI GUARD RUNS HERE, deliberately. Apple presents no session, no cookie and
 * no merchant — it knows none of them. It presents
 * `Authorization: ApplePass <token>`, and that token is the whole authentication:
 * it was signed into the pass and is verified in constant time against
 * `merchant.loyalty_wallet_pass.web_service_token`. Adding an Umi guard here
 * would reject Apple.
 *
 * Status codes are Apple's, not ours:
 *   201 registered · 200 already registered · 204 nothing changed · 401 bad token
 */
@Controller('api/:handle/passes/apple')
export class AppleWebServiceController {
  private readonly logger = new Logger('ApplePassDeviceLog');

  constructor(
    private readonly wallet: WalletPassService,
    private readonly customerToken: CustomerTokenService,
  ) {}

  /**
   * The customer downloads their own pass. Creates it on the first tap.
   *
   * This is the ONE route here that a person calls rather than Apple, so it is
   * the one that carries an Umi customer session — `Authorization: Bearer <jwt>`,
   * not `ApplePass`. The umi-cash card page and the registration page both hit it.
   *
   * Without this route a NEW customer gets no pass at all. Existing passes are
   * unaffected by it.
   */
  @Get()
  async issue(
    @Param('handle') handle: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const claims = await this.customerToken.fromHeader(req.headers.authorization);
    if (!claims) return void reply.status(401).send({ error: 'No autorizado' });
    if (!this.wallet.isConfigured()) {
      return void reply
        .status(503)
        .send({ error: 'Apple Wallet no está configurado.', configured: false });
    }

    const merchant = await this.wallet.merchantByHandle(handle);
    if (!merchant) return void reply.status(404).send({ error: 'Merchant no encontrado' });
    // The session names its own café. A token for one café may not download a
    // pass from another, even though the handle is in the caller's control.
    if (merchant.id !== claims.merchantId) {
      return void reply.status(403).send({ error: 'No autorizado' });
    }

    const { buffer, handle: filename } = await this.wallet.issuePass(merchant.id, claims.subjectId);
    reply
      .status(200)
      .header('Content-Type', 'application/vnd.apple.pkpass')
      .header('Content-Disposition', `inline; filename="${filename}.pkpass"`)
      .header('Cache-Control', 'no-store')
      .send(buffer);
  }

  /** Register a device to receive updates for one pass. */
  @Post('v1/devices/:deviceId/registrations/:passTypeId/:serial')
  async register(
    @Param('deviceId') deviceId: string,
    @Param('serial') serial: string,
    @Body() body: { pushToken?: string },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pass = await this.authed(req, serial);
    if (!pass) return void reply.status(401).send();
    if (!body?.pushToken) return void reply.status(400).send();

    const created = await this.wallet.registerDevice(pass.walletPassId, deviceId, body.pushToken);
    reply.status(created ? 201 : 200).send();
  }

  /** Forget a device. The customer removed the pass, or the device was wiped. */
  @Delete('v1/devices/:deviceId/registrations/:passTypeId/:serial')
  async unregister(
    @Param('deviceId') deviceId: string,
    @Param('serial') serial: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pass = await this.authed(req, serial);
    if (!pass) return void reply.status(401).send();

    await this.wallet.unregisterDevice(pass.walletPassId, deviceId);
    reply.status(200).send();
  }

  /**
   * List the serials that changed since the device last asked.
   *
   * Apple sends `passesUpdatedSince` as a unix second count taken from the
   * `lastUpdated` we returned previously. 204 means nothing changed, and Apple
   * treats an empty 200 body as an error, so the distinction matters.
   */
  @Get('v1/devices/:deviceId/registrations/:passTypeId')
  async listSerials(
    @Param('handle') handle: string,
    @Param('deviceId') deviceId: string,
    @Query('passesUpdatedSince') passesUpdatedSince: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const parsed = Number(passesUpdatedSince);
    const since = Number.isFinite(parsed) && parsed > 0 ? new Date(parsed * 1000) : new Date(0);

    const serialNumbers = await this.wallet.serialsUpdatedSince(handle, deviceId, since);
    if (serialNumbers.length === 0) return void reply.status(204).send();

    reply.status(200).send({
      serialNumbers,
      lastUpdated: String(Math.floor(Date.now() / 1000)),
    });
  }

  /** Serve the current pass. Rebuilt and re-signed on every call. */
  @Get('v1/passes/:passTypeId/:serial')
  async getPass(
    @Param('serial') serial: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pass = await this.authed(req, serial);
    if (!pass) return void reply.status(401).send();
    if (!this.wallet.isConfigured()) return void reply.status(500).send();

    const { buffer, lastModified } = await this.wallet.renderPass(pass);
    reply
      .status(200)
      .header('Content-Type', 'application/vnd.apple.pkpass')
      .header('Last-Modified', lastModified.toUTCString())
      // A cached .pkpass is a stale stamp count. Never store it.
      .header('Cache-Control', 'no-store')
      .send(buffer);
  }

  /**
   * Apple's device-side error log.
   *
   * Worth keeping rather than discarding: when a pass stops updating, this is the
   * only place the phone says why, and the failure is otherwise silent on both
   * sides.
   */
  @Post('v1/log')
  log(@Body() body: { logs?: string[] }, @Res() reply: FastifyReply): void {
    for (const line of body?.logs ?? []) {
      this.logger.warn(line);
    }
    reply.status(200).send();
  }

  /** `Authorization: ApplePass <token>` → the pass it authenticates, or null. */
  private authed(req: FastifyRequest, serial: string) {
    const header = req.headers.authorization;
    if (!header?.startsWith('ApplePass ')) return Promise.resolve(null);
    return this.wallet.authenticate(serial, header.slice('ApplePass '.length));
  }
}

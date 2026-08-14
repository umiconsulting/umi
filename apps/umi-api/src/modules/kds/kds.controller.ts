import { Controller, Logger, Options, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { KdsService } from './kds.service';
import { KdsHttpError, KDS_DEVICE_TOKEN_HEADER } from './dto/kds-contract';

const PAIRING_ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type, x-umi-user-id';
const DEVICE_ALLOW_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-kds-device-token';

/**
 * FROZEN iPad-facing KDS endpoints (spec §8.1). These bypass Nest's normal
 * response shaping and the global `AllExceptionsFilter` by owning the Fastify
 * reply via `@Res()` — the Swift client depends on the EXACT JSON/status/headers
 * (e.g. the `device_revoked` body), and the global filter's `{statusCode,error,…}`
 * envelope would break the contract. `@Body()` is deliberately NOT used (the
 * global `whitelist` ValidationPipe would strip the un-DTO'd body); we read
 * `req.body` directly. Both the new paths and the legacy `/functions/v1/*`
 * aliases are registered so already-installed builds keep working at cutover.
 */
@Controller()
export class KdsController {
  private readonly logger = new Logger(KdsController.name);

  constructor(private readonly kds: KdsService) {}

  // ── pairing (no device auth) ───────────────────────────────────────────────

  @Options(['kds/pairing', 'functions/v1/kds-pairing'])
  pairingPreflight(@Res() reply: FastifyReply): void {
    preflight(reply, PAIRING_ALLOW_HEADERS);
  }

  @Post(['kds/pairing', 'functions/v1/kds-pairing'])
  async pairing(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    cors(reply, PAIRING_ALLOW_HEADERS);
    const body = readJson(req);
    if (!body) return send(reply, 400, { error: 'invalid_json' });
    try {
      const r = await this.kds.pairing(body, req.ip ?? null);
      return send(reply, r.status, r.body);
    } catch (err) {
      // Public pairing is unauthenticated — keep the body generic (never leak
      // DB/schema internals) and record the cause server-side.
      this.logger.error(
        `kds pairing error: ${errMessage(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return send(reply, 500, { error: 'internal_error' });
    }
  }

  // ── board (device auth) ────────────────────────────────────────────────────

  @Options(['kds/board', 'functions/v1/kds-board'])
  boardPreflight(@Res() reply: FastifyReply): void {
    preflight(reply, DEVICE_ALLOW_HEADERS);
  }

  @Post(['kds/board', 'functions/v1/kds-board'])
  async board(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    cors(reply, DEVICE_ALLOW_HEADERS);
    const body = readJson(req);
    if (!body) return send(reply, 400, { error: 'invalid_json' });
    try {
      const session = await this.kds.verifyDevice(deviceToken(req));
      const r = await this.kds.board(session, body);
      return send(reply, r.status, r.body);
    } catch (err) {
      if (err instanceof KdsHttpError) return send(reply, err.status, err.body);
      this.logger.error(
        `kds board error: ${errMessage(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return send(reply, 500, { error: 'internal_error' });
    }
  }

  // ── command (device auth) ──────────────────────────────────────────────────

  @Options(['kds/command', 'functions/v1/kds-command'])
  commandPreflight(@Res() reply: FastifyReply): void {
    preflight(reply, DEVICE_ALLOW_HEADERS);
  }

  @Post(['kds/command', 'functions/v1/kds-command'])
  async command(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    cors(reply, DEVICE_ALLOW_HEADERS);
    const body = readJson(req);
    if (!body) return send(reply, 400, { error: 'invalid_json' });
    try {
      const session = await this.kds.verifyDevice(deviceToken(req));
      const r = await this.kds.command(session, body);
      return send(reply, r.status, r.body);
    } catch (err) {
      if (err instanceof KdsHttpError) return send(reply, err.status, err.body);
      this.logger.error(
        `kds command error: ${errMessage(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return send(reply, 500, { error: 'internal_error' });
    }
  }

  // ── heartbeat (unauth; device_id is the credential) ───────────────────────

  @Post('api/kds/heartbeat')
  async heartbeat(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    cors(reply, DEVICE_ALLOW_HEADERS);
    const body = readJson(req) ?? {};
    const r = await this.kds.heartbeat(body, req.ip ?? null);
    return send(reply, r.status, r.body);
  }
}

// ── reply helpers ──────────────────────────────────────────────────────────

function cors(reply: FastifyReply, allowHeaders: string): void {
  void reply.header('Access-Control-Allow-Origin', '*');
  void reply.header('Access-Control-Allow-Headers', allowHeaders);
}

function preflight(reply: FastifyReply, allowHeaders: string): void {
  cors(reply, allowHeaders);
  void reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  void reply.status(200).send('ok');
}

function send(reply: FastifyReply, status: number, body: unknown): void {
  void reply.status(status).send(body);
}

function readJson(req: FastifyRequest): Record<string, unknown> | null {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

function deviceToken(req: FastifyRequest): string | undefined {
  const h = req.headers[KDS_DEVICE_TOKEN_HEADER];
  return Array.isArray(h) ? h[0] : h;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : JSON.stringify(err);
}

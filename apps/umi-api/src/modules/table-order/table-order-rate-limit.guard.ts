import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import type { TableOrderRequest } from './table-order-credential.guard';

const WINDOW = 15 * 60 * 1000;

/**
 * Abuse control for the only two routes in the platform a stranger can write an ORDER
 * through.
 *
 * The shape is `CashCustomerController`'s, which is the existing public money-adjacent
 * surface: per-IP buckets from the ported fixed-window limiter, `Retry-After` on
 * exhaustion, and the same 429 envelope. The global `IpRateLimitGuard` already bounds
 * every address; these buckets are tighter and they bound the CREDENTIAL as well, so one
 * photographed QR cannot be used to flood a single table's bill from many addresses.
 *
 * THE TWO BUCKETS ARE DELIBERATELY ASYMMETRIC. Reading the menu is what a page does on
 * open and on every category switch, so its ceiling is generous; placing an order is
 * rare and each one lands on a real table's tab, so it is tight. Both are sized for a
 * table of eight sharing one phone hotspot and for a page that reloads.
 */
@Injectable()
export class TableOrderRateLimitGuard implements CanActivate {
  constructor(private readonly limits: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const request = http.getRequest<TableOrderRequest & FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    if ((request.method ?? 'GET').toUpperCase() === 'GET') {
      this.hit(reply, `table-order-menu:${clientIp(request)}`, 120);
      return true;
    }

    const credentialId = request.tableOrderCredential?.credentialId;
    this.hit(reply, `table-order-place:${clientIp(request)}`, 30);
    // TWELVE, not six. A table ordering in rounds reaches four orders without trying,
    // and every schema or state refusal costs an attempt — so a ceiling tight enough to
    // stop abuse must still leave room for a table of eight that mistyped twice. The
    // per-address bucket above catches a caller rotating codes; this one catches one
    // photographed QR being used to flood a single bill.
    if (credentialId) this.hit(reply, `table-order-place-table:${credentialId}`, 12);
    return true;
  }

  /** One bucket; on exhaustion set Retry-After and refuse. */
  private hit(reply: FastifyReply, key: string, max: number): void {
    const result = this.limits.hit(key, max, WINDOW);
    if (!result.allowed) {
      void reply.header('Retry-After', String(Math.ceil((result.resetAt - Date.now()) / 1000)));
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message:
            'Demasiados pedidos desde este dispositivo. Espera un momento e inténtalo de nuevo.',
        },
        429,
      );
    }
  }
}

/**
 * Fastify resolves `req.ip` from X-Forwarded-For using its configured trustProxy hop
 * count (main.ts). Trusting the raw leftmost XFF here instead would let a caller spoof
 * the header and rotate past the per-IP buckets — the same reasoning
 * `CashCustomerController.clientIp` records.
 */
function clientIp(request: FastifyRequest): string {
  return request.ip || 'unknown';
}

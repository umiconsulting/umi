import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '../../shared/auth/jwt.service';
import { CustomerTokenService } from '../../shared/auth/customer-token.service';
import { getRequestContext } from '../../shared/database/request-context';
import { ACCESS_COOKIE, type AuthedRequest } from './auth.types';
import { IS_PUBLIC } from './public.decorator';
import { ACCEPT_REGISTER_TOKEN, REGISTER_STAFF_ROLES } from './register-token.decorator';

/**
 * Verifies the `umi_access` JWT cookie (D9), attaches `req.authUser`, and
 * populates the AsyncLocalStorage request context's `userId` so repositories
 * can establish RLS. Routes opt out with `@Public()` (login, refresh, health).
 *
 * SECOND CREDENTIAL, ON ROUTES THAT ASK FOR IT. A route marked
 * `@AcceptRegisterToken()` also accepts the till's `Authorization: Bearer`,
 * because `apps/umi-cash/src/lib/authed-fetch.ts` sends nothing else and that
 * client is frozen. The cookie is tried first, so the dashboard's path is
 * unchanged and a request carrying both is judged as the dashboard.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly registerTokens: CustomerTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[ACCESS_COOKIE];

    if (!token) {
      const accepts = this.reflector.getAllAndOverride<boolean>(ACCEPT_REGISTER_TOKEN, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (accepts && (await this.authenticateRegister(req))) return true;
      throw new UnauthorizedException('authentication_required');
    }

    const claims = await this.jwt.verifyAccess(token);
    req.authUser = { id: claims.sub, email: claims.email };

    const ctx = getRequestContext();
    if (ctx) ctx.userId = claims.sub;

    return true;
  }

  /**
   * The till's session, or nothing.
   *
   * ⚠️ THE ROLE CHECK IS THE WHOLE SECURITY OF THIS METHOD, and it is not
   * belt-and-braces. `JWT_ACCESS_SECRET` signs the CUSTOMER's session with the
   * same algorithm, the same claim names and the same issuer — which is to say a
   * customer's own token is a perfectly valid signature here. What separates a
   * barista from a customer is one string.
   *
   * Read `subjectId` only AFTER the role is known to be a staff one. It is a
   * `umi.user.id` for staff and a `merchant.customer.id` for a customer: two
   * different tables, and treating one as the other is how a customer would be
   * handed a staff membership lookup.
   *
   * `MerchantAccessGuard` still has to agree — membership is checked there, and
   * `registerMerchantId` pins the café the session was opened at.
   */
  private async authenticateRegister(req: AuthedRequest): Promise<boolean> {
    const header = (req as { headers?: Record<string, string | undefined> }).headers?.authorization;
    const claims = await this.registerTokens.fromSharedAccessHeader(header);
    if (!claims) return false;
    if (!claims.role || !REGISTER_STAFF_ROLES.has(claims.role)) return false;

    // No email in a till token, and none is needed: every register route reads
    // `user.id`. An empty string here would read as an address nobody has.
    req.authUser = { id: claims.subjectId, email: null };
    req.registerMerchantId = claims.merchantId;

    const ctx = getRequestContext();
    if (ctx) ctx.userId = claims.subjectId;

    return true;
  }
}

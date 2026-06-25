import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '../../shared/auth/jwt.service';
import { getRequestContext } from '../../shared/database/request-context';
import { ACCESS_COOKIE, type AuthedRequest } from './auth.types';
import { IS_PUBLIC } from './public.decorator';

/**
 * Verifies the `umi_access` JWT cookie (D9), attaches `req.authUser`, and
 * populates the AsyncLocalStorage request context's `userId` so repositories
 * can establish RLS. Routes opt out with `@Public()` (login, refresh, health).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('authentication_required');

    const claims = await this.jwt.verifyAccess(token);
    req.authUser = { id: claims.sub, email: claims.email };

    const ctx = getRequestContext();
    if (ctx) ctx.userId = claims.sub;

    return true;
  }
}

import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_COOKIE, CSRF_COOKIE, type AuthedRequest } from './auth.types';
import { IS_PUBLIC } from './public.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest & { method?: string }>();
    if (SAFE_METHODS.has((request.method ?? 'GET').toUpperCase())) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const authorization = request.headers?.authorization;
    if (
      !request.cookies?.[ACCESS_COOKIE] &&
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ')
    ) {
      return true;
    }
    if (!request.cookies?.[ACCESS_COOKIE]) return true;

    const cookieToken = request.cookies[CSRF_COOKIE];
    const headerValue = request.headers?.['x-umi-csrf'];
    const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!cookieToken || !headerToken || !sameToken(cookieToken, headerToken)) {
      throw new ForbiddenException({ code: 'CSRF_VALIDATION_FAILED' });
    }
    return true;
  }
}

function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

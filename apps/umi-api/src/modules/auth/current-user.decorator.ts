import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser, AuthedRequest, MerchantAccess } from './auth.types';
import type { PublicMerchant } from './public-merchant.guard';

/** Injects the authenticated principal (set by AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().authUser;
  },
);

/** Injects the resolved merchant membership (set by MerchantAccessGuard). */
export const Merchant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): MerchantAccess | undefined => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().merchantAccess;
  },
);

/** Injects the public merchant (set by PublicMerchantGuard) for no-login routes. */
export const PubMerchant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicMerchant | undefined => {
    return ctx.switchToHttp().getRequest<AuthedRequest & { publicMerchant?: PublicMerchant }>()
      .publicMerchant;
  },
);

import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { CustomerAuthGuard } from './customer-auth.guard';

type Req = Record<string, unknown>;

function ctx(req: Req) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as never;
}

function guard(claims: { subjectId: string; merchantId: string } | null) {
  const tokens = { fromHeader: vi.fn().mockResolvedValue(claims) };
  return { g: new CustomerAuthGuard(tokens as never), tokens };
}

describe('CustomerAuthGuard', () => {
  const HEADERS = { authorization: 'Bearer t' };

  it('admits a customer whose token was minted for this café', async () => {
    const { g } = guard({ subjectId: 'cust-1', merchantId: 'm1' });
    const req: Req = { headers: HEADERS, publicMerchant: { merchantId: 'm1' } };

    await expect(g.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.customerAuth).toEqual({ customerId: 'cust-1', merchantId: 'm1' });
  });

  it('401s when there is no usable token', async () => {
    const { g } = guard(null);

    await expect(
      g.canActivate(ctx({ headers: {}, publicMerchant: { merchantId: 'm1' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  /**
   * The check this guard exists for. A valid token proves who she is, not which
   * café she belongs to — and PublicMerchantGuard has already pointed RLS at the
   * café in the URL, so without this the queries would answer for that café.
   */
  it('403s a valid token minted for a different café', async () => {
    const { g } = guard({ subjectId: 'cust-1', merchantId: 'other-cafe' });

    await expect(
      g.canActivate(ctx({ headers: HEADERS, publicMerchant: { merchantId: 'm1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s rather than admitting when the merchant was never resolved', async () => {
    const { g } = guard({ subjectId: 'cust-1', merchantId: 'm1' });

    await expect(g.canActivate(ctx({ headers: HEADERS }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

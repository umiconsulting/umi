import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SignJWT } from 'jose';
import { AuthGuard } from './auth.guard';
import { CustomerAuthGuard } from './customer-auth.guard';
import { MerchantAccessGuard } from './merchant-access.guard';
import { CustomerTokenService } from '../../shared/auth/customer-token.service';
import { ACCEPT_REGISTER_TOKEN } from './register-token.decorator';

/**
 * ONE KEY, TWO AUDIENCES.
 *
 * `JWT_ACCESS_SECRET` signs the barista's session and the customer's session
 * alike — same algorithm, same claim names, same issuer. A signature therefore
 * says nothing about WHICH of the two is calling, and every token below is
 * genuinely signed. What separates them is one claim, and these tests are what
 * make reading it load-bearing rather than decorative.
 *
 * Nothing here is mocked at the crypto boundary on purpose. A stubbed verifier
 * would let the guards agree with themselves.
 */

const SECRET = 'test-access-secret-thirty-two-plus-chars';
const CAFE_A = '9f000000-0000-4000-8000-00000000a001';
const CAFE_B = '9f000000-0000-4000-8000-00000000b002';
const USER = '9f000000-0000-4000-8000-00000000u001'.replace('u', '1');
const CUSTOMER = '9f000000-0000-4000-8000-00000000c001'.replace('c', '2');

function tokens(secret = SECRET): CustomerTokenService {
  return new CustomerTokenService({ get: () => secret } as never);
}

async function sign(claims: Record<string, unknown>, secret = SECRET): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

function ctxFor(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** A reflector that answers only for `@AcceptRegisterToken()`. */
function reflectorAccepting(accepts: boolean): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) =>
      key === ACCEPT_REGISTER_TOKEN ? accepts : undefined,
    ),
  } as unknown as Reflector;
}

const jwtNeverCalled = { verifyAccess: vi.fn() };

function guard(accepts: boolean, secret = SECRET): AuthGuard {
  return new AuthGuard(jwtNeverCalled as never, reflectorAccepting(accepts), tokens(secret));
}

describe('the register signs in with the credential umi-cash actually sends', () => {
  it('admits a STAFF bearer on a route that asks for it', async () => {
    const req: Record<string, unknown> = {
      cookies: {},
      headers: {
        authorization: `Bearer ${await sign({ sub: USER, role: 'STAFF', merchantId: CAFE_A })}`,
      },
    };
    expect(await guard(true).canActivate(ctxFor(req))).toBe(true);
    expect(req.authUser).toEqual({ id: USER, email: null });
    expect(req.registerMerchantId).toBe(CAFE_A);
  });

  it('admits an ADMIN bearer too — the register mints exactly these two', async () => {
    const req: Record<string, unknown> = {
      cookies: {},
      headers: {
        authorization: `Bearer ${await sign({ sub: USER, role: 'ADMIN', merchantId: CAFE_A })}`,
      },
    };
    expect(await guard(true).canActivate(ctxFor(req))).toBe(true);
  });

  /** THE ESCALATION TEST. Delete the role check and this is the test that fails. */
  it('REFUSES a CUSTOMER bearer, though the signature is perfectly valid', async () => {
    const token = await sign({ sub: CUSTOMER, role: 'CUSTOMER', merchantId: CAFE_A });
    // Prove the token itself is not the problem: it verifies.
    expect(await tokens().verify(token)).toEqual({
      subjectId: CUSTOMER,
      merchantId: CAFE_A,
      role: 'CUSTOMER',
    });
    const req = { cookies: {}, headers: { authorization: `Bearer ${token}` } };
    await expect(guard(true).canActivate(ctxFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a bearer that carries no role at all', async () => {
    const req = {
      cookies: {},
      headers: { authorization: `Bearer ${await sign({ sub: USER, merchantId: CAFE_A })}` },
    };
    await expect(guard(true).canActivate(ctxFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a STAFF bearer on a route that did NOT opt in', async () => {
    // The dashboard surface has no reason to accept a till token. If this ever
    // passes, the opt-in has become a global widening.
    const req = {
      cookies: {},
      headers: {
        authorization: `Bearer ${await sign({ sub: USER, role: 'STAFF', merchantId: CAFE_A })}`,
      },
    };
    await expect(guard(false).canActivate(ctxFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a STAFF bearer signed with the wrong key', async () => {
    const req = {
      cookies: {},
      headers: {
        authorization: `Bearer ${await sign({ sub: USER, role: 'STAFF', merchantId: CAFE_A }, 'a-different-secret-thirty-two-plus')}`,
      },
    };
    await expect(guard(true).canActivate(ctxFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('judges a request carrying BOTH credentials as the dashboard', async () => {
    const jwt = { verifyAccess: vi.fn().mockResolvedValue({ sub: 'dash-user', email: 'a@b.co' }) };
    const g = new AuthGuard(jwt as never, reflectorAccepting(true), tokens());
    const req: Record<string, unknown> = {
      cookies: { umi_access: 'cookie-token' },
      headers: {
        authorization: `Bearer ${await sign({ sub: USER, role: 'ADMIN', merchantId: CAFE_A })}`,
      },
    };
    expect(await g.canActivate(ctxFor(req))).toBe(true);
    expect(req.authUser).toEqual({ id: 'dash-user', email: 'a@b.co' });
    // The till claim must not leak in and pin a dashboard request to one café.
    expect(req.registerMerchantId).toBeUndefined();
  });
});

describe('a till session belongs to the café it was opened at', () => {
  const access = {
    merchantId: CAFE_B,
    handle: 'cafe-b',
    name: 'B',
    timezone: null,
    membershipId: 'm1',
    roles: ['admin'],
    permissions: [],
  };

  it('refuses a café-A token on café B, even when membership would allow it', async () => {
    const repo = {
      findMembershipAccess: vi.fn().mockResolvedValue(access),
      merchantIdForHandle: vi.fn(),
    };
    const g = new MerchantAccessGuard(repo as never);
    const req = {
      authUser: { id: USER, email: null },
      registerMerchantId: CAFE_A,
      params: { merchantId: CAFE_B },
    };
    await expect(g.canActivate(ctxFor(req))).rejects.toBeInstanceOf(NotFoundException);
    // Refused BEFORE the membership lookup — she is a member, and it still is not
    // her session.
    expect(repo.findMembershipAccess).not.toHaveBeenCalled();
  });

  it('lets a dashboard request through, which carries no café claim', async () => {
    const repo = {
      findMembershipAccess: vi.fn().mockResolvedValue(access),
      merchantIdForHandle: vi.fn(),
    };
    const g = new MerchantAccessGuard(repo as never);
    const req = { authUser: { id: USER, email: 'a@b.co' }, params: { merchantId: CAFE_B } };
    expect(await g.canActivate(ctxFor(req))).toBe(true);
  });
});

describe('the customer card refuses a staff token — the same defect, mirrored', () => {
  it('REFUSES a STAFF bearer on the customer card route', async () => {
    // Before the role check this passed: `subjectId` is a `umi.user.id` and the
    // card query keys on `merchant.customer.id`. Nothing leaked because the id
    // spaces do not collide, which is luck rather than a decision.
    const g = new CustomerAuthGuard(tokens());
    const req = {
      headers: {
        authorization: `Bearer ${await sign({ sub: USER, role: 'STAFF', merchantId: CAFE_A })}`,
      },
      publicMerchant: { merchantId: CAFE_A, name: 'A', handle: 'cafe-a' },
    };
    await expect(g.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('still admits the customer it was written for', async () => {
    const g = new CustomerAuthGuard(tokens());
    const req: Record<string, unknown> = {
      headers: {
        authorization: `Bearer ${await sign({ sub: CUSTOMER, role: 'CUSTOMER', merchantId: CAFE_A })}`,
      },
      publicMerchant: { merchantId: CAFE_A, name: 'A', handle: 'cafe-a' },
    };
    expect(await g.canActivate(ctxFor(req))).toBe(true);
    expect(req.customerAuth).toEqual({ customerId: CUSTOMER, merchantId: CAFE_A });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { PlatformElevationGuard } from './platform-elevation.guard';
import { PlatformElevationService } from './platform-elevation.service';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'operator@umi.test',
  sessionId: '00000000-0000-4000-8000-000000000002',
  deviceId: null,
};
const MERCHANT = '00000000-0000-4000-8000-0000000000aa';

const context = (req: Record<string, unknown>) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  }) as never;

describe('PlatformElevationService', () => {
  const make = (rows: unknown[] = []) => {
    const pg = { query: vi.fn().mockResolvedValue({ rows }) };
    const mfa = { issueChallenge: vi.fn(), verifyCode: vi.fn() };
    const repo = { recordSecurityEvent: vi.fn() };
    return {
      service: new PlatformElevationService(pg as never, mfa as never, repo as never),
      pg,
      mfa,
      repo,
    };
  };

  it('refuses to step up from a till session, which carries no address', async () => {
    const { service, mfa } = make();
    await expect(service.challenge({ ...user, email: null })).rejects.toMatchObject({
      response: { code: 'PLATFORM_ELEVATION_UNAVAILABLE' },
    });
    expect(mfa.issueChallenge).not.toHaveBeenCalled();
  });

  it('opens a grant only after the code verifies, and records it', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const { service, mfa, repo } = make([{ expiresAt }]);

    const result = await service.verify(user, MERCHANT, '123456');

    expect(mfa.verifyCode).toHaveBeenCalledWith(user.id, '123456');
    expect(result.expiresAt).toBe(expiresAt.toISOString());
    expect(repo.recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'platform.elevation_granted' }),
    );
  });

  it('does not open a grant when the code fails', async () => {
    const { service, mfa, pg } = make();
    mfa.verifyCode.mockRejectedValue(new Error('bad code'));

    await expect(service.verify(user, MERCHANT, '000000')).rejects.toThrow();
    expect(pg.query).not.toHaveBeenCalled();
  });

  it('scopes a grant to one merchant', async () => {
    const { service, pg } = make([{ ok: true }]);
    await service.isElevated(user.id, MERCHANT);
    // Assuming one café must not carry authority into another.
    expect(pg.query.mock.calls[0][1]).toEqual([user.id, MERCHANT]);
  });
});

describe('PlatformElevationGuard', () => {
  const guard = (elevated: boolean) =>
    new PlatformElevationGuard({
      isElevated: vi.fn().mockResolvedValue(elevated),
      assertElevated: vi.fn().mockImplementation(async () => {
        if (!elevated) {
          throw Object.assign(new Error('forbidden'), {
            response: { code: 'PLATFORM_ELEVATION_REQUIRED' },
          });
        }
      }),
    } as never);

  it("lets the café's own staff straight through", async () => {
    const req = {
      authUser: user,
      merchantAccess: { merchantId: MERCHANT, membershipId: 'a-real-employment' },
    };
    // Real employment: adding this guard to a route must not change their path.
    await expect(guard(false).canActivate(context(req))).resolves.toBe(true);
  });

  it('stops a platform operator who has not stepped up', async () => {
    const req = {
      authUser: user,
      merchantAccess: { merchantId: MERCHANT, membershipId: null },
    };
    await expect(guard(false).canActivate(context(req))).rejects.toMatchObject({
      response: { code: 'PLATFORM_ELEVATION_REQUIRED' },
    });
  });

  it('admits a platform operator holding a live grant', async () => {
    const req = {
      authUser: user,
      merchantAccess: { merchantId: MERCHANT, membershipId: null },
    };
    await expect(guard(true).canActivate(context(req))).resolves.toBe(true);
  });

  it('ignores routes that resolved no merchant', async () => {
    await expect(guard(false).canActivate(context({ authUser: user }))).resolves.toBe(true);
  });
});

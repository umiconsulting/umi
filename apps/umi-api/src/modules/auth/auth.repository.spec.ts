import { describe, expect, it, vi } from 'vitest';
import type { PgService } from '../../shared/database/pg.service';
import {
  AuthRepository,
  PASSWORD_SIGN_IN_STATUSES,
  POS_PIN_LOGIN_STATUSES,
} from './auth.repository';

/**
 * THE TILL READS THE EMPLOYMENT, NOT THE INVITATION.
 *
 * A merchant records an operator from the dashboard with a name, an email and a
 * till PIN. `staff.repository.ts` writes that login `invited` whenever the email
 * is free (there is no invitation flow in this API to move it on), while the
 * EMPLOYMENT is `active` and the PIN is set. While this query demanded
 * `u.status = 'active'`, every operator created that way was invisible to the
 * till and the PIN came back PERMISSION_DENIED for ever.
 *
 * The predicate is the whole fix, and a mocked service spec cannot see it: the
 * repository is a mock there, so it returns whatever the test says. These
 * assertions are on the SQL the repository actually sends.
 */
describe('AuthRepository.findPosPinStaff — which login states reach the till', () => {
  function capture() {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repo = new AuthRepository({ query } as unknown as PgService);
    return { repo, query };
  }

  it('admits a live login and an invited one, and passes that as a parameter', async () => {
    const { repo, query } = capture();

    await repo.findPosPinStaff('merchant-1', 'location-1', 'lookup-1');

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    // The allow list is the value the query filters on, not a comment beside it.
    expect(params.at(-1)).toEqual(['active', 'invited']);
    expect(sql).toMatch(/u\.status = ANY\(\$\d+::text\[\]\)/);
  });

  it('names the invitation in and the suspension out, so a new status fails closed', () => {
    expect(POS_PIN_LOGIN_STATUSES).toContain('active');
    expect(POS_PIN_LOGIN_STATUSES).toContain('invited');
    expect(POS_PIN_LOGIN_STATUSES).not.toContain('suspended');
  });

  it('still gates on the employment, the location and a set PIN', async () => {
    const { repo, query } = capture();

    await repo.findPosPinStaff('merchant-1', 'location-1', 'lookup-1');

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(`s.status = 'active'`);
    expect(sql).toContain('s.operator_pin_salt IS NOT NULL');
    expect(sql).toContain('s.operator_pin_hash IS NOT NULL');
    expect(sql).toContain('s.operator_pin_lookup = $3');
    expect(sql).toMatch(/s\.location_id IS NULL OR s\.location_id = l\.id/);
    expect(params.slice(0, 3)).toEqual(['merchant-1', 'location-1', 'lookup-1']);
  });
});

/**
 * SUSPENSION MUST CLOSE THE PASSWORD DOORS, AND IT MUST NOT BE TELLABLE.
 *
 * `umi.user.status` is the sign-in gate; `merchant.staff.status` is the
 * employment. Suspending a departing or compromised employee is the revocation
 * lever, and until this predicate existed it revoked nothing: the dashboard's
 * login, its forgot-password and Umi Cash's register login all read the
 * credential out of `umi.user` without ever looking at the column, so a
 * suspended owner kept signing in with the password she already had.
 *
 * The gate is the PREDICATE, which is why it is asserted here rather than in the
 * service specs: those mock this repository, so they return whatever the test
 * says and cannot see a WHERE clause at all.
 */
describe('AuthRepository.findSignInCredentialByEmail — the password sign-in gate', () => {
  function capture() {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repo = new AuthRepository({ query } as unknown as PgService);
    return { repo, query };
  }

  it('filters on status in the query itself, not in its callers', async () => {
    const { repo, query } = capture();

    await repo.findSignInCredentialByEmail('ana@kalala.mx');

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/u\.status = ANY\(\$\d+::text\[\]\)/);
    expect(params).toEqual(['ana@kalala.mx', ['active']]);
    // The row must still be a credential, or the gate would "pass" for a PIN-only
    // operator who has no password to check in the first place.
    expect(sql).toContain('u.password_hash IS NOT NULL');
  });

  it('admits `active` only — no suspension, and no invitation', () => {
    expect(PASSWORD_SIGN_IN_STATUSES).toEqual(['active']);
    expect(PASSWORD_SIGN_IN_STATUSES).not.toContain('suspended');
    expect(PASSWORD_SIGN_IN_STATUSES).not.toContain('invited');
  });

  it('narrower than the till on purpose: the two lists share `active` and nothing else', () => {
    // The till reads a SECOND grant — merchant.staff, its PIN and its location —
    // so it can admit an `invited` login whose employer already granted till
    // access. A password has no second grant behind it.
    expect(POS_PIN_LOGIN_STATUSES).toContain('invited');
    expect(PASSWORD_SIGN_IN_STATUSES).not.toContain('invited');
    expect(POS_PIN_LOGIN_STATUSES).toContain('active');
    expect(PASSWORD_SIGN_IN_STATUSES).toContain('active');
  });

  it('has NO ungated sibling left to call', async () => {
    // The old read returned a credential whatever the login's state, which is
    // exactly how three doors forgot the gate. A caller that genuinely needs such
    // a row must read `umi.user` itself and say why the read is not a sign-in.
    const { repo } = capture();
    expect('findCredentialByEmail' in repo).toBe(false);
  });

  it('carries the status on the refresh read, so renewal can re-check the gate', async () => {
    const { repo, query } = capture();

    await repo.findUserById('9f000000-0000-4000-8000-0000000000a1');

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/u\.status AS "status"/);
  });
});

/**
 * A DEVICE THE OWNER SWITCHED TO KDS STILL SIGNS IN.
 *
 * One binary serves the till and the kitchen board, and it reads its own kind from
 * `GET /devices/status`; the app then offers the kitchen surface and withholds the
 * till's. While this query also demanded `d.kind = 'pos_terminal'`, a device the owner
 * had switched to KDS could not start at all — the tablet stopped on the PIN keypad and
 * the login answered `DEVICE_NOT_ALLOWED`. The device record decides what the app MAY
 * show, so this read must name only the columns that prove the device is the one it
 * claims to be. A mocked service cannot see the predicate; these assertions read the
 * SQL the repository actually sends.
 */
describe('AuthRepository.validatePosDevice — identity, not purpose', () => {
  function capture() {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repo = new AuthRepository({ query } as unknown as PgService);
    return { repo, query };
  }

  async function run() {
    const { repo, query } = capture();
    await repo.validatePosDevice({
      deviceId: '00000000-0000-4000-8000-000000000010',
      merchantId: '00000000-0000-4000-8000-000000000012',
      locationId: '00000000-0000-4000-8000-000000000013',
      installationHash: 'a'.repeat(64),
      credentialHash: 'b'.repeat(64),
    });
    return query.mock.calls[0] as [string, unknown[]];
  }

  it('never reads the device kind, so a KDS terminal can still authenticate', async () => {
    const [sql] = await run();
    expect(sql).not.toMatch(/kind/);
  });

  it('still gates on the merchant, the branch, the live status and both hashes', async () => {
    const [sql] = await run();
    expect(sql).toMatch(/d\.merchant_id = \$2::uuid/);
    expect(sql).toMatch(/d\.location_id = \$3::uuid/);
    expect(sql).toMatch(/d\.status = 'active'/);
    expect(sql).toMatch(/d\.installation_hash = \$4/);
    expect(sql).toMatch(/d\.credential_hash = \$5/);
  });
});

/**
 * THE TILL'S REFRESH FINDS A PIN-ONLY OPERATOR.
 *
 * The dashboard records an operator with a name, an email and a till PIN — no password,
 * so `umi.user.status` stays `invited` while the employment is `active`. The password
 * door's read (`findUserById`) demands `password_hash IS NOT NULL`, so the refresh found
 * nobody, answered `invalid_token`, and every register died exactly one access TTL after
 * the PIN that opened it — on the pilot till, mid-shift, on 2026-10-08.
 *
 * The predicate is the whole fix and a mocked service cannot see it, so these assertions
 * are on the SQL the repository actually sends.
 */
describe('AuthRepository.findPosOperatorById — the till is not a password door', () => {
  function capture() {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repo = new AuthRepository({ query } as unknown as PgService);
    return { repo, query };
  }

  it('never demands a password', async () => {
    const { repo, query } = capture();
    await repo.findPosOperatorById('9f000000-0000-4000-8000-0000000000a1');
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/password_hash/);
  });

  it('still reads exactly one row, by id', async () => {
    const { repo, query } = capture();
    await repo.findPosOperatorById('9f000000-0000-4000-8000-0000000000a1');
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE u\.id = \$1::uuid/);
    expect(sql).toMatch(/LIMIT 1/);
    expect(params).toEqual(['9f000000-0000-4000-8000-0000000000a1']);
  });

  // The password door keeps its own gate: this read must not have replaced it.
  it('leaves the password sign-in read gated', async () => {
    const { repo, query } = capture();
    await repo.findUserById('9f000000-0000-4000-8000-0000000000a1');
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/password_hash IS NOT NULL/);
  });
});

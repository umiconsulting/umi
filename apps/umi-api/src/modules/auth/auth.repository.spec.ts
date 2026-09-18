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

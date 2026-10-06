import { describe, expect, it } from 'vitest';
import { MODULES, getModuleAvailability, buildModuleAvailability } from './module-registry';

/**
 * WHICH QUESTION THIS MAP IS ALLOWED TO ANSWER.
 *
 * There are two independent axes for hiding a module, and confusing them is what
 * this suite exists to stop:
 *
 *   the CAFÉ role  — `capabilities.membership.role`, one of owner/admin/staff/viewer.
 *   the PLATFORM grant — `SessionEnvelope.platformRole`, super_admin or developer.
 *
 * `products-billing` was gated on `role: 'super_admin'`, which reads the FIRST axis
 * for a value that only ever appears on the SECOND. `umi.role` marks super_admin
 * `is_platform`, and no café membership carries it — so the check could only pass
 * through a `permissions.includes('*')` escape hatch that nothing produces any more
 * (see `roles.ts`: "Nothing produces '*' today, so it is unreachable").
 *
 * REACHABLE, and today MASKED — both halves matter. The one platform operator,
 * hola@umiconsulting.co, is also `staff` at Umi Cafe, and `findMembershipAccess`
 * COALESCEs: a café grant REPLACES the platform role in `roles`, so selecting that
 * café normalized her to `staff` and this screen refused her. It never SHOWED as
 * this bug only because Umi Cafe holds no entitlements and the product gate refused
 * her one step earlier. A subscription for that café — or any operator taking a job
 * at an entitled one — makes the screen appear and disappear with the switcher.
 * Verified end to end on a scratch clone by doing exactly that.
 *
 * The fix is not to merge the platform role into `roles`: `normalizeRoleKey` ranks
 * super_admin first, so a platform operator working a shift as `staff` would
 * normalize to super_admin and gain café authority through RolesGuard. That is a
 * privilege escalation, not a fix. The module moves to the axis it belongs on, and
 * that axis is answered by the client from the session — which is why this server-
 * side map must not claim to answer it.
 */
const ACTIVE = { products: { dashboard: { status: 'active' }, kds: { status: 'active' } } };

describe('the server module map and the platform axis', () => {
  it('no module in this map is gated on a café role of super_admin', () => {
    // A platform grant is not a café role. Any entry that names one here is reading
    // the wrong axis and will hide a screen from the person it is for.
    const offenders = Object.entries(MODULES)
      .filter(([, m]) => m.role === 'super_admin' || m.role === 'developer')
      .map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it('offers Products & Billing to a café staffer, because the server does not decide platform grants', () => {
    // The server has no platform-role input. It answers the product question — is the
    // dashboard entitled — and leaves the grant to the client, which holds the session.
    const cap = { ...ACTIVE, membership: { role: 'staff', permissions: [] } };
    expect(getModuleAvailability('products-billing', cap)).toEqual({
      available: true,
      locationScoped: false,
    });
  });

  it('still hides a module whose product the café does not own', () => {
    // The axis this map DOES own, unchanged. `members` owns `cash` here; the café only
    // holds `dashboard`, so the cash module hides even though it has the admin role.
    const cap = { products: { dashboard: { status: 'active' } }, membership: { role: 'admin' } };
    expect(getModuleAvailability('members', cap)).toMatchObject({
      available: false,
      reason: 'product_missing',
      product: 'cash',
    });
  });

  it('answers for every module it orders, so the shape never gains or drops a key silently', () => {
    const map = buildModuleAvailability({ ...ACTIVE, membership: { role: 'admin' } });
    expect(Object.keys(map)).toContain('products-billing');
  });
});

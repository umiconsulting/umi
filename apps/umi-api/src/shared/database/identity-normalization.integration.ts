import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Phone normalization, pinned to REAL DATA (BACKFILL_METHODOLOGY L15 / O-3).
 *
 * This is the test that would have caught the fatal location. Prod's
 * `core.normalize_phone` — and the copy build-v3 originally shipped — carried
 *   length(d)=11 AND left(d,1)='1' -> '+52'||right(d,10)
 * which strips the `+` BEFORE deciding the country, rewriting a real NANP number into a
 * Mexican number belonging to nobody.
 *
 * ⚠️ Why "0 mismatches vs the stored column" is NOT a proof: the corruption was
 * self-consistent — the same broken function on read AND write — so comparing the
 * function against data the function produced agrees with itself by construction. That
 * is precisely the reasoning that shipped the bug. So these assertions pin the
 * OUTCOMES the ruling specifies (how many rows change, how many go NULL, and which
 * exact numbers survive), not internal agreement.
 *
 * L15 pins one rule above all: `umi.e164()` NULLs a row ONLY when the number cannot
 * be dialled at all. A stricter prose-following reading NULLs every row the old
 * function had touched and strands the customers who each hold a live wallet pass.
 * The counts below are pinned to a named snapshot; the SHAPE of the change is
 * pinned structurally, so a newer dump moves the counts without loosening the rule.
 */

const DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

/**
 * WHAT THE PRODUCTION SNAPSHOT HOLDS, and the date it was measured.
 *
 * Re-pinned on 2026-09-01 against `umi_prod_snapshot_20260901`. The previous pin
 * was taken against the 2026-08-18 dump, and every number moved for a reason
 * worth writing down rather than editing away:
 *
 *   phoneContacts 794 → 864  Seventy new contact rows. The count tracks café
 *                            growth and carries no judgement.
 *   repaired          7 → 8  One new NANP row keeps its declared '+1'.
 *   nulled            2 → 2  No new un-dialable row entered the snapshot.
 *
 * ⚠️ Rising `nulled` is the number to be suspicious of. It moved from 1 to 2
 * because a SECOND customer was entered with the same eight-digit defect, not
 * because the function became stricter — the three assertions below prove that
 * distinction structurally, so a future dump cannot hide a regression inside a
 * count that merely grew.
 */
const SNAPSHOT = {
  /** Rows in `merchant.contact` that came from `core.contact_methods`. */
  phoneContacts: 864,
  /** Rows whose declared country code the old function had overwritten. */
  repaired: 8,
  /** Rows that are not dialable at all, so NULL is the truthful answer. */
  nulled: 2,
} as const;

let pool: Pool;
let hasSnapshot = false;

beforeAll(async () => {
  pool = new Pool({ connectionString: DSN, max: 2 });
  try {
    const { rows } = await pool.query(`select to_regclass('core.contact_methods') as t`);
    // No core.* at all = pristine build; the data-pinned assertions have nothing to
    // pin against and are skipped. That is legitimate.
    hasSnapshot = rows[0]?.t != null;
  } catch (err) {
    // Reading core.* is REFUSED (not absent). Do not silently skip: the row-count pins
    // are the whole point of this file, and a skipped pin reads as a passing one.
    // 00_run_backfill.sh drops and recreates the database, and schema grants live INSIDE
    // it — so the harness grants must be re-applied after every rebuild.
    throw new Error(
      'Cannot read the legacy snapshot (core.*), so the data-pinned L15 assertions ' +
        'cannot run. Schema grants do not survive a backfill rebuild — re-apply them:\n' +
        '  psql -p 5233 -d umi_backfill_v3 -f apps/umi-api/test/integration/harness-roles.sql\n' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('umi.e164 — phone normalization pinned to real data', () => {
  it('never prepends a country code to a string that already carries one', async () => {
    // The whole ruling in one assertion: a +1 number stays a +1 number.
    const { rows } = await pool.query(`select umi.e164($1) AS a, umi.e164($2) AS b`, [
      '+14804016182',
      '+15005550006',
    ]);
    expect(rows[0].a).toBe('+14804016182');
    expect(rows[0].b).toBe('+15005550006');
  });

  it('still normalizes Mexican forms to +52 + ten national digits', async () => {
    const { rows } = await pool.query(
      `select umi.e164('+5216671518408') AS legacy_mobile,
              umi.e164('6671518408')     AS bare_local,
              umi.e164('526671518408')   AS no_plus_cc,
              umi.e164('16671518408')    AS no_plus_legacy`,
    );
    expect(rows[0].legacy_mobile).toBe('+526671518408');
    expect(rows[0].bare_local).toBe('+526671518408');
    expect(rows[0].no_plus_cc).toBe('+526671518408');
    // No '+' means national input, so a leading 1 is Mexico's legacy mobile prefix,
    // NOT country code 1. The bug was applying this to strings that HAD a '+'.
    expect(rows[0].no_plus_legacy).toBe('+526671518408');
  });

  it('returns NULL honestly for a number that is not anyone’s number', async () => {
    // O-3, Mayela: '+52' + only EIGHT national digits. Ten are required.
    // '+525266748626' is not her number; NULL is the truthful answer.
    const { rows } = await pool.query(`select umi.e164('+5266748626') AS mayela`);
    expect(rows[0].mayela).toBeNull();
  });

  it('is IMMUTABLE and NULL/blank-safe', async () => {
    const { rows } = await pool.query(
      `select umi.e164(null) AS n, umi.e164('') AS e, umi.e164('   ') AS b, umi.e164('abc') AS junk`,
    );
    expect(rows[0].n).toBeNull();
    expect(rows[0].e).toBeNull();
    expect(rows[0].b).toBeNull();
    expect(rows[0].junk).toBeNull();
  });

  it('repairs the NANP rows and NULLs only the un-dialable ones, across all prod rows', async () => {
    if (!hasSnapshot) return; // pristine build (no coexisting prod snapshot) — nothing to pin
    const { rows } = await pool.query(`
      select count(*)::int AS total,
             count(*) filter (
               where c.normalized_value is distinct from cm.normalized_value)::int AS changed,
             count(*) filter (where c.normalized_value is null)::int AS now_null
        from merchant.contact c
        join core.contact_methods cm on cm.id = c.id`);
    const { total, changed, now_null } = rows[0];

    expect(total).toBe(SNAPSHOT.phoneContacts);
    expect(changed).toBe(SNAPSHOT.repaired + SNAPSHOT.nulled);
    expect(now_null).toBe(SNAPSHOT.nulled);
  });

  it('leaves the repaired rows holding their TRUE numbers', async () => {
    if (!hasSnapshot) return;
    const { rows } = await pool.query(`
      select cm.display_value AS raw, c.normalized_value AS now
        from merchant.contact c
        join core.contact_methods cm on cm.id = c.id
       where c.normalized_value is distinct from cm.normalized_value
       order by 1`);

    // THE INVARIANT, and it holds on any snapshot: every changed row is either a
    // number whose DECLARED country code survives verbatim, or an honest NULL.
    // There is no third outcome — a rewritten country code is the fatal bug.
    for (const r of rows) {
      if (r.now === null) continue;
      expect(r.now).toBe(r.raw);
      expect(r.now.startsWith('+52')).toBe(false);
    }
    expect(rows.filter((r: { now: string | null }) => r.now !== null)).toHaveLength(
      SNAPSHOT.repaired,
    );
  });

  it('NULLs a row only when the number is nobody’s number', async () => {
    if (!hasSnapshot) return;
    const { rows } = await pool.query(`
      select cm.display_value AS raw
        from merchant.contact c
        join core.contact_methods cm on cm.id = c.id
       where c.normalized_value is null and cm.normalized_value is not null`);

    // The other half of the invariant, and the one L15 exists to protect. A NULL
    // is only ever allowed for a number that CANNOT be dialled: a declared '+52'
    // carrying fewer than the ten national digits Mexico requires. Any other NULL
    // means the function threw away a reachable customer, which is the failure
    // this whole file was written after.
    for (const r of rows) {
      const digits = String(r.raw).replace(/\D/g, '');
      expect(String(r.raw).startsWith('+52')).toBe(true);
      expect(digits.length - 2).toBeLessThan(10);
    }
    expect(rows).toHaveLength(SNAPSHOT.nulled);
  });

  it('makes normalized_value unforgeable — the trigger re-derives a hand-written value', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rows: target } = await c.query(
        `select id, normalized_value from merchant.contact
          where normalized_value is not null limit 1`,
      );
      await c.query(`update merchant.contact set normalized_value = $2 where id = $1`, [
        target[0].id,
        '+520000000000',
      ]);
      const { rows: after } = await c.query(
        `select normalized_value from merchant.contact where id = $1`,
        [target[0].id],
      );
      // The app cannot write its own normalization into the column any more — which is
      // how the corruption stayed self-consistent in the first place.
      expect(after[0].normalized_value).not.toBe('+520000000000');
      expect(after[0].normalized_value).toBe(target[0].normalized_value);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});

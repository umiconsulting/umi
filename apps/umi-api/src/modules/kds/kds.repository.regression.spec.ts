import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, 'kds.repository.ts'), 'utf8');

describe('KDS order scope query regression', () => {
  it('aggregates deterministic station UUID text within merchant order scope', () => {
    expect(source).toContain('min(i.station_id::text) AS station_id');
    expect(source).not.toContain('min(i.station_id)::text AS station_id');
    expect(source).toContain('array_agg(DISTINCT i.station_id::text)');
    expect(source).toContain('ko.merchant_id=$3::uuid');
    expect(source).toContain('i.kitchen_order_id=ko.id AND i.merchant_id=ko.merchant_id');
  });
});

describe('KDS device location query regression', () => {
  // The till's board is the one caller that gets the SAME ticket once per station —
  // the bar's drink and the kitchen's pizza — so the row it reads has to carry the
  // station's name, not just its id. Dropping the name from this SELECT is invisible in
  // a single-station café and unusable in a two-station one.
  it('names the station on the board row, so a till can tell its cards apart', () => {
    expect(source).toContain('s.name AS station_name');
    expect(source).toContain('JOIN merchant.station s ON s.id=v.station_id');
  });

  it('uses the device registry location with a legacy session fallback', () => {
    expect(source).toContain("COALESCE(dv.location_id::text, s.metadata->>'location_id') = $2");
    expect(source).toContain(
      "COALESCE(dv.location_id::text, s.metadata->>'location_id') AS location_id",
    );
    expect(source).toContain('loc.name AS location_name');
  });

  // A POS terminal also holds a principal_type='device' session. It used to fall into
  // this list and render as a nameless card with no station and no order count, and its
  // edit button opened the KDS panel on a device that has none of those fields.
  it('keeps POS terminals out of the KDS device list', () => {
    expect(source).toContain("COALESCE(dv.kind, 'kds') <> 'pos_terminal'");
    expect(source).toContain("COALESCE(s.metadata->>'app', 'kds') <> 'pos'");
  });
});

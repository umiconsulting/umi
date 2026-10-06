/**
 * "Shape" for the register's routes, in one place.
 *
 * Three callers need to agree on it and each one had its own copy: the parity
 * harness (does umi-api answer like umi-cash right now?), the shape capture (what
 * did umi-cash answer on the day we cut over?) and the contract test that replays
 * the capture in CI. Two definitions of "shape" would let the recorder and the
 * checker disagree, which is the same class of silence this whole exercise is
 * about.
 */

/**
 * Every decided path in a JSON value, as `key` / `key[]` / `key[].child`, with the
 * leaf's type. Arrays collapse to their first element: the shape of one row is the
 * shape of the screen, and comparing all 1000 of them is the same answer slower.
 */
export function shape(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    out.add(`${prefix}[]`);
    if (value.length > 0) shape(value[0], `${prefix}[].`, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const path = prefix + k;
      const type = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      out.add(`${path}:${type}`);
      shape(v, `${path}.`, out);
    }
  }
  return out;
}

/** The path without its type suffix, which is how two shapes are lined up. */
const pathOf = (entry) => entry.slice(0, entry.lastIndexOf(':'));

/**
 * A key only counts as missing when the path AND its type are absent. `null` vs
 * `"x"` is NOT reported here — that is `nullGaps`' job, and separating the two
 * keeps a deliberate null (a café with no promo) from a value that went missing.
 */
export function missingFrom(expected, actual) {
  const actualPaths = new Set([...actual].map(pathOf));
  return [...expected].filter((p) => !actualPaths.has(pathOf(p)));
}

/**
 * WHERE A VALUE GOES MISSING WITHOUT A KEY GOING MISSING.
 *
 * A path comparison cannot see it: `upgrade: null` has the same path as
 * `upgrade: { visitsRequired, rewardName, … }`. That is not hypothetical — it is
 * how umi-api's missing two-tier ladder survived a shape check. El Gran Ribera runs
 * a 7/9 ladder, the port answered `upgrade: null`, and the panel drew one reward
 * with every gate quiet.
 *
 * Returns the paths where umi-cash sent a value and umi-api sent null. The reverse
 * (umi-api adds a value) is not a gap: extra data breaks no screen.
 */
export function nullGaps(expected, actual) {
  const apiNull = new Set(
    [...actual].filter((p) => p.endsWith(':null')).map((p) => p.slice(0, -':null'.length)),
  );
  return [...new Set([...expected].filter((p) => !p.endsWith(':null')).map(pathOf))].filter(
    (path) => apiNull.has(path),
  );
}

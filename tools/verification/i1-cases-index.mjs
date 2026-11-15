// Case registry. One entry per required I1 case. The runner executes the
// registry in this order; each family module owns its assertions.
import { FIN_CASES } from './i1-cases-fin.mjs';
import { API_CASES } from './i1-cases-api.mjs';
import { FOCUSED_CASES } from './i1-cases-focused.mjs';
import { BROWSER_CASES } from './i1-cases-browser.mjs';
import { EXTRA_CASES } from './i1-cases-extra.mjs';

export const CASES = {
  ...FIN_CASES,
  ...API_CASES,
  ...FOCUSED_CASES,
  ...BROWSER_CASES,
  ...EXTRA_CASES,
};

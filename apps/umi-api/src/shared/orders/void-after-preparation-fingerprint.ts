import { createHash } from 'node:crypto';

/**
 * The string a manager's elevation is bound to when it authorizes cancelling a line
 * the kitchen ALREADY started.
 *
 * WHY A FINGERPRINT AT ALL. An approval is a live grant for one minute-scale act, and
 * the act it authorizes has to be the act it was asked about: `runtime.elevation_grant`
 * carries the hash, and consuming it matches on the same value. Without it a manager
 * who approved "cancel the margarita" would have approved "cancel whatever this cart
 * sends next", which is the shape of a bug that only shows up the day it is abused.
 *
 * THE SIX FIELDS ARE THE WHOLE ACT: which merchant and location (the scope the grant is
 * stored under), which account, which line, why, and the cart version the manager was
 * looking at. The version is in it on purpose — if the account moved under the dialog
 * the approval is stale, and the till must ask again rather than void a line the manager
 * never saw.
 *
 * The Dart twin is `CartController.voidAfterPreparationFingerprint`. Both join the same
 * fields in the same order with ':' and hash them as sha256 hex, exactly as the cash
 * movement approval does on both sides; a change to that order is a change to both.
 */
export function voidAfterPreparationFingerprint(input: {
  merchantId: string;
  locationId: string;
  cartId: string;
  lineId: string;
  reasonCode: string;
  expectedVersion: number;
}): string {
  return createHash('sha256')
    .update(
      [
        input.merchantId,
        input.locationId,
        input.cartId,
        input.lineId,
        input.reasonCode,
        input.expectedVersion,
      ].join(':'),
    )
    .digest('hex');
}

/**
 * The permission the approver must hold to authorize a void of an already-made line.
 *
 * Its own key rather than the sale-exception `sale.void.create`, because the owner's
 * decision is that ONLY an admin authorizes this: the exception key belongs to admin,
 * owner, manager and supervisor alike, so reusing it would have widened the rule to four
 * roles. `config/umipos-pilot-role-grants.json` grants this one to `admin` and to nobody
 * else, and the refusal's field errors name it back to the till.
 */
export const VOID_AFTER_PREPARATION_PERMISSION = 'order.void_after_preparation.approve';

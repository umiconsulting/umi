/**
 * How long an earn preview stays valid, and the window a renewal asks for.
 *
 * ONE NUMBER, ONE MEANING. The earn preview a checkout commits against is a computation over the
 * cart and the loyalty policy; this is how long that computation is taken to still describe them.
 * Two places read it — the preview that writes the row (`pos-customer-value.repository.ts`) and the
 * commit that renews it when the till sat on the sheet longer than this
 * (`pos-checkout.repository.ts`) — so it lives here rather than in either of them.
 *
 * The database caps every window at the loyalty program's own `policy_expires_at`
 * (`merchant.renew_loyalty_earn_preview`), so a program that lapses sooner closes the window sooner.
 */
export const PREVIEW_WINDOW_SECONDS = 300;

export const PREVIEW_WINDOW_MS = PREVIEW_WINDOW_SECONDS * 1000;

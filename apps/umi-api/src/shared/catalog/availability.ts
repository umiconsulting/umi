/**
 * ONE rule for "may this product be sold at this location".
 *
 * The availability column came from a boolean `available` because "not available"
 * turned out to be four different facts (`20_merchant.sql`): 86'd until tomorrow, not
 * on this location's menu at all, disabled by the owner, or not on sale yet. The till
 * reads that column twice — once to draw the menu (`pos-catalog.repository.ts`) and
 * once to accept a line (`pos-cart.repository.ts`) — and the two reads disagreed:
 * the catalogue resolved a passed `available_from` date to "orderable", the cart asked
 * only for the literal string `enabled` and refused the same product forever. A product
 * that the menu offered could not be added, and a bounded date could never mature.
 * Measured on the iMin D3-504, 2026-10-11: 28 refused `cart.line.add` commands against
 * one product whose date had passed.
 *
 * So the status half of the rule lives here, once. Both readers splice the same
 * expression, and a change to what "orderable" means changes both or neither.
 *
 * The INVENTORY half of the catalogue's verdict (a direct mapping with no stock, a
 * recipe whose required components are short) stays in the catalogue query alone: it
 * needs the mapping, policy and balance joins the cart's pricing read does not carry,
 * and it is a derived signal rather than an owner's decision. A product the catalogue
 * hides for stock is still refused by the till's own card, which reads the catalogue.
 */

export const CATALOG_AVAILABILITY_STATUSES = [
  'enabled',
  'disabled',
  'temporarily_unavailable',
  'out_of_assortment',
  'future_availability',
] as const;

export type CatalogAvailabilityStatus = (typeof CATALOG_AVAILABILITY_STATUSES)[number];

export function isCatalogAvailabilityStatus(value: unknown): value is CatalogAvailabilityStatus {
  return (
    typeof value === 'string' &&
    (CATALOG_AVAILABILITY_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * The availability the till obeys, as a SQL expression over the
 * `merchant.product_location_availability` row aliased `alias` (`a` in both readers).
 *
 * `enabled` means orderable. A `future_availability` row whose date has arrived — or
 * whose date was never set, which the table's CHECK forbids but a legacy row could
 * still carry — resolves to `enabled`, exactly as the catalogue has always read it.
 * An absent row (a NULL alias) is the table's documented default: available.
 */
export function availabilityStateSql(alias: string): string {
  return `(CASE
    WHEN ${alias}.status = 'future_availability'
      THEN (CASE WHEN ${alias}.available_from > now() THEN 'future_availability' ELSE 'enabled' END)
    ELSE coalesce(${alias}.status,'enabled')
  END)`;
}

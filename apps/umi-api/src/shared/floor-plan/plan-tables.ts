/**
 * Reading tables out of a floor-plan document.
 *
 * Shared because two modules need the same answer from the same JSON, and they
 * must not disagree: `table-map` resolves a table's capacity and would refuse a
 * seat for a table it cannot find, and `floor-plan`'s publish guard compares an
 * occupied table's element against the layout about to be published. A second,
 * slightly different reader would make the two disagree about what "the same
 * table, unmoved" means.
 *
 * Deliberately TOLERANT rather than `FloorPlanDocument.parse`. The document this
 * reads was validated when it was saved, but both callers have to behave sanely
 * when it is not what it should be: a state operation must refuse with
 * `TABLE_NOT_IN_PLAN` rather than turn a refusal into a 500, and the publish
 * guard must refuse to publish rather than skip its check. So nothing here
 * throws: whatever cannot be read simply is not a table.
 */

/** One table as the floor plan carries it: where it is and how many it seats. */
export interface PlanTable {
  readonly tableId: string;
  readonly areaId: string;
  readonly capacity: number;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly shape: string;
}

export function planTables(document: unknown): Map<string, PlanTable> {
  const tables = new Map<string, PlanTable>();
  const areas = (document as { areas?: unknown } | null)?.areas;
  if (!Array.isArray(areas)) return tables;
  for (const area of areas) {
    const areaId = (area as { id?: unknown } | null)?.id;
    const elements = (area as { elements?: unknown } | null)?.elements;
    if (typeof areaId !== 'string' || !Array.isArray(elements)) continue;
    for (const element of elements) {
      const source = element as Record<string, unknown> | null;
      if (!source || source.kind !== 'table' || typeof source.id !== 'string') continue;
      const number = (key: string): number => {
        const value = source[key];
        return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
      };
      tables.set(source.id, {
        tableId: source.id,
        areaId,
        capacity: number('capacity'),
        label: typeof source.label === 'string' ? source.label : '',
        x: number('x'),
        y: number('y'),
        width: number('width'),
        height: number('height'),
        rotation: number('rotation'),
        shape: typeof source.shape === 'string' ? source.shape : '',
      });
    }
  }
  return tables;
}

/**
 * Which occupied tables a layout change would disturb, comparing the layout
 * about to be published (`after`) with the one the room is being operated
 * against (`before`). Empty means the change is safe to publish.
 *
 * THE RULE (docs/architecture/2026-09-13-floor-plan-foundation.md, closing
 * line): a layout that removes or moves an occupied table must not publish.
 *
 * What counts as disturbing, and why each one:
 *   · removed from the document, or moved to another AREA — the party's table is
 *     drawn somewhere it is not, and an area's coordinates are that area's frame,
 *     so the same x and y in another area is a different place on the floor.
 *   · x, y, width, height or rotation changed — the map now says the party is
 *     somewhere it is not. A resize or a rotation is also a move for a party of
 *     four sitting at the far end of a long table.
 *   · capacity lowered or raised — capacity is what the seating rules just
 *     enforced (`partySize <= capacity`), so lowering it leaves the room
 *     advertising less than it holds, and raising it makes the number printed on
 *     this table's tickets wrong.
 *   · label changed — the label is what this party's kitchen ticket and bill
 *     already carry; renaming the table mid-meal makes the board and the paper
 *     disagree.
 *
 * `shape` is the ONE change permitted on an occupied table: a round 90x90 and a
 * square 90x90 hold the same party, in the same place, at the same size.
 */
export function occupiedTablesDisturbed(
  before: unknown,
  after: unknown,
  occupiedTableIds: readonly string[],
): string[] {
  const previously = planTables(before);
  const now = planTables(after);
  const disturbed: string[] = [];
  for (const tableId of occupiedTableIds) {
    const was = previously.get(tableId);
    const is = now.get(tableId);
    // No `was` means the room is being operated against a document that is not
    // the published one — the caller refuses before reaching this. Treating it
    // as "changed" rather than "fine" is the fail-closed direction.
    if (!was || !is) {
      disturbed.push(tableId);
      continue;
    }
    if (
      was.areaId !== is.areaId ||
      was.x !== is.x ||
      was.y !== is.y ||
      was.width !== is.width ||
      was.height !== is.height ||
      was.rotation !== is.rotation ||
      was.capacity !== is.capacity ||
      was.label !== is.label
    ) {
      disturbed.push(tableId);
    }
  }
  return disturbed;
}

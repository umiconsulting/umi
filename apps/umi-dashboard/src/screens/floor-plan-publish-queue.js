const QUEUE_VERSION = 1;

export function publishQueueKey(merchantId, locationId) {
  return `umi:floor-plan:publish-queue:${merchantId}:${locationId}`;
}

function textList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * Read a queued publication that belongs to this exact merchant and location.
 *
 * The layout is edited in one browser tab, but a manager can close the tab and
 * return later. localStorage keeps the operator's choice across that reload.
 * A malformed or foreign queue is ignored, never repaired into a publish.
 */
export function readPublishQueue(storage, merchantId, locationId) {
  try {
    const value = JSON.parse(storage?.getItem(publishQueueKey(merchantId, locationId)) ?? 'null');
    if (
      value?.schemaVersion !== QUEUE_VERSION ||
      value.merchantId !== merchantId ||
      value.locationId !== locationId ||
      !Number.isInteger(value.expectedVersion) ||
      value.expectedVersion < 0 ||
      typeof value.idempotencyKey !== 'string' ||
      value.idempotencyKey.length === 0 ||
      !Array.isArray(value.tableIds) ||
      !value.tableIds.every((id) => typeof id === 'string') ||
      !Array.isArray(value.blockers) ||
      !value.blockers.every((label) => typeof label === 'string') ||
      (value.details != null &&
        (!Array.isArray(value.details) ||
          !value.details.every(
            (item) =>
              typeof item?.tableId === 'string' &&
              typeof item?.label === 'string' &&
              (item.accountReference == null || typeof item.accountReference === 'string'),
          )))
    )
      return null;
    return {
      schemaVersion: QUEUE_VERSION,
      merchantId,
      locationId,
      expectedVersion: value.expectedVersion,
      idempotencyKey: value.idempotencyKey,
      tableIds: value.tableIds,
      blockers: value.blockers,
      details:
        value.details ??
        value.tableIds.map((tableId, index) => ({
          tableId,
          label: value.blockers[index] ?? tableId,
          accountReference: null,
        })),
      queuedAt: typeof value.queuedAt === 'string' ? value.queuedAt : null,
    };
  } catch {
    return null;
  }
}

export function writePublishQueue(storage, queue) {
  try {
    storage?.setItem(publishQueueKey(queue.merchantId, queue.locationId), JSON.stringify(queue));
  } catch {
    /* Storage can be unavailable. The queue still lives in this tab. */
  }
}

export function clearPublishQueue(storage, merchantId, locationId) {
  try {
    storage?.removeItem(publishQueueKey(merchantId, locationId));
  } catch {
    /* Storage can be unavailable. */
  }
}

function blockerFields(error) {
  return (
    error?.details?.error?.fieldErrors ??
    error?.details?.fieldErrors ??
    error?.response?.fieldErrors ??
    {}
  );
}

/**
 * Turn the structured occupied-table refusal into the facts the decision sheet
 * needs. The labels come from the server's published and draft layouts, and the
 * account pairs let the screen say whether closing is available.
 */
export function floorPlanBlockers(error) {
  const fields = blockerFields(error);
  const tableIds = textList(fields.tableIds);
  const serverBlockers = textList(fields.blockers);
  const accounts = new Map(
    textList(fields.blockerAccounts).flatMap((entry) => {
      const [tableId, cartId, version, reference] = entry.split('|');
      const parsed = Number(version);
      return tableId && cartId && Number.isInteger(parsed)
        ? [[tableId, { cartId, expectedVersion: parsed, reference: reference || null }]]
        : [];
    }),
  );
  const labels = serverBlockers.length > 0 ? serverBlockers : tableIds;
  const details = tableIds.map((tableId, index) => ({
    tableId,
    label: labels[index] ?? tableId,
    accountReference: accounts.get(tableId)?.reference ?? null,
  }));
  return {
    tableIds,
    labels,
    details,
    canCloseAccounts: tableIds.length > 0 && tableIds.every((id) => accounts.has(id)),
  };
}

/**
 * A blocker is released when its table has no party and no open account.
 *
 * A missing room row is the contract's `open` default. The server still checks
 * again inside the publish transaction, so a stale room can cause a harmless
 * refusal; it cannot publish over a live account.
 */
export function blockingTablesReleased(room, tableIds) {
  return tableIds.every((tableId) => {
    const entry = room?.byTable?.get(tableId);
    return (
      !entry ||
      (entry.seatedAt == null && entry.openAccountId == null && entry.openAccountTableId == null)
    );
  });
}

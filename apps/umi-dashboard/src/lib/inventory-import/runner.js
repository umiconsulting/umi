import { fileError } from './schema.js';
import { journalKey, readJournal, writeJournal, validateBatch, unresolved } from './journal.js';

const running = new WeakMap();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function readImportBatch(storage, merchantId, kind) {
  const batch = readJournal(storage, merchantId, kind);
  for (const entry of batch?.entries || []) {
    if (entry.executionStatus === 'sending') entry.executionStatus = 'ambiguous';
  }
  return batch;
}

export function prepareImportBatch({ merchantId, locationId = null, preview, storage }) {
  const prior = readImportBatch(storage, merchantId, preview.kind);
  if (prior) throw fileError(unresolved(prior) ? 'UNRESOLVED_BATCH' : 'BATCH_EXISTS');
  const batch = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    merchantId,
    locationId,
    kind: preview.kind,
    revision: 0,
    entries: preview.entries.map((entry) => ({
      ...structuredClone(entry),
      command: entry.command
        ? {
            ...structuredClone(entry.command),
            targetAggregateId: entry.command.targetAggregateId || crypto.randomUUID(),
            commandId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
          }
        : null,
      executionStatus: entry.command ? 'pending' : 'skipped',
      result: null,
    })),
  };
  const validated = validateBatch(batch, merchantId, preview.kind);
  writeJournal(storage, validated);
  return validated;
}

export function clearImportBatch(storage, merchantId, kind) {
  const batch = readImportBatch(storage, merchantId, kind);
  if (batch?.entries.some((entry) => ['sending', 'ambiguous'].includes(entry.executionStatus)))
    throw fileError('UNRESOLVED_BATCH');
  if (running.get(storage)?.has(journalKey(merchantId, kind))) throw fileError('BATCH_RUNNING');
  try {
    storage.removeItem(journalKey(merchantId, kind));
  } catch {
    throw fileError('STORAGE_WRITE_FAILED');
  }
}

function failure(error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : null;
  const code =
    typeof error?.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(error.code)
      ? error.code
      : status
        ? 'COMMAND_FAILED'
        : 'UNKNOWN_OUTCOME';
  const reason = error?.details?.error?.details?.reason ?? error?.details?.reason;
  return {
    status,
    code:
      status === 409 && code === 'CONFLICT' && reason === 'INVENTORY_RECIPE_RETIRED'
        ? 'INVENTORY_RECIPE_RETIRED'
        : code,
  };
}

function success(response, operation) {
  const value = response?.result;
  const entity = operation.startsWith('inventory.item.') ? value?.item : value?.recipe;
  const result = { status: 'succeeded', entityId: entity?.id, version: entity?.version };
  if (
    !entity ||
    typeof result.entityId !== 'string' ||
    !Number.isSafeInteger(result.version) ||
    result.version < 1
  )
    throw fileError('UNKNOWN_OUTCOME');
  // Validate the identifier before a success can enter the journal.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.entityId))
    throw fileError('UNKNOWN_OUTCOME');
  return result;
}

export async function runImportBatch({
  batch: input,
  storage,
  execute,
  isCurrentMerchant,
  signal,
  onProgress,
  delay = sleep,
}) {
  const candidate = validateBatch(input, input?.merchantId, input?.kind);
  const key = journalKey(candidate.merchantId, candidate.kind);
  if (!running.has(storage)) running.set(storage, new Set());
  const locks = running.get(storage);
  if (locks.has(key)) throw fileError('BATCH_RUNNING');
  const batch = readImportBatch(storage, candidate.merchantId, candidate.kind);
  if (!batch) throw fileError('INVALID_BATCH');
  if (JSON.stringify(batch) !== JSON.stringify(candidate)) throw fileError('STALE_BATCH');
  locks.add(key);
  const canSend = () => !signal?.aborted && isCurrentMerchant(batch.merchantId);
  const persist = () => {
    batch.revision += 1;
    writeJournal(storage, batch);
  };
  const progress = async () => {
    try {
      await onProgress?.(structuredClone(batch));
    } catch {
      /* A callback cannot change a command outcome. */
    }
  };
  try {
    let sent = false;
    for (const entry of batch.entries) {
      if (!['pending', 'ambiguous', 'retryable'].includes(entry.executionStatus)) continue;
      if (!canSend()) break;
      if (sent) {
        await delay(400);
        if (!canSend()) break;
      }
      const previousStatus = entry.executionStatus;
      const previousResult = entry.result;
      entry.executionStatus = 'sending';
      entry.result = null;
      persist();
      // A storage adapter can change context synchronously while it saves.
      if (!canSend()) {
        entry.executionStatus = previousStatus;
        entry.result = previousResult;
        persist();
        break;
      }
      const command = structuredClone(entry.command);
      let stop = false;
      try {
        const response = await execute(
          batch.merchantId,
          command.operation,
          command.targetAggregateId,
          {
            locationId: batch.locationId,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            targetVersion: command.targetVersion,
            parameters: command.parameters,
          },
        );
        entry.result = success(response, command.operation);
        entry.executionStatus = 'success';
      } catch (error) {
        entry.result = failure(error);
        const status = entry.result.status;
        entry.executionStatus =
          !status || status >= 500
            ? 'ambiguous'
            : [401, 403, 429].includes(status)
              ? 'retryable'
              : 'error';
        stop = entry.executionStatus !== 'error';
      }
      persist();
      sent = true;
      await progress();
      if (stop) break;
    }
    return batch;
  } finally {
    locks.delete(key);
  }
}

export function importBatchResultRows(batch) {
  const validated = validateBatch(batch, batch?.merchantId, batch?.kind);
  return validated.entries
    .flatMap((entry) =>
      entry.rowNumbers.map((rowNumber) => ({
        rowNumber,
        reference: entry.reference,
        status: entry.executionStatus === 'skipped' ? entry.status : entry.executionStatus,
        message:
          entry.result?.code ||
          entry.errors
            .filter((error) => error.rowNumber === rowNumber)
            .map((error) => error.code)
            .join(', '),
      })),
    )
    .sort((a, b) => a.rowNumber - b.rowNumber);
}

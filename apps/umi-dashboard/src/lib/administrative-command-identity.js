export function administrativeRecoveryKey(operation, targetAggregateId, options = {}) {
  return [
    operation,
    targetAggregateId,
    options.targetVersion ?? 'none',
    options.approvalId ?? 'none',
  ].join(':');
}

export function readAdministrativeIdentity(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(storageKey(key)) || 'null');
    return value?.commandId && value?.idempotencyKey ? value : null;
  } catch {
    return null;
  }
}

export function writeAdministrativeIdentity(storage, key, identity) {
  storage.setItem(storageKey(key), JSON.stringify(identity));
}

export function removeAdministrativeIdentity(storage, key) {
  storage.removeItem(storageKey(key));
}

function storageKey(key) {
  return `umi-admin-command:${key}`;
}

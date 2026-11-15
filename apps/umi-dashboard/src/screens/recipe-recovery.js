export function recipeRecoveryKey(merchantId, userId) {
  return `umi-recipe-recovery:v1:${merchantId}:${userId}`;
}
export function readRecipeRecovery(storage, merchantId, userId) {
  try {
    const value = JSON.parse(storage.getItem(recipeRecoveryKey(merchantId, userId)) || 'null');
    if (
      value?.merchantId !== merchantId ||
      value?.userId !== userId ||
      !value?.recipeId ||
      !value?.request?.commandId ||
      !value?.request?.idempotencyKey
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function writeRecipeRecovery(storage, value) {
  storage.setItem(recipeRecoveryKey(value.merchantId, value.userId), JSON.stringify(value));
}
export function clearRecipeRecovery(storage, merchantId, userId, commandId) {
  const saved = readRecipeRecovery(storage, merchantId, userId);
  if (saved?.request.commandId === commandId)
    storage.removeItem(recipeRecoveryKey(merchantId, userId));
}

/** A retry keeps the exact identity and scope; a confirmed replacement is a new payload. */
export function prepareRecipeRequest(request, token, locationId) {
  return structuredClone({
    ...request,
    commandId: token ? crypto.randomUUID() : request.commandId || crypto.randomUUID(),
    idempotencyKey: token ? crypto.randomUUID() : request.idempotencyKey || crypto.randomUUID(),
    locationId: request.locationId === undefined ? locationId : request.locationId,
    parameters: { ...request.parameters, ...(token ? { replaceSalesMapping: token } : {}) },
  });
}

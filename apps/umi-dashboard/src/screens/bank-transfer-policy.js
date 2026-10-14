const cleanDigits = (value) => String(value ?? '').replace(/[\s-]/g, '');

export function bankTransferDraft(details = null, enabled = false) {
  return {
    enabled: enabled === true,
    holderName: details?.holderName ?? '',
    bankName: details?.bankName ?? '',
    clabe: details?.clabe ?? '',
    accountNumber: details?.accountNumber ?? '',
  };
}

export function prepareBankTransfer(draft) {
  const holderName = draft.holderName.trim();
  const bankName = draft.bankName.trim();
  const clabe = cleanDigits(draft.clabe);
  const accountNumber = cleanDigits(draft.accountNumber);
  const hasDetails = Boolean(holderName || bankName || clabe || accountNumber);

  if (draft.enabled || hasDetails) {
    if (!holderName || !bankName) return { error: 'identity' };
    if (holderName.length > 120 || bankName.length > 120) return { error: 'length' };
    if (!clabe && !accountNumber) return { error: 'destination' };
    if (clabe && !/^\d{18}$/.test(clabe)) return { error: 'clabe' };
    if (accountNumber && !/^\d{1,24}$/.test(accountNumber)) return { error: 'account' };
  }

  return {
    bankTransferEnabled: draft.enabled,
    bankTransferDetails: hasDetails
      ? { holderName, bankName, clabe: clabe || null, accountNumber: accountNumber || null }
      : null,
  };
}

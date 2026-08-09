import { createHash } from 'node:crypto';
import type {
  CheckoutCommand,
  CheckoutPolicy,
  PaymentSummary,
  TenderAllocation,
  TotalsConfirmation,
} from '@umi/contract';

type CheckoutFailureCode =
  | 'INSUFFICIENT_CASH'
  | 'INVALID_TENDER_AMOUNT'
  | 'REMAINING_BALANCE'
  | 'TENDER_OVERALLOCATION'
  | 'TIP_REJECTED'
  | 'DISCOUNT_REJECTED'
  | 'APPROVAL_REQUIRED'
  | 'TERMINAL_REPORTED_FAILURE'
  | 'TERMINAL_OUTCOME_UNKNOWN';

export type CheckoutCalculation =
  | {
      ok: true;
      confirmation: TotalsConfirmation;
      summary: PaymentSummary;
      approvalRequired: boolean;
    }
  | {
      ok: false;
      code: CheckoutFailureCode;
      confirmation: TotalsConfirmation;
      summary: PaymentSummary | null;
      approvalRequired: boolean;
    };

const safeAdd = (left: number, right: number) => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError('Money exceeds the safe integer range.');
  return result;
};

export function calculateCheckout(
  source: TotalsConfirmation,
  command: CheckoutCommand,
  policy: CheckoutPolicy,
  lineDiscountBases: ReadonlyMap<string, number> = new Map(),
  rewardDiscount: { authorizationId: string; amountMinorUnits: number } | null = null,
): CheckoutCalculation {
  const currency = source.totals.grandTotal.currency;
  const money = (minorUnits: number) => ({ minorUnits, currency });
  let discountTotal = rewardDiscount?.amountMinorUnits ?? 0;
  let operatorDiscountTotal = 0;
  const discountEntries: TotalsConfirmation['discounts']['entries'] = [];
  if (rewardDiscount) {
    if (
      !Number.isSafeInteger(rewardDiscount.amountMinorUnits) ||
      rewardDiscount.amountMinorUnits <= 0
    ) {
      return failure('DISCOUNT_REJECTED', source, null, false);
    }
    discountEntries.push({
      code: 'order_fixed',
      label: `loyalty_reward:${rewardDiscount.authorizationId}`,
      amount: money(rewardDiscount.amountMinorUnits),
      lineId: null,
    });
  }
  const lineDiscountTotals = new Map<string, number>();

  if (command.discountDrafts.length && !policy.discount.enabled) {
    return failure('DISCOUNT_REJECTED', source, null, false);
  }
  for (const draft of command.discountDrafts) {
    if (draft.fixedAmount && draft.fixedAmount.currency !== currency) {
      return failure('DISCOUNT_REJECTED', source, null, false);
    }
    const isPercentage = draft.type.endsWith('percentage');
    const discountBase = draft.type.startsWith('line_')
      ? (lineDiscountBases.get(draft.lineId ?? '') ?? -1)
      : source.totals.subtotal.minorUnits;
    const amount = isPercentage
      ? Math.round((discountBase * (draft.basisPoints ?? 0)) / 10_000)
      : (draft.fixedAmount?.minorUnits ?? 0);
    if (
      amount <= 0 ||
      discountBase < 0 ||
      (draft.basisPoints ?? 0) > policy.discount.maximumBasisPoints ||
      amount > policy.discount.maximumAmount.minorUnits
    ) {
      return failure('DISCOUNT_REJECTED', source, null, false);
    }
    if (draft.type.startsWith('line_')) {
      const lineId = draft.lineId!;
      const lineDiscount = safeAdd(lineDiscountTotals.get(lineId) ?? 0, amount);
      if (lineDiscount > discountBase) {
        return failure('DISCOUNT_REJECTED', source, null, false);
      }
      lineDiscountTotals.set(lineId, lineDiscount);
    }
    discountTotal = safeAdd(discountTotal, amount);
    operatorDiscountTotal = safeAdd(operatorDiscountTotal, amount);
    discountEntries.push({
      code: draft.type,
      label: draft.reason,
      amount: money(amount),
      lineId: draft.type.startsWith('line_') ? draft.lineId : null,
    });
  }
  if (discountTotal > source.totals.subtotal.minorUnits) {
    return failure('DISCOUNT_REJECTED', source, null, false);
  }
  const approvalRequired =
    operatorDiscountTotal > policy.discount.cashierThreshold.minorUnits ||
    (policy.discount.customRequiresApproval &&
      command.discountDrafts.some((draft) => draft.type.endsWith('fixed')));

  const discountedSubtotal = source.totals.subtotal.minorUnits - discountTotal;
  let tipAmount = 0;
  if (command.tipDraft && command.tipDraft.kind !== 'none') {
    if (!policy.tip.enabled) return failure('TIP_REJECTED', source, null, approvalRequired);
    if (command.tipDraft.fixedAmount && command.tipDraft.fixedAmount.currency !== currency) {
      return failure('TIP_REJECTED', source, null, approvalRequired);
    }
    if (command.tipDraft.kind === 'percentage') {
      const basisPoints = command.tipDraft.basisPoints ?? -1;
      if (
        basisPoints < 0 ||
        (!policy.tip.customPercentageEnabled && !policy.tip.presetBasisPoints.includes(basisPoints))
      ) {
        return failure('TIP_REJECTED', source, null, approvalRequired);
      }
      tipAmount = Math.round((discountedSubtotal * basisPoints) / 10_000);
    } else {
      if (!policy.tip.customFixedEnabled) {
        return failure('TIP_REJECTED', source, null, approvalRequired);
      }
      tipAmount = command.tipDraft.fixedAmount?.minorUnits ?? -1;
    }
    if (tipAmount < 0 || tipAmount > policy.tip.maximumTip.minorUnits) {
      return failure('TIP_REJECTED', source, null, approvalRequired);
    }
  }

  const amountDue = safeAdd(discountedSubtotal, tipAmount);
  const taxTotal =
    source.totals.subtotal.minorUnits === 0
      ? 0
      : Math.round(
          (source.totals.tax.minorUnits * discountedSubtotal) / source.totals.subtotal.minorUnits,
        );
  const confirmation: TotalsConfirmation = {
    ...source,
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          source: source.fingerprint,
          discounts: command.discountDrafts,
          customerValue: command.customerValue
            ? {
                previewFingerprint: command.customerValue.previewFingerprint,
                rewardAuthorizationId: command.customerValue.rewardAuthorizationId,
                storedValueAuthorizationIds: command.customerValue.storedValueAuthorizationIds,
                fundedGiftCards: command.customerValue.fundedGiftCards,
              }
            : null,
          rewardDiscount,
          tip: command.tipDraft,
          tenders: command.tenderDrafts,
          receiptDelivery: command.receiptDelivery,
          policyVersion: policy.version,
          amountDue,
        }),
      )
      .digest('hex'),
    totals: {
      ...source.totals,
      tax: money(taxTotal),
      discounts: { total: money(discountTotal), entries: discountEntries },
      grandTotal: money(amountDue),
    },
    taxes: {
      total: money(taxTotal),
      entries: source.taxes.entries.map((entry) => ({
        ...entry,
        taxableAmount: money(
          source.totals.subtotal.minorUnits === 0
            ? 0
            : Math.round(
                (entry.taxableAmount.minorUnits * discountedSubtotal) /
                  source.totals.subtotal.minorUnits,
              ),
        ),
        taxAmount: money(
          source.totals.tax.minorUnits === 0
            ? 0
            : Math.round((entry.taxAmount.minorUnits * taxTotal) / source.totals.tax.minorUnits),
        ),
      })),
    },
    discounts: { total: money(discountTotal), entries: discountEntries },
  };
  if (amountDue <= 0) {
    return failure(
      command.discountDrafts.length ? 'DISCOUNT_REJECTED' : 'INVALID_TENDER_AMOUNT',
      confirmation,
      null,
      approvalRequired,
    );
  }

  if (command.tenderDrafts.length > policy.maximumTenderLines) {
    return failure('INVALID_TENDER_AMOUNT', confirmation, null, approvalRequired);
  }
  if (
    command.tenderDrafts.some((draft) => draft.amount.currency !== currency) ||
    new Set(command.tenderDrafts.map((draft) => draft.id)).size !== command.tenderDrafts.length
  ) {
    return failure('INVALID_TENDER_AMOUNT', confirmation, null, approvalRequired);
  }
  if (
    command.tenderDrafts.some((draft) => draft.type === 'manual_terminal') &&
    !policy.manualTerminalEnabled
  ) {
    return failure('INVALID_TENDER_AMOUNT', confirmation, null, approvalRequired);
  }
  if (command.tenderDrafts.length > 1 && !policy.mixedTenderEnabled) {
    return failure('INVALID_TENDER_AMOUNT', confirmation, null, approvalRequired);
  }

  const allocations: TenderAllocation[] = [];
  let applied = 0;
  let change = 0;
  let terminalUnknown = false;
  for (const draft of command.tenderDrafts) {
    if (!Number.isSafeInteger(draft.amount.minorUnits) || draft.amount.minorUnits <= 0) {
      return failure('INVALID_TENDER_AMOUNT', confirmation, null, approvalRequired);
    }
    if (draft.type === 'manual_terminal') {
      if (draft.status === 'outcome_unknown') {
        terminalUnknown = true;
      }
      if (draft.status === 'operator_reported_failure') {
        return failure('TERMINAL_REPORTED_FAILURE', confirmation, null, approvalRequired);
      }
      if (draft.status !== 'confirmed_success' && draft.status !== 'outcome_unknown') {
        return failure('REMAINING_BALANCE', confirmation, null, approvalRequired);
      }
    }
    const received = draft.type === 'cash' ? draft.amountReceived : null;
    if (
      draft.type === 'cash' &&
      (!received || received.currency !== currency || received.minorUnits < draft.amount.minorUnits)
    ) {
      return failure('INSUFFICIENT_CASH', confirmation, null, approvalRequired);
    }
    applied = safeAdd(applied, draft.amount.minorUnits);
    const tenderChange = received ? received.minorUnits - draft.amount.minorUnits : 0;
    change = safeAdd(change, tenderChange);
    allocations.push({
      tenderId: draft.id,
      type: draft.type,
      applied: draft.amount,
      received,
      change: money(tenderChange),
      status: draft.status,
      authorizationId: draft.authorizationId ?? null,
    });
  }

  const remaining = amountDue - applied;
  const state =
    applied === 0
      ? 'no_tender_applied'
      : remaining > 0
        ? 'partially_covered'
        : remaining === 0
          ? 'fully_covered'
          : 'overpayment_invalid';
  const summary: PaymentSummary = {
    checkoutId: command.cartId,
    state: 'collecting_payment',
    tenders: allocations,
    amountDue: money(amountDue),
    appliedAmount: money(applied),
    remainingBalance: money(Math.max(remaining, 0)),
    change: money(change),
    partialPaymentState: state,
    tip: command.tipDraft
      ? {
          draft: command.tipDraft,
          amount: money(tipAmount),
          policyVersion: policy.tip.version,
        }
      : null,
    discounts: confirmation.discounts,
  };
  if (terminalUnknown) {
    return failure('TERMINAL_OUTCOME_UNKNOWN', confirmation, summary, approvalRequired);
  }
  if (remaining < 0) {
    return failure('TENDER_OVERALLOCATION', confirmation, summary, approvalRequired);
  }
  if (remaining > 0) {
    return failure('REMAINING_BALANCE', confirmation, summary, approvalRequired);
  }
  if (approvalRequired && command.approvalIds.length === 0) {
    return failure('APPROVAL_REQUIRED', confirmation, summary, true);
  }
  return { ok: true, confirmation, summary, approvalRequired };
}

function failure(
  code: CheckoutFailureCode,
  confirmation: TotalsConfirmation,
  summary: PaymentSummary | null,
  approvalRequired: boolean,
): CheckoutCalculation {
  return { ok: false, code, confirmation, summary, approvalRequired };
}

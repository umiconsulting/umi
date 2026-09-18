import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  CartItem,
  CartLineInput,
  CheckoutCancellationRequest,
  CheckoutCommand,
  CheckoutPolicy,
  CheckoutRecoveryQuery,
  CheckoutResult,
  CheckoutTerminalRecoveryRequest,
  PaymentOutcome,
  PaymentSummary,
  PaymentStatusQuery,
  PosCheckoutPolicyQuery,
  ReceiptSnapshot,
  StoredValueFingerprintInput,
  TaxBreakdown,
  TotalsConfirmation,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import { inventoryConflictCode } from '../pos-inventory/inventory-errors';
import { canonicalStoredValueFingerprint } from '../pos-customer-value/customer-value-domain';
import { PosCartRepository, type PricedSelection } from '../pos-cart/pos-cart.repository';
import { getRequestContext } from '../../shared/database/request-context';
import { CashRefusal } from '../pos-cash/cash-refusal';
import { PosCheckoutRepository, type CheckoutCart } from './pos-checkout.repository';
import { calculateCheckout } from './checkout-calculator';

const safeMoney = (value: number) => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('Money exceeds the safe integer range.');
  }
  return value;
};

@Injectable()
export class PosCheckoutService {
  constructor(
    private readonly repo: PosCheckoutRepository,
    private readonly carts: PosCartRepository,
    private readonly integrity: IntegrityService,
  ) {}

  async checkout(user: AuthUser, merchantId: string, dto: CheckoutCommand) {
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
    );
    const result = await this.withInventoryErrors(
      this.integrity.execute<CheckoutResult>(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId ?? randomUUID(),
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.checkout',
          payload: dto,
        },
        async (context) => {
          const cart = await this.repo.lockCart(
            context.client,
            merchantId,
            dto.locationId,
            dto.operatorSessionId,
            dto.cartId,
            dto.expectedCartVersion,
            authorization.operatorName,
          );
          if (!cart) {
            return {
              ok: false,
              code: 'OPTIMISTIC_VERSION_CONFLICT',
              failureClass: 'conflict',
              retryable: false,
            };
          }
          const repriced = await this.reprice(context.client, cart, dto.idempotencyKey);
          if (!repriced) {
            return {
              ok: false,
              code: 'CHECKOUT_CART_CHANGED',
              failureClass: 'validation',
              retryable: false,
            };
          }
          const policy = await this.repo.policy(
            context.client,
            merchantId,
            dto.locationId,
            repriced.public.totals.grandTotal.currency,
          );
          const customerValueAllocation = await this.repo.customerValueAllocation(
            context.client,
            cart,
            dto.customerValue,
          );
          const lineAmounts = new Map(
            repriced.lineSnapshot.map((line) => [line.id, line.price.lineSubtotal.minorUnits]),
          );
          const calculation = calculateCheckout(
            repriced.public,
            dto,
            policy,
            lineAmounts,
            customerValueAllocation.rewardDiscount,
          );
          const customerValueBasisFingerprint = calculateCheckout(
            repriced.public,
            {
              ...dto,
              customerValue: null,
              tenderDrafts: dto.tenderDrafts.filter(
                (tender) => tender.type !== 'wallet' && tender.type !== 'gift_card',
              ),
            },
            policy,
            lineAmounts,
            null,
          ).confirmation.fingerprint;
          const cashMinorUnits = dto.tenderDrafts
            .filter((tender) => tender.type === 'cash')
            .reduce((total, tender) => total + tender.amount.minorUnits, 0);
          const manualTerminalMinorUnits = dto.tenderDrafts
            .filter((tender) => tender.type === 'manual_terminal')
            .reduce((total, tender) => total + tender.amount.minorUnits, 0);
          const walletAllocationIds = customerValueAllocation.storedValue
            .filter((allocation) => allocation.accountType === 'wallet')
            .map((allocation) => allocation.allocationId)
            .sort();
          const giftCardAllocationIds = customerValueAllocation.storedValue
            .filter((allocation) => allocation.accountType === 'gift_card')
            .map((allocation) => allocation.allocationId)
            .sort();
          const fingerprintInput: StoredValueFingerprintInput = {
            merchantId,
            locationId: dto.locationId,
            customerId: cart.customerId,
            saleId: cart.id,
            saleVersion: cart.version,
            checkoutId: cart.id,
            checkoutVersion: cart.version,
            cartFingerprint: repriced.public.fingerprint,
            totalsFingerprint: calculation.confirmation.fingerprint,
            currency: calculation.confirmation.totals.grandTotal.currency,
            loyaltyPolicyVersion: dto.customerValue?.previewFingerprint ?? 'none',
            rewardPolicyVersion: customerValueAllocation.rewardDiscount?.policyVersion ?? 'none',
            selectedRewardId: customerValueAllocation.rewardDiscount?.rewardId ?? null,
            rewardAuthorizationId: customerValueAllocation.rewardDiscount?.authorizationId ?? null,
            receiptDestination: dto.receiptDelivery.destination,
            businessDate: cart.businessDate,
            deviceId: authorization.deviceId,
            credentialVersion: authorization.credentialVersion,
            operatorSessionId: cart.operatorSessionId,
            commandId: dto.customerValueFingerprintCommandId ?? context.commandId,
            allocations: customerValueAllocation.storedValue.map((allocation) => ({
              allocationId: allocation.allocationId,
              tenderType: allocation.accountType,
              accountId: allocation.accountId,
              accountPublicReference: allocation.accountPublicReference,
              authorizationId: allocation.authorizationId,
              merchantId,
              locationId: dto.locationId,
              customerId: allocation.customerId,
              saleId: cart.id,
              checkoutId: cart.id,
              checkoutVersion: cart.version,
              currency: allocation.currency,
              requestedAmountMinorUnits: allocation.amountMinorUnits,
              authorizedAmountMinorUnits: allocation.amountMinorUnits,
              committedAmountMinorUnits: 0,
              remainingAccountBalanceMinorUnits: allocation.remainingBalanceMinorUnits,
              allocationOrder: allocation.allocationOrder,
              cashAllocationMinorUnits: cashMinorUnits,
              manualTerminalAllocationMinorUnits: manualTerminalMinorUnits,
              walletAllocationIds,
              giftCardAllocationIds,
              policyId: `${allocation.accountType}-pilot`,
              policyVersion: allocation.policyVersion,
              authorizationExpiresAt: allocation.expiresAt,
              commandId: allocation.commandId,
              idempotencyKey: allocation.idempotencyKey,
              optimisticVersion: allocation.optimisticVersion,
            })),
            cashMinorUnits,
            manualTerminalMinorUnits,
          };
          const finalStoredValueFingerprint = canonicalStoredValueFingerprint(fingerprintInput);
          const approvalTenderFingerprint = canonicalStoredValueFingerprint({
            ...fingerprintInput,
            totalsFingerprint: customerValueBasisFingerprint,
            rewardPolicyVersion: 'none',
            selectedRewardId: null,
            rewardAuthorizationId: null,
          });
          const storedValueFingerprint = customerValueAllocation.rewardDiscount
            ? finalStoredValueFingerprint
            : approvalTenderFingerprint;
          if (
            customerValueAllocation.rewardDiscount?.approvalTenderFingerprint &&
            customerValueAllocation.rewardDiscount.approvalTenderFingerprint !==
              approvalTenderFingerprint
          ) {
            throw new ConflictException({ code: 'APPROVAL_INVALID' });
          }
          if (customerValueAllocation.rewardDiscount) {
            await this.repo.bindRewardStoredValueFingerprint(
              context.client,
              customerValueAllocation.rewardDiscount.authorizationId,
              storedValueFingerprint,
            );
          }
          const confirmation: TotalsConfirmation = {
            ...calculation.confirmation,
            storedValueFingerprint,
          };
          const previewRecoveryState = this.recoveryState(calculation.ok ? null : calculation.code);
          const previewState =
            previewRecoveryState === 'terminal_outcome_unknown'
              ? 'payment_unknown'
              : calculation.ok
                ? 'selecting_tender'
                : 'collecting_payment';
          const previewDraft = await this.repo.saveDraft(
            context.client,
            user.deviceId!,
            cart,
            dto,
            previewState,
            calculation.summary,
            previewRecoveryState,
            confirmation.fingerprint,
          );
          if (!previewDraft) {
            // The draft's own guards refused the write: a settled draft, or a
            // tender set that DROPS a terminal payment already marked confirmed.
            // Both mean "this tender cannot be recorded", which is a refusal
            // about the tender and not a server fault — so it is answered the
            // way every other tender refusal is, instead of as a 500 that names
            // nothing and invites a retry that cannot work.
            return {
              ok: true,
              value: this.recoverableResult(
                confirmation,
                calculation.summary,
                policy,
                dto,
                'INVALID_TENDER_AMOUNT',
                context.correlationId,
                null,
              ),
            };
          }
          const previewSummary = calculation.summary
            ? { ...calculation.summary, checkoutId: previewDraft.id }
            : null;
          if (!calculation.ok && calculation.code === 'TERMINAL_OUTCOME_UNKNOWN') {
            const unknownPayment = await this.repo.unknownTerminal(
              context.client,
              cart,
              previewDraft.id,
              previewSummary!.tenders.find((tender) => tender.type === 'manual_terminal')!,
              context.correlationId,
            );
            await context.appendAudit({
              eventType: 'checkout.terminal_outcome_unknown',
              entityType: 'pos_checkout',
              entityId: previewDraft.id,
              outcome: 'failure',
              reasonCode: calculation.code,
              publicData: { recoveryState: previewRecoveryState },
            });
            return {
              ok: true,
              value: this.recoverableResult(
                confirmation,
                previewSummary,
                policy,
                dto,
                calculation.code,
                context.correlationId,
                unknownPayment,
              ),
            };
          }
          if (dto.totalsFingerprint !== confirmation.fingerprint) {
            const code =
              dto.totalsFingerprint === null
                ? 'CHECKOUT_CONFIRMATION_REQUIRED'
                : 'CHECKOUT_CART_CHANGED';
            return {
              ok: true,
              value: {
                status: 'confirmation_required',
                confirmation,
                payment: null,
                payments: [],
                reservation: null,
                sale: null,
                receipt: null,
                failure: {
                  code,
                  retryable: false,
                  operatorGuidance: 'confirm_totals',
                  correlationId: context.correlationId,
                  requiredPermission: null,
                },
                paymentSummary: previewSummary,
                recoveryState: 'none',
                receiptDelivery: dto.receiptDelivery,
                policy,
              },
            };
          }
          const confirmed: TotalsConfirmation = {
            ...confirmation,
            confirmedAt: new Date().toISOString(),
          };
          const discountPermissionDenied =
            dto.discountDrafts.length > 0 &&
            !authorization.permissions.includes('checkout.discount.apply') &&
            !authorization.permissions.includes('*');
          const tipPermissionDenied =
            dto.tipDraft !== null &&
            policy.tip.requiredPermission !== null &&
            !authorization.permissions.includes(policy.tip.requiredPermission) &&
            !authorization.permissions.includes('*');
          const terminalPermissionDenied =
            dto.tenderDrafts.some((tender) => tender.type === 'manual_terminal') &&
            !authorization.permissions.includes('checkout.terminal.confirm') &&
            !authorization.permissions.includes('*');
          const walletPermissionDenied =
            dto.tenderDrafts.some((tender) => tender.type === 'wallet') &&
            !authorization.permissions.includes('wallet.redeem') &&
            !authorization.permissions.includes('*');
          const giftCardPermissionDenied =
            dto.tenderDrafts.some((tender) => tender.type === 'gift_card') &&
            !authorization.permissions.includes('gift_card.redeem') &&
            !authorization.permissions.includes('*');
          const tenderAuthorizationIds = dto.tenderDrafts
            .filter((tender) => tender.type === 'wallet' || tender.type === 'gift_card')
            .map((tender) => tender.authorizationId)
            .filter((id): id is string => id != null)
            .sort();
          const selectedAuthorizationIds = [
            ...(dto.customerValue?.storedValueAuthorizationIds ?? []),
          ].sort();
          const storedValueTenderMismatch = dto.tenderDrafts
            .filter((tender) => tender.type === 'wallet' || tender.type === 'gift_card')
            .some((tender) => {
              const allocation = customerValueAllocation.storedValue.find(
                (candidate) => candidate.authorizationId === tender.authorizationId,
              );
              return (
                !allocation ||
                allocation.accountType !== tender.type ||
                allocation.amountMinorUnits !== tender.amount.minorUnits ||
                allocation.currency !== tender.amount.currency
              );
            });
          const storedValueSelectionInvalid =
            JSON.stringify(tenderAuthorizationIds) !== JSON.stringify(selectedAuthorizationIds) ||
            storedValueTenderMismatch ||
            (dto.customerValue != null &&
              dto.customerValue?.storedValueFingerprint !== storedValueFingerprint);
          const calculationCode = calculation.ok ? null : calculation.code;
          const recoveryState = this.recoveryState(calculationCode);
          const draftState =
            recoveryState === 'terminal_outcome_unknown'
              ? 'payment_unknown'
              : calculation.ok &&
                  !discountPermissionDenied &&
                  !tipPermissionDenied &&
                  !terminalPermissionDenied &&
                  !walletPermissionDenied &&
                  !giftCardPermissionDenied &&
                  !storedValueSelectionInvalid
                ? 'payment_accepted'
                : calculationCode === 'APPROVAL_REQUIRED'
                  ? 'awaiting_authorization'
                  : 'collecting_payment';
          const draft = await this.repo.saveDraft(
            context.client,
            user.deviceId!,
            cart,
            dto,
            draftState,
            calculation.summary,
            recoveryState,
            confirmed.fingerprint,
          );
          if (!draft) {
            // Same refusal as the preview's, at the commit: the tender cannot be
            // recorded because it would drop a terminal payment already marked
            // confirmed. See the preview site for why this is not an error.
            return {
              ok: true,
              value: this.recoverableResult(
                confirmed,
                calculation.summary,
                policy,
                dto,
                'INVALID_TENDER_AMOUNT',
                context.correlationId,
                null,
              ),
            };
          }
          const persistedSummary = calculation.summary
            ? { ...calculation.summary, checkoutId: draft.id }
            : null;
          if (!calculation.ok) {
            await context.appendAudit({
              eventType: `checkout.${calculation.code.toLowerCase()}`,
              entityType: 'pos_checkout',
              entityId: draft.id,
              outcome: 'failure',
              reasonCode: calculation.code,
              publicData: { recoveryState },
            });
            return {
              ok: true,
              value: this.recoverableResult(
                confirmed,
                persistedSummary,
                policy,
                dto,
                calculation.code,
                context.correlationId,
              ),
            };
          }
          const summary: PaymentSummary = {
            ...calculation.summary,
            checkoutId: draft.id,
          };
          if (
            discountPermissionDenied ||
            tipPermissionDenied ||
            terminalPermissionDenied ||
            walletPermissionDenied ||
            giftCardPermissionDenied ||
            storedValueSelectionInvalid
          ) {
            return {
              ok: true,
              value: this.recoverableResult(
                confirmed,
                summary,
                policy,
                dto,
                terminalPermissionDenied || walletPermissionDenied || giftCardPermissionDenied
                  ? 'PERMISSION_REVOKED'
                  : storedValueSelectionInvalid
                    ? 'INVALID_TENDER_AMOUNT'
                    : tipPermissionDenied
                      ? 'TIP_REJECTED'
                      : 'DISCOUNT_REJECTED',
                context.correlationId,
              ),
            };
          }
          const terminalApprovalRequired = summary.tenders.some(
            (tender) =>
              tender.type === 'manual_terminal' &&
              tender.applied.minorUnits > policy.manualTerminalApprovalThreshold.minorUnits,
          );
          const negativeStockApprovalRequired = await this.repo.negativeStockApprovalRequired(
            context.client,
            cart,
          );
          const requiredApprovals = [
            ...(calculation.approvalRequired ? [policy.discount.approvalPermission] : []),
            ...(terminalApprovalRequired ? [policy.manualTerminalApprovalPermission] : []),
            ...(negativeStockApprovalRequired ? ['inventory.negative_stock.override'] : []),
          ];
          let approvalIdsByPermission: Record<string, string> = {};
          if (requiredApprovals.length) {
            const approval = await this.repo.consumeApprovals(context.client, dto.approvalIds, {
              sessionId: user.sessionId,
              merchantId,
              locationId: dto.locationId,
              permissions: requiredApprovals,
              fingerprint: confirmed.fingerprint,
              commandId: context.commandId,
            });
            if (!approval.approved) {
              return {
                ok: true,
                value: this.recoverableResult(
                  confirmed,
                  summary,
                  policy,
                  dto,
                  'APPROVAL_REQUIRED',
                  context.correlationId,
                  null,
                  approval.missingPermission,
                ),
              };
            }
            approvalIdsByPermission = approval.approvalIdsByPermission;
          }
          const reservation = await this.repo.reserve(
            context.client,
            cart,
            repriced.lineSnapshot,
            authorization,
            context.commandId,
            dto.idempotencyKey,
            confirmed.fingerprint,
            context.correlationId,
            approvalIdsByPermission['inventory.negative_stock.override'] ?? null,
          );
          const payments = await this.repo.payments(
            context.client,
            cart,
            draft.id,
            summary,
            context.correlationId,
          );
          const receipt = this.receipt(
            cart,
            confirmed,
            payments,
            summary,
            repriced.lineSnapshot,
            dto,
          );
          const committed = await this.repo.commit(
            context.client,
            cart,
            confirmed,
            payments,
            summary,
            draft.id,
            reservation,
            receipt,
            dto.cashShiftId ?? null,
            context.commandId,
            authorization,
            context.correlationId,
            dto.idempotencyKey,
            customerValueBasisFingerprint,
            dto.customerValue ?? null,
          );
          const sale = committed.sale;
          await context.appendFinancial(
            {
              aggregateType: 'pos_sale',
              aggregateId: sale.id,
              eventType: 'sale.committed',
              amountMinorUnits: confirmed.totals.grandTotal.minorUnits,
              currency: confirmed.totals.grandTotal.currency,
              publicData: {
                receiptRef: receipt.receiptRef,
                tenderCount: summary.tenders.length,
              },
            },
            0,
          );
          await context.appendAudit({
            eventType: 'checkout.completed',
            entityType: 'pos_sale',
            entityId: sale.id,
            outcome: 'success',
            publicData: { receiptRef: receipt.receiptRef },
          });
          const committedResult: CheckoutResult = {
            status: 'completed',
            confirmation: confirmed,
            payment: payments[0] ?? null,
            payments,
            reservation,
            sale,
            receipt,
            failure: null,
            paymentSummary: { ...summary, state: 'completed' },
            recoveryState: 'none',
            receiptDelivery: dto.receiptDelivery,
            policy,
            customerValue: committed.customerValue,
          };
          await this.repo.saveCommittedResult(context.client, draft.id, committedResult);
          return {
            ok: true,
            value: committedResult,
          };
        },
      ),
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({
        code: result.failureCode ?? 'CHECKOUT_CART_CHANGED',
      });
    }
    return result.result;
  }

  private async withInventoryErrors<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      // A cash refusal names its own status and carries the facts the operator
      // needs (`CashShiftRequired` → the register and its `hold`). Without this
      // it fell through the catch-all filter as a 500 "Internal server error"
      // and the till offered a retry that re-sent the same broken payload.
      if (error instanceof CashRefusal) {
        throw new HttpException({ code: error.code, details: error.details }, error.status);
      }
      const code = inventoryConflictCode(error);
      if (code) throw new ConflictException({ code });
      throw error;
    }
  }

  async recovery(user: AuthUser, merchantId: string, cartId: string, query: CheckoutRecoveryQuery) {
    const authorization = await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
    );
    const snapshot = await this.repo.recovery(
      merchantId,
      query.locationId,
      query.operatorSessionId,
      cartId,
      user.id,
      authorization.permissions.includes('checkout.recover.any') ||
        authorization.permissions.includes('*'),
    );
    if (!snapshot) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return snapshot;
  }

  /**
   * Withdraw a terminal claim the operator has read and found false.
   *
   * `cancel` above refuses a draft that holds one, and the tender guard refuses a
   * later tender set that would drop one — both correctly, because a claim that
   * money changed hands must not be erased by a route that was not asked to erase
   * it. This is the route that IS asked: it names the tender, it asks for the
   * permission a card terminal requires, and it keeps the operator's reason in the
   * audit trail. Without it a cashier whose terminal did not charge had a cart they
   * could not pay, a screen they could not leave, and no sentence to say it with.
   */
  async recoverTerminalClaim(
    user: AuthUser,
    merchantId: string,
    cartId: string,
    dto: CheckoutTerminalRecoveryRequest,
  ) {
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
    );
    if (
      !authorization.permissions.includes('checkout.terminal.confirm') &&
      !authorization.permissions.includes('*')
    ) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();
    const result = await this.integrity.execute<{
      draftId: string;
      withdrawnTenderDraftId: string;
      remainingTenderDrafts: number;
      recoveredAt: string;
      correlationId: string;
    }>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'pos.checkout.terminal_recovery',
        payload: { cartId, ...dto },
        correlationId,
      },
      async (context) => {
        const recovered = await this.repo.recoverTerminalClaim(
          context.client,
          merchantId,
          dto.locationId,
          dto.operatorSessionId,
          cartId,
          dto.tenderDraftId,
        );
        if (!recovered) {
          // Either there is no draft, or it holds no unresolved terminal claim
          // under that id. Both mean this route has nothing to withdraw, and a
          // route that cleared tenders it was not pointed at would be exactly the
          // erasure the guards exist to prevent.
          return {
            ok: false as const,
            code: 'TENDER_NOT_RECOVERABLE',
            failureClass: 'validation' as const,
            retryable: false,
          };
        }
        await context.appendAudit({
          eventType: 'checkout.terminal_claim_withdrawn',
          entityType: 'pos_checkout',
          entityId: recovered.id,
          outcome: 'success',
          reasonCode: dto.evidence,
          publicData: {
            cartId,
            tenderDraftId: dto.tenderDraftId,
            evidence: dto.evidence,
            note: dto.note,
            remainingTenderDrafts: recovered.remaining,
          },
        });
        return {
          ok: true as const,
          value: {
            draftId: recovered.id,
            withdrawnTenderDraftId: dto.tenderDraftId,
            remainingTenderDrafts: recovered.remaining,
            recoveredAt: new Date().toISOString(),
            correlationId,
          },
        };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      const code = result.failureCode ?? 'TENDER_NOT_RECOVERABLE';
      if (code === 'TENDER_NOT_RECOVERABLE' || code === 'RESOURCE_NOT_FOUND') {
        throw new NotFoundException({ code });
      }
      throw new ConflictException({ code });
    }
    return { ok: true as const, data: result.result };
  }

  async cancel(
    user: AuthUser,
    merchantId: string,
    cartId: string,
    dto: CheckoutCancellationRequest,
  ) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    const result = await this.integrity.execute<{
      cartId: string;
      checkoutId: string | null;
      state: 'ready';
      cancelledAt: string;
    }>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'pos.checkout.cancel',
        payload: { cartId, ...dto },
      },
      async (context) => {
        const cancelled = await this.repo.cancelDraft(
          context.client,
          merchantId,
          dto.locationId,
          dto.operatorSessionId,
          cartId,
        );
        if (cancelled.blocked) {
          return {
            ok: false,
            code: 'PAYMENT_OUTCOME_UNKNOWN',
            failureClass: 'conflict',
            retryable: false,
          };
        }
        await context.appendAudit({
          eventType: 'checkout.cancelled',
          entityType: 'pos_cart',
          entityId: cartId,
          outcome: 'success',
          reasonCode: dto.reason,
          publicData: { hadCheckoutDraft: cancelled.id !== null },
        });
        return {
          ok: true,
          value: {
            cartId,
            checkoutId: cancelled.id,
            state: 'ready' as const,
            cancelledAt: new Date().toISOString(),
          },
        };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({ code: result.failureCode ?? 'CHECKOUT_CONFLICT' });
    }
    return result.result;
  }

  async paymentStatus(
    user: AuthUser,
    merchantId: string,
    paymentId: string,
    query: PaymentStatusQuery,
  ) {
    await this.authorize(user, merchantId, query.locationId, query.operatorSessionId);
    const value = await this.repo.paymentStatus(merchantId, query.locationId, paymentId);
    if (!value) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return value;
  }

  /**
   * What the tender screen may offer, answered BEFORE anything is charged.
   *
   * Same authorisation as the charge itself — an enrolled device and an active
   * operator session with `checkout.commit` — because the answer is about what
   * *this* operator may take. The policy is server-issued and a location without
   * a row reads as default-deny, which is why this returns the policy rather
   * than a boolean: the till has to be able to say "cash only" honestly, and to
   * offer the card terminal when the location has one.
   */
  async policyForPos(user: AuthUser, merchantId: string, query: PosCheckoutPolicyQuery) {
    await this.authorize(user, merchantId, query.locationId, query.operatorSessionId);
    const policy = await this.repo.policyForLocation(merchantId, query.locationId, query.currency);
    return { ok: true as const, data: policy };
  }

  private async reprice(
    client: Parameters<Parameters<IntegrityService['execute']>[1]>[0]['client'],
    cart: CheckoutCart,
    idempotencyKey: string,
  ): Promise<{
    public: TotalsConfirmation;
    lineSnapshot: CartItem[];
  } | null> {
    const fresh: Array<{ line: CheckoutCart['lines'][number]; priced: PricedSelection }> = [];
    for (const line of cart.lines) {
      const input: CartLineInput = {
        cartId: cart.id,
        locationId: cart.locationId,
        operatorSessionId: cart.operatorSessionId,
        productId: line.productId,
        variantId: line.variantId,
        modifierSelections: line.modifiers,
        quantity: line.quantity,
        courseNumber: line.courseNumber,
        note: line.note,
        expectedVersion: cart.version,
        idempotencyKey,
      };
      const priced = await this.carts.price(client, cart.merchantId, cart.locationId, input);
      if (!priced) return null;
      fresh.push({ line, priced });
    }
    const currency = fresh[0].priced.currency;
    let subtotal = 0;
    let taxTotal = 0;
    const taxGroups = new Map<number, { taxable: number; tax: number }>();
    const items: CartItem[] = fresh.map(({ line, priced }) => {
      const modifierTotal = priced.modifiers.reduce(
        (sum, modifier) => safeMoney(sum + safeMoney(modifier.priceDelta * modifier.quantity)),
        0,
      );
      const unit = safeMoney(priced.basePrice + priced.variantDelta + modifierTotal);
      const lineTotal = safeMoney(unit * line.quantity);
      const tax = Math.round(
        (lineTotal * priced.taxRateBasisPoints) / (10000 + priced.taxRateBasisPoints),
      );
      subtotal = safeMoney(subtotal + lineTotal);
      taxTotal = safeMoney(taxTotal + tax);
      const group = taxGroups.get(priced.taxRateBasisPoints) ?? { taxable: 0, tax: 0 };
      group.taxable = safeMoney(group.taxable + lineTotal);
      group.tax = safeMoney(group.tax + tax);
      taxGroups.set(priced.taxRateBasisPoints, group);
      return {
        id: line.id,
        productId: priced.productId,
        productName: priced.productName,
        saleAction: priced.saleAction,
        quantity: line.quantity,
        courseNumber: line.courseNumber,
        variant: priced.variantId
          ? {
              variantId: priced.variantId,
              name: priced.variantName!,
              attributes: priced.variantAttributes,
            }
          : null,
        modifiers: priced.modifiers.map((modifier) => ({
          modifierId: modifier.modifierId,
          groupId: modifier.groupId,
          name: modifier.name,
          quantity: modifier.quantity,
          priceDelta: { minorUnits: modifier.priceDelta, currency },
        })),
        note: line.note,
        price: {
          unitPrice: { minorUnits: unit, currency },
          lineSubtotal: { minorUnits: lineTotal, currency },
          tax: { minorUnits: tax, currency },
          lineTotal: { minorUnits: lineTotal, currency },
          taxRateBasisPoints: priced.taxRateBasisPoints,
        },
      };
    });
    const taxes: TaxBreakdown = {
      total: { minorUnits: taxTotal, currency },
      entries: [...taxGroups.entries()].map(([rateBasisPoints, value]) => ({
        rateBasisPoints,
        taxableAmount: { minorUnits: value.taxable, currency },
        taxAmount: { minorUnits: value.tax, currency },
      })),
    };
    const totals = {
      subtotal: { minorUnits: subtotal, currency },
      tax: { minorUnits: taxTotal, currency },
      discounts: { total: { minorUnits: 0, currency }, entries: [] },
      grandTotal: { minorUnits: subtotal, currency },
      businessDate: cart.businessDate,
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ cartVersion: cart.version, items, totals, taxes }))
      .digest('hex');
    const snapshotAt = new Date().toISOString();
    return {
      lineSnapshot: items,
      public: {
        cartVersion: cart.version,
        fingerprint,
        totals,
        taxes,
        discounts: totals.discounts,
        catalogVersion: fingerprint,
        pricingVersion: fingerprint,
        taxVersion: fingerprint,
        snapshotAt,
        confirmedAt: null,
      },
    };
  }

  private receipt(
    cart: CheckoutCart,
    confirmation: TotalsConfirmation,
    payments: PaymentOutcome[],
    paymentSummary: PaymentSummary,
    lineSnapshot: CartItem[],
    command: CheckoutCommand,
  ): ReceiptSnapshot {
    const now = new Date().toISOString();
    const lineDiscounts = new Map<string, number>();
    let orderDiscount = 0;
    for (const entry of confirmation.discounts.entries) {
      if (entry.lineId) {
        lineDiscounts.set(
          entry.lineId,
          (lineDiscounts.get(entry.lineId) ?? 0) + entry.amount.minorUnits,
        );
      } else {
        orderDiscount += entry.amount.minorUnits;
      }
    }
    const gross = lineSnapshot.reduce((total, item) => total + item.price.lineTotal.minorUnits, 0);
    let assignedOrderDiscount = 0;
    let assignedTip = 0;
    const tipTotal = paymentSummary.tip?.amount.minorUnits ?? 0;
    const allocate = (amount: number, weight: number): number =>
      Number((BigInt(amount) * BigInt(weight)) / BigInt(Math.max(gross, 1)));
    return {
      receiptRef: `POS-${payments[0].attempt.id}`,
      merchantId: cart.merchantId,
      locationId: cart.locationId,
      issuedAt: now,
      businessDate: cart.businessDate,
      lines: lineSnapshot.map((item, index) => {
        const finalLine = index === lineSnapshot.length - 1;
        const orderShare = finalLine
          ? orderDiscount - assignedOrderDiscount
          : allocate(orderDiscount, item.price.lineTotal.minorUnits);
        const tipShare = finalLine
          ? tipTotal - assignedTip
          : allocate(tipTotal, item.price.lineTotal.minorUnits);
        assignedOrderDiscount += orderShare;
        assignedTip += tipShare;
        return {
          lineRef: item.id,
          description: item.productName,
          quantity: item.quantity,
          unitPrice: item.price.unitPrice,
          lineTotal: item.price.lineTotal,
          variantName: item.variant?.name ?? null,
          modifiers: item.modifiers.map((modifier) => modifier.name),
          tax: item.price.tax,
          discount: {
            minorUnits: (lineDiscounts.get(item.id) ?? 0) + orderShare,
            currency: item.price.lineTotal.currency,
          },
          tip: {
            minorUnits: tipShare,
            currency: item.price.lineTotal.currency,
          },
          note: item.note,
        };
      }),
      subtotal: confirmation.totals.subtotal,
      taxTotal: confirmation.totals.tax,
      grandTotal: confirmation.totals.grandTotal,
      discountTotal: confirmation.discounts.total,
      currency: confirmation.totals.grandTotal.currency,
      version: 1,
      merchantName: cart.merchantName,
      locationName: cart.locationName,
      operatorName: cart.operatorName,
      payment: {
        method: payments[0].attempt.method,
        status: 'succeeded',
        reference: payments[0].attempt.id,
        amount: payments[0].attempt.amount,
      },
      payments: paymentSummary.tenders.map((tender) => ({
        tenderId: tender.tenderId,
        method: tender.type,
        amount: tender.applied,
        received: tender.received,
        change: tender.change,
      })),
      tip: paymentSummary.tip?.amount,
      receiptDestination: command.receiptDelivery.destination,
    };
  }

  private recoverableResult(
    confirmation: TotalsConfirmation,
    summary: PaymentSummary | null,
    policy: CheckoutPolicy,
    command: CheckoutCommand,
    code:
      | 'INSUFFICIENT_CASH'
      | 'INVALID_TENDER_AMOUNT'
      | 'REMAINING_BALANCE'
      | 'TENDER_OVERALLOCATION'
      | 'TIP_REJECTED'
      | 'DISCOUNT_REJECTED'
      | 'APPROVAL_REQUIRED'
      | 'TERMINAL_REPORTED_FAILURE'
      | 'TERMINAL_OUTCOME_UNKNOWN'
      | 'PERMISSION_REVOKED',
    correlationId: string,
    payment: PaymentOutcome | null = null,
    requiredPermission: string | null = null,
  ): CheckoutResult {
    const unknown = code === 'TERMINAL_OUTCOME_UNKNOWN';
    return {
      status: unknown ? 'payment_unknown' : 'payment_pending',
      confirmation,
      payment,
      payments: payment ? [payment] : [],
      reservation: null,
      sale: null,
      receipt: null,
      failure: {
        code,
        retryable: false,
        operatorGuidance: unknown
          ? 'verify_terminal_outcome'
          : code === 'PERMISSION_REVOKED'
            ? 'reauthenticate'
            : code === 'APPROVAL_REQUIRED'
              ? 'contact_manager'
              : 'correct_tenders',
        correlationId,
        requiredPermission:
          code === 'APPROVAL_REQUIRED'
            ? (requiredPermission ??
              (command.discountDrafts.length
                ? policy.discount.approvalPermission
                : policy.manualTerminalApprovalPermission))
            : null,
      },
      paymentSummary: summary,
      recoveryState: this.recoveryState(code),
      receiptDelivery: command.receiptDelivery,
      policy,
    };
  }

  private recoveryState(code: string | null): CheckoutResult['recoveryState'] {
    if (!code) return 'none';
    return (
      (
        {
          INSUFFICIENT_CASH: 'insufficient_cash',
          INVALID_TENDER_AMOUNT: 'invalid_amount',
          REMAINING_BALANCE: 'remaining_balance',
          TENDER_OVERALLOCATION: 'invalid_amount',
          TIP_REJECTED: 'tip_rejected',
          DISCOUNT_REJECTED: 'discount_rejected',
          APPROVAL_REQUIRED: 'approval_required',
          TERMINAL_REPORTED_FAILURE: 'terminal_reported_failure',
          TERMINAL_OUTCOME_UNKNOWN: 'terminal_outcome_unknown',
          PERMISSION_REVOKED: 'permission_revoked',
        } as const
      )[code] ?? 'checkout_conflict'
    );
  }

  private async authorize(
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const authorization = await this.repo.authorize(
      user.id,
      user.sessionId,
      user.deviceId,
      merchantId,
      locationId,
      operatorSessionId,
    );
    if (!authorization) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    return authorization;
  }
}

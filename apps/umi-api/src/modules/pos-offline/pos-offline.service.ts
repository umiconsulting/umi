import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  BeginReplayRequest,
  ConflictClassification,
  OfficialCommitResult,
  OfflineCashPolicy,
  OfflineCommand,
  OfflinePolicy,
  ReplayBatch,
  ReplayBatchResult,
  ReplayResult,
  ReconcileRequest,
  ReconciliationSummary,
  ReplayContextQuery,
} from '@umi/contract';
import {
  AssignCartTableRequest,
  Cart,
  CartLineInput,
  ClearCartRequest,
  CreateCartRequest,
  FireOrderRequest,
  OfflineCheckoutCommand,
  OfflineCommandGroupPayload,
  OfflineTableCommandPayload,
  OpenTableAccountRequest,
  PrepareSaleRequest,
  PosKitchenCommandRequest,
  RemoveCartLineRequest,
  SetCartFulfillmentRequest,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { canonicalJson } from '../integrity/canonical-json';
import { PosCheckoutService } from '../pos-checkout/pos-checkout.service';
import { PosCartService } from '../pos-cart/pos-cart.service';
import { KdsService } from '../kds/kds.service';
import { TableMapService } from '../table-map/table-map.service';
import { PosOfflineRepository } from './pos-offline.repository';

/** The live session a replay batch is submitted under. */
export type ReplayScope = {
  locationId: string;
  operatorSessionId: string;
  credentialVersion: number;
};

@Injectable()
export class PosOfflineService {
  private readonly logger = new Logger(PosOfflineService.name);

  constructor(
    private readonly repo: PosOfflineRepository,
    private readonly checkout: PosCheckoutService,
    private readonly cart: PosCartService,
    private readonly kds: KdsService,
    private readonly tables?: TableMapService,
  ) {}

  async begin(user: AuthUser, merchantId: string, dto: BeginReplayRequest) {
    const context = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      dto.credentialVersion,
    );
    const policy = await this.issuePolicy(user, merchantId, dto);
    return {
      replaySessionId: randomUUID(),
      cursor: this.cursor(
        user.deviceId!,
        dto.credentialVersion,
        context.lastAcceptedSequence,
        context.lastProcessedSequence ?? context.lastAcceptedSequence,
      ),
      policy,
    };
  }

  async issuePolicy(
    user: AuthUser,
    merchantId: string,
    query: ReplayContextQuery,
  ): Promise<OfflinePolicy> {
    const context = await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      query.credentialVersion,
    );
    const configured = await this.repo.policy(merchantId, query.locationId);
    const hasPermission =
      context.permissions.includes('*') || context.permissions.includes('offline.cash.checkout');
    const hasEntitlement = (context.entitlements ?? []).some(
      (value) => value.featureKey === 'pos.offline_cash' && value.enabled === true,
    );
    const deviceAllowed = configured?.allowedDeviceClasses.includes(context.deviceKind) ?? false;
    const enabled = Boolean(
      configured?.enabled &&
      configured.expiresAt > new Date() &&
      hasPermission &&
      hasEntitlement &&
      deviceAllowed &&
      configured.currency === context.currency,
    );
    const issuedAt = configured?.issuedAt ?? new Date();
    const cashWithoutFingerprint = {
      enabled,
      version: configured?.version ?? 'default-deny',
      issuedAt: issuedAt.toISOString(),
      expiresAt: (configured?.expiresAt ?? issuedAt).toISOString(),
      maxPolicyAgeSeconds: configured?.maxPolicyAgeSeconds ?? 60,
      merchantId,
      locationId: query.locationId,
      deviceId: user.deviceId!,
      deviceCredentialVersion: query.credentialVersion,
      currency: configured?.currency ?? context.currency,
      requiredPermission: 'offline.cash.checkout' as const,
      requiredEntitlement: 'pos.offline_cash' as const,
      managerApprovalThresholdMinorUnits:
        configured?.managerApprovalThresholdMinorUnits === null ||
        configured?.managerApprovalThresholdMinorUnits === undefined
          ? null
          : Number(configured.managerApprovalThresholdMinorUnits),
      allowedDeviceClasses: configured?.allowedDeviceClasses ?? [],
      limits: {
        maxSingleSaleMinorUnits: Number(configured?.maxSingleSaleMinorUnits ?? 1),
        maxAccumulatedMinorUnits: Number(configured?.maxAccumulatedMinorUnits ?? 1),
        maxOfflineSaleCount: configured?.maxOfflineSaleCount ?? 1,
        maxActiveQueueDepth: configured?.maxActiveQueueDepth ?? 1,
        maxCommandAgeSeconds: configured?.maxCommandAgeSeconds ?? 60,
        maxCatalogAgeSeconds: configured?.maxCatalogAgeSeconds ?? 60,
        maxPricingAgeSeconds: configured?.maxPricingAgeSeconds ?? 60,
        maxTaxAgeSeconds: configured?.maxTaxAgeSeconds ?? 60,
      },
      correlationId: configured?.id ?? randomUUID(),
    };
    const cash: OfflineCashPolicy = {
      ...cashWithoutFingerprint,
      fingerprint: createHash('sha256').update(canonicalJson(cashWithoutFingerprint)).digest('hex'),
    };
    const canWriteCart =
      context.permissions.includes('*') || context.permissions.includes('cart.write');
    const canFireOrder =
      context.permissions.includes('*') || context.permissions.includes('order.fire');
    const canPrepareKitchen =
      context.permissions.includes('*') || context.permissions.includes('kitchen.prepare');
    const canMoveTables =
      context.permissions.includes('*') || context.permissions.includes('sale.lifecycle');
    const orderCommandTypes = canWriteCart
      ? ([
          'pos.cart.open',
          'pos.cart.line.add',
          'pos.cart.line.update',
          'pos.cart.line.remove',
          'pos.cart.clear',
          'pos.cart.prepare',
          'pos.cart.fulfillment.set',
          'pos.cart.table.set',
        ] as const)
      : [];
    return {
      cash,
      allowedCommandTypes: [
        'operational.ack',
        ...(enabled ? (['pos.checkout.cash'] as const) : []),
        ...orderCommandTypes,
        ...(canWriteCart && canFireOrder ? (['pos.cart.fire'] as const) : []),
        ...(canPrepareKitchen ? (['pos.kds.command'] as const) : []),
        ...(canMoveTables ? (['pos.table.command'] as const) : []),
        ...(canWriteCart ? (['pos.command.group'] as const) : []),
      ],
      maxBatchSize: 20,
      webSensitiveJournalEnabled: false,
    };
  }

  /**
   * Replay a batch under the session that is open *now*.
   *
   * The commands carry the operator session that wrote them, and that is the
   * right thing for attribution: the sale belongs to whoever took it. It is the
   * wrong thing for authorization. A till that locked, restarted, or changed
   * shifts between the sale and the network coming back has a dead session id
   * inside the journal, so authorizing against it refused every sale taken
   * before the lock — silently, forever, with `DEVICE_REVOKED`. The scope is
   * therefore the submitting session (the same one `begin` and `reconcile`
   * use), and the command's own session stays exactly where it was: in the
   * record of who rang it up.
   */
  async batch(
    user: AuthUser,
    merchantId: string,
    batch: ReplayBatch,
    // Defaults to the commands' own scope so internal callers keep working; the
    // HTTP route always passes the live session it read from the query.
    scope: ReplayScope = {
      locationId: batch.commands[0].locationId,
      operatorSessionId: batch.commands[0].operatorSessionId,
      credentialVersion: batch.commands[0].deviceCredentialVersion,
    },
  ): Promise<ReplayBatchResult> {
    const first = batch.commands[0];
    const release = await this.repo.acquireReplayLock(
      first.deviceId,
      first.deviceCredentialVersion,
    );
    try {
      return await this.batchLocked(user, merchantId, batch, scope);
    } finally {
      await release();
    }
  }

  private async batchLocked(
    user: AuthUser,
    merchantId: string,
    batch: ReplayBatch,
    scope: ReplayScope,
  ): Promise<ReplayBatchResult> {
    const first = batch.commands[0];
    const replayContext = await this.authorize(
      user,
      merchantId,
      scope.locationId,
      scope.operatorSessionId,
      scope.credentialVersion,
    );
    const sorted = [...batch.commands].sort((a, b) => a.deviceSequence - b.deviceSequence);
    if (
      sorted.some(
        (command, index) =>
          command.merchantId !== merchantId ||
          command.deviceId !== user.deviceId ||
          command.locationId !== scope.locationId ||
          command.deviceCredentialVersion !== scope.credentialVersion ||
          command.deviceSequence !== sorted[0].deviceSequence + index,
      )
    ) {
      throw new ForbiddenException({ code: 'REPLAY_SCOPE_INVALID' });
    }
    const policy = await this.issuePolicy(user, merchantId, {
      locationId: scope.locationId,
      operatorSessionId: scope.operatorSessionId,
      credentialVersion: scope.credentialVersion,
    });
    const results = [];
    let stopped = false;
    let lastAccepted = replayContext.lastAcceptedSequence;
    let lastProcessed = replayContext.lastProcessedSequence ?? replayContext.lastAcceptedSequence;
    let expectedSequence = lastProcessed + 1;
    let batchCashMinorUnits = 0;
    let batchCashCount = 0;
    const cartAliases = new Map<string, string>();
    const exposureByPolicy = new Map<string, { count: number; amount: number }>();
    const refuse = async (
      command: OfflineCommand,
      classification: ConflictClassification,
      guidanceCode: string = classification,
    ): Promise<ReplayResult> => {
      const streamKey = this.streamKey(command);
      return streamKey && this.repo.recordStreamConflict
        ? this.repo.recordStreamConflict(command, classification, streamKey, guidanceCode)
        : this.repo.recordConflict(command, classification, true, guidanceCode);
    };
    const refuseAndContinue = async (
      command: OfflineCommand,
      classification: ConflictClassification,
      guidanceCode: string = classification,
    ): Promise<boolean> => {
      const result = await refuse(command, classification, guidanceCode);
      results.push(result);
      if (result.failure?.blocksFollowing) {
        stopped = true;
        return false;
      }
      expectedSequence = Math.max(expectedSequence, command.deviceSequence + 1);
      lastProcessed = Math.max(lastProcessed, command.deviceSequence);
      return true;
    };
    for (const command of sorted) {
      try {
        const { fingerprint, ...unsignedCommand } = command;
        const expectedFingerprint = createHash('sha256')
          .update(canonicalJson(unsignedCommand))
          .digest('hex');
        if (expectedFingerprint !== fingerprint) {
          results.push(await this.repo.recordConflict(command, 'fingerprint_mismatch', true));
          stopped = true;
          break;
        }
        if (command.hubOwned) {
          results.push(
            await this.repo.recordConflict(
              command,
              'unsupported_offline_command',
              true,
              'hub_owned_command_cannot_replay_to_cloud',
            ),
          );
          stopped = true;
          break;
        }
        const streamKey = this.streamKey(command);
        if (command.deviceSequence < expectedSequence) {
          const retryResolved =
            (await this.repo.hasResolvedConflict?.(
              merchantId,
              command.locationId,
              command.deviceId,
              command.deviceCredentialVersion,
              command.commandId,
            )) ?? false;
          if (!retryResolved) {
            const existing = await this.repo.commandResult(
              merchantId,
              command.locationId,
              command.deviceId,
              command.deviceCredentialVersion,
              command.commandId,
            );
            if (!existing) {
              results.push(await this.repo.recordConflict(command, 'sequence_behind', true));
              stopped = true;
              break;
            }
            const duplicate =
              existing.status === 'accepted'
                ? { ...existing, status: 'duplicate' as const }
                : existing;
            results.push(duplicate);
            if (duplicate.failure?.blocksFollowing) {
              stopped = true;
              break;
            }
            continue;
          }
        }
        if (command.deviceSequence > expectedSequence) {
          results.push(await this.repo.recordConflict(command, 'sequence_gap', true));
          stopped = true;
          break;
        }
        if (!policy.allowedCommandTypes.includes(command.commandType)) {
          results.push(
            await this.repo.recordConflict(command, 'unsupported_offline_command', true),
          );
          stopped = true;
          break;
        }
        if (
          streamKey &&
          (await this.repo.hasOpenStreamConflict?.(
            merchantId,
            command.locationId,
            command.deviceId,
            command.deviceCredentialVersion,
            streamKey,
          )) === true
        ) {
          results.push(
            await this.repo.recordStreamConflict(
              command,
              'stream_blocked',
              streamKey,
              'earlier_account_command_needs_action',
              true,
            ),
          );
          expectedSequence = Math.max(expectedSequence, command.deviceSequence + 1);
          lastProcessed = Math.max(lastProcessed, command.deviceSequence);
          continue;
        }
        let officialCommit: OfficialCommitResult | null = null;
        let appliedCartId: string | null = null;
        if (command.commandType === 'pos.kds.command') {
          const raw: Record<string, unknown> = command.payload;
          const actorDeviceId = raw.actorDeviceId;
          const sourceReference =
            typeof raw.sourceReference === 'string' ? raw.sourceReference : null;
          const lineMap = this.replayLineMap(raw.lineMap);
          const payload: Record<string, unknown> = { ...raw };
          delete payload.actorDeviceId;
          delete payload.sourceReference;
          delete payload.hubReceivedAt;
          delete payload.lineMap;
          const parsed = PosKitchenCommandRequest.safeParse(payload);
          const validationGuidance =
            typeof actorDeviceId !== 'string'
              ? 'invalid_actor_device'
              : !parsed.success
                ? `invalid_payload:${parsed.error.issues
                    .slice(0, 3)
                    .map((issue) => `${issue.path.join('.')}:${issue.code}`)
                    .join('|')}`
                : parsed.data.locationId !== command.locationId
                  ? 'location_mismatch'
                  : null;
          if (validationGuidance != null) {
            if (!(await refuseAndContinue(command, 'server_validation_failed', validationGuidance)))
              break;
            continue;
          }
          try {
            await this.kds.commandForReplay(
              user,
              merchantId,
              parsed.data!,
              actorDeviceId as string,
              replayContext.permissions,
              sourceReference,
              lineMap,
            );
          } catch (error) {
            const classification = this.kitchenRefusalClassification(error);
            if (!classification) throw error;
            if (
              !(await refuseAndContinue(
                command,
                classification,
                `kitchen_refusal:${this.exceptionCode(error)}`,
              ))
            )
              break;
            continue;
          }
        } else if (command.commandType === 'pos.table.command') {
          const envelope = OfflineTableCommandPayload.safeParse(command.payload);
          if (!envelope.success) {
            if (
              !(await refuseAndContinue(
                command,
                'server_validation_failed',
                'offline_table_payload_invalid',
              ))
            )
              break;
            continue;
          }
          try {
            if (!this.tables) throw new ConflictException({ code: 'CONFLICT' });
            await this.tables.replayCommand(user, merchantId, {
              action: envelope.data.action,
              request: {
                ...envelope.data.request,
                operatorSessionId: scope.operatorSessionId,
              },
            });
          } catch (error) {
            const classification = this.checkoutRefusalClassification(error);
            if (!classification) throw error;
            if (
              !(await refuseAndContinue(
                command,
                classification,
                `table_refusal:${this.exceptionCode(error)}`,
              ))
            )
              break;
            continue;
          }
        } else if (command.commandType === 'pos.command.group') {
          const group = OfflineCommandGroupPayload.safeParse(command.payload);
          if (
            !group.success ||
            group.data.effects.length !== 1 ||
            group.data.groupId !== command.idempotencyKey
          ) {
            if (
              !(await refuseAndContinue(
                command,
                'server_validation_failed',
                'offline_command_group_invalid',
              ))
            )
              break;
            continue;
          }
          const effect = group.data.effects[0];
          if (effect.type !== 'open_table_account') {
            if (
              !(await refuseAndContinue(
                command,
                'unsupported_offline_command',
                'offline_command_group_unsupported',
              ))
            )
              break;
            continue;
          }
          const tableRequest = OpenTableAccountRequest.safeParse({
            locationId: command.locationId,
            operatorSessionId: scope.operatorSessionId,
            tableId: effect.tableId,
            partySize: effect.partySize ?? undefined,
            expectedVersion: effect.expectedVersion ?? undefined,
            idempotencyKey: command.idempotencyKey,
          });
          if (!tableRequest.success) {
            if (
              !(await refuseAndContinue(
                command,
                'server_validation_failed',
                'offline_command_group_invalid',
              ))
            )
              break;
            continue;
          }
          try {
            const opened = await this.cart.openTable(user, merchantId, tableRequest.data);
            appliedCartId = opened.id;
            cartAliases.set(effect.provisionalCartId, opened.id);
          } catch (error) {
            const classification = this.checkoutRefusalClassification(error);
            if (!classification) throw error;
            if (!(await refuseAndContinue(command, classification))) break;
            continue;
          }
        } else if (this.isOrderCommand(command.commandType)) {
          try {
            const applied = await this.applyOrderCommand(
              user,
              merchantId,
              command,
              cartAliases,
              scope,
            );
            if (!applied.applied) {
              if (!(await refuseAndContinue(command, 'server_validation_failed'))) break;
              continue;
            }
            appliedCartId = applied.cartId ?? null;
          } catch (error) {
            const classification = this.checkoutRefusalClassification(error);
            if (!classification) throw error;
            if (!(await refuseAndContinue(command, classification))) break;
            continue;
          }
        } else if (command.commandType === 'pos.checkout.cash') {
          const parsed = OfflineCheckoutCommand.safeParse(command.payload);
          if (!parsed.success || !command.provisionalId) {
            if (!(await refuseAndContinue(command, 'server_validation_failed'))) break;
            continue;
          }
          let exposure = exposureByPolicy.get(parsed.data.policyFingerprint);
          if (!exposure) {
            exposure = await this.repo.cashExposure(
              merchantId,
              command.locationId,
              command.deviceId,
              parsed.data.policyFingerprint,
            );
            exposureByPolicy.set(parsed.data.policyFingerprint, exposure);
          }
          if (
            !policy.cash.enabled ||
            policy.cash.version !== parsed.data.policyVersion ||
            policy.cash.fingerprint !== parsed.data.policyFingerprint ||
            new Date(policy.cash.expiresAt) <= new Date()
          ) {
            const conflict = await this.repo.recordConflict(command, 'policy_changed', true);
            results.push(conflict);
            stopped = true;
            break;
          }
          const snapshot = parsed.data.snapshot;
          const trustedCart = Cart.safeParse(
            this.normalizeSnapshotTimestamps(snapshot.cartSnapshot),
          );
          /*
           * A cart opened offline has a till-side id; the server mints its own and
           * the alias only lives for the batch that created it. A checkout that
           * arrives in a later batch — the ordinary case when a sale is larger
           * than one batch, or when the first batch was retried — used to die here
           * as `CART_NOT_FOUND` and never reach the operator. Same fallback the
           * cart commands beside it already use: the session's active cart is the
           * cart. The preview below re-prices it and refuses on any difference, so
           * attaching to the wrong cart is a conflict to report, never a wrong
           * charge.
           */
          let currentCart;
          try {
            currentCart = await this.cart.readAccount(
              user,
              merchantId,
              appliedCartId ??
                (await this.repo.provisionalCartId?.(
                  merchantId,
                  command.locationId,
                  snapshot.checkoutCommand.cartId,
                )) ??
                snapshot.checkoutCommand.cartId,
              command.locationId,
              command.operatorSessionId,
            );
          } catch (error) {
            if (!(error instanceof NotFoundException)) throw error;
            currentCart = await this.cart.read(
              user,
              merchantId,
              command.locationId,
              command.operatorSessionId,
            );
          }
          let checkoutCommand = {
            ...snapshot.checkoutCommand,
            cartId: currentCart.id,
            // The checkout contract names this `expectedCartVersion`. Setting
            // `expectedVersion` here was silently ignored by the schema, so the
            // till's own (offline, stale) version was compared and every replayed
            // checkout came back `aggregate_version_conflict`.
            expectedCartVersion: currentCart.version,
          };
          const createdAt = new Date(command.createdAt);
          const catalogAt = new Date(snapshot.catalogSnapshotAt);
          const pricingAt = new Date(snapshot.pricingSnapshotAt);
          const taxAt = new Date(snapshot.taxSnapshotAt);
          const invalidSnapshot =
            !trustedCart.success ||
            snapshot.checkoutCommand.locationId !== command.locationId ||
            snapshot.checkoutCommand.operatorSessionId !== command.operatorSessionId ||
            snapshot.checkoutCommand.paymentMethod !== 'cash' ||
            snapshot.currency !== policy.cash.currency ||
            snapshot.amountDueMinorUnits !== snapshot.totals.totals.grandTotal.minorUnits ||
            snapshot.currency !== snapshot.totals.totals.grandTotal.currency ||
            snapshot.amountReceivedMinorUnits < snapshot.amountDueMinorUnits ||
            createdAt.getTime() - catalogAt.getTime() >
              policy.cash.limits.maxCatalogAgeSeconds * 1000 ||
            createdAt.getTime() - pricingAt.getTime() >
              policy.cash.limits.maxPricingAgeSeconds * 1000 ||
            createdAt.getTime() - taxAt.getTime() > policy.cash.limits.maxTaxAgeSeconds * 1000 ||
            [createdAt, catalogAt, pricingAt, taxAt].some((value) => Number.isNaN(value.getTime()));
          if (invalidSnapshot) {
            this.logger.warn(
              'offline_checkout_snapshot_invalid ' +
                JSON.stringify(
                  trustedCart.success
                    ? []
                    : trustedCart.error.issues.map((issue) => ({
                        path: issue.path.join('.'),
                        code: issue.code,
                      })),
                ),
            );
            if (!(await refuseAndContinue(command, 'server_validation_failed'))) break;
            continue;
          }
          if (Date.now() - createdAt.getTime() > policy.cash.limits.maxCommandAgeSeconds * 1000) {
            if (!(await refuseAndContinue(command, 'command_expired'))) break;
            continue;
          }
          if (!trustedCart.success) {
            if (!(await refuseAndContinue(command, 'server_validation_failed'))) break;
            continue;
          }
          /*
           * This preview is the server's independent price. It no longer decides
           * whether the sale lands: the customer already paid the till's total.
           * Its totals become the divergence record beside the committed sale.
           */
          let preview;
          try {
            preview = await this.checkout.checkout(user, merchantId, {
              ...checkoutCommand,
              commandId: randomUUID(),
              totalsFingerprint: null,
              idempotencyKey: randomUUID(),
            });
          } catch (error) {
            const classification = this.checkoutRefusalClassification(error);
            if (!classification) throw error;
            if (!(await refuseAndContinue(command, classification))) break;
            continue;
          }
          const serverAmount = preview.confirmation.totals.grandTotal.minorUnits;
          const serverCurrency = preview.confirmation.totals.grandTotal.currency;
          const chargedAmount = snapshot.amountDueMinorUnits;
          checkoutCommand = {
            ...checkoutCommand,
            totalsFingerprint: snapshot.totals.fingerprint,
          };
          batchCashMinorUnits += chargedAmount;
          batchCashCount += 1;
          const repriced = serverAmount !== chargedAmount || serverCurrency !== snapshot.currency;
          const overLimit =
            chargedAmount > policy.cash.limits.maxSingleSaleMinorUnits ||
            exposure.amount + batchCashMinorUnits > policy.cash.limits.maxAccumulatedMinorUnits ||
            exposure.count + batchCashCount > policy.cash.limits.maxOfflineSaleCount;
          if (overLimit) {
            this.logger.warn('offline_checkout_limit_exceeded');
            if (!(await refuseAndContinue(command, 'offline_limit_exceeded'))) break;
            continue;
          }
          /*
           * A cart that moved under a queued sale is a NORMAL offline outcome, not an
           * exception: the till was away, the cart advanced, and this command can never
           * land. `checkout()` reports it as a typed `ConflictException`, and letting that
           * escape used to leave `batchLocked` as an unhandled 409 with NO
           * `offline_replay_conflict` row — so the recovery centre, which is the one place
           * an operator is told what happened to a queued sale, showed nothing at all.
           * It is journalled like every other refusal now. Anything that is not a typed
           * checkout refusal is still allowed to escape: a bug here must not be recorded
           * as an operator's problem.
           */
          let checkout;
          try {
            checkout = await this.checkout.checkout(user, merchantId, checkoutCommand, {
              trustedConfirmation: snapshot.totals,
              trustedLineSnapshot: trustedCart.data.items,
            });
          } catch (error) {
            // The commit can refuse for the same reasons the preview can; the same rule
            // applies, and anything that is not a typed refusal still escapes.
            const classification = this.checkoutRefusalClassification(error);
            if (!classification) throw error;
            if (!(await refuseAndContinue(command, classification))) break;
            continue;
          }
          if (
            checkout.status !== 'completed' ||
            !checkout.sale ||
            !checkout.receipt ||
            !checkout.payment
          ) {
            this.logger.warn(
              `offline_checkout_not_completed status=${checkout.status} ` +
                `failure=${checkout.failure?.code ?? 'none'}`,
            );
            const classification =
              checkout.status === 'payment_unknown'
                ? 'ambiguous_payment_requires_query'
                : 'server_validation_failed';
            if (!(await refuseAndContinue(command, classification))) break;
            continue;
          }
          if (
            checkout.confirmation.totals.grandTotal.minorUnits !== chargedAmount ||
            checkout.confirmation.totals.grandTotal.currency !== snapshot.currency
          ) {
            if (!(await refuseAndContinue(command, 'server_validation_failed'))) break;
            continue;
          }
          officialCommit = {
            provisionalSaleId: normalizeProvisionalId(command.provisionalId)!,
            officialSaleId: checkout.sale.id,
            officialReceiptId: checkout.sale.receiptId,
            officialReceiptNumber: checkout.receipt.receiptRef,
            committedTotals: checkout.confirmation,
            businessDate: checkout.receipt.businessDate,
            acceptedAt: checkout.sale.committedAt,
            paymentSummary: checkout.payment,
            reconciliationReference: randomUUID(),
            ...(repriced
              ? {
                  divergence: {
                    serverTotals: preview.confirmation.totals,
                    deltaMinorUnits: chargedAmount - serverAmount,
                  },
                }
              : {}),
          };
        }
        const result = await this.repo.replay(
          command,
          officialCommit,
          appliedCartId,
          scope.operatorSessionId,
          streamKey,
        );
        results.push(result);
        if (result.status === 'accepted' || result.status === 'duplicate') {
          lastAccepted = Math.max(lastAccepted, command.deviceSequence);
        }
        if (result.status !== 'rejected') {
          lastProcessed = Math.max(lastProcessed, command.deviceSequence);
          expectedSequence = Math.max(expectedSequence, command.deviceSequence + 1);
        }
        if (result.failure?.blocksFollowing) {
          stopped = true;
          break;
        }
      } catch (error) {
        // A refusal of ONE command must not fail the whole batch. A 4xx from
        // the cart or kitchen service names a state the operator can review,
        // so it becomes a conflict result for this command and the cursor
        // moves past it. A 5xx may be transient: let the transport report it
        // so the till keeps the command and retries later.
        if (error instanceof HttpException) {
          const status = error.getStatus();
          if (status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429) {
            const body = error.getResponse();
            const code =
              typeof body === 'object' && body !== null && 'code' in body
                ? String((body as { code: unknown }).code)
                : `http_${status}`;
            if (
              !(await refuseAndContinue(
                command,
                'server_validation_failed',
                `server_refused:${code}`,
              ))
            )
              break;
            continue;
          }
        }
        throw error;
      }
    }
    return {
      replaySessionId: batch.replaySessionId,
      results,
      cursor: this.cursor(
        user.deviceId!,
        first.deviceCredentialVersion,
        lastAccepted,
        lastProcessed,
      ),
      stopped,
    };
  }

  async reconcile(
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    credentialVersion: number,
    dto: ReconcileRequest,
  ): Promise<ReconciliationSummary> {
    const context = await this.authorize(
      user,
      merchantId,
      locationId,
      operatorSessionId,
      credentialVersion,
    );
    const missing: number[] = [];
    const lastProcessed = context.lastProcessedSequence ?? context.lastAcceptedSequence;
    for (
      let value = lastProcessed + 1;
      value <= dto.localLastAllocatedSequence && missing.length < 100;
      value++
    )
      missing.push(value);
    const [conflicts, provisionalMappings] = await Promise.all([
      this.repo.conflicts(merchantId, locationId, user.deviceId!, credentialVersion),
      this.repo.mappings(merchantId, locationId, user.deviceId!),
    ]);
    const summary = {
      deviceId: user.deviceId!,
      credentialVersion,
      localLastAllocatedSequence: dto.localLastAllocatedSequence,
      localLastAcknowledgedSequence: dto.localLastAcknowledgedSequence,
      serverLastAcceptedSequence: context.lastAcceptedSequence,
      serverLastProcessedSequence: lastProcessed,
      missingSequences: missing,
      duplicates: [],
      conflicts,
      provisionalMappings,
      reconciliationRequired:
        missing.length > 0 ||
        lastProcessed > dto.localLastAcknowledgedSequence ||
        dto.localLastAcknowledgedSequence > lastProcessed ||
        conflicts.length > 0,
    };
    const reconciliationId = await this.repo.persistReconciliation({
      merchantId,
      locationId,
      deviceId: user.deviceId!,
      credentialVersion,
      summary,
    });
    return { reconciliationId, ...summary };
  }

  async readCursor(user: AuthUser, merchantId: string, query: ReplayContextQuery) {
    const context = await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      query.credentialVersion,
    );
    return this.cursor(
      user.deviceId!,
      query.credentialVersion,
      context.lastAcceptedSequence,
      context.lastProcessedSequence ?? context.lastAcceptedSequence,
    );
  }

  async commandResult(
    user: AuthUser,
    merchantId: string,
    query: ReplayContextQuery,
    commandId: string,
  ) {
    await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      query.credentialVersion,
    );
    const result = await this.repo.commandResult(
      merchantId,
      query.locationId,
      user.deviceId!,
      query.credentialVersion,
      commandId,
    );
    if (!result) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return result;
  }

  async diagnostics(user: AuthUser, merchantId: string, query: ReplayContextQuery) {
    await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      query.credentialVersion,
    );
    const value = await this.repo.diagnostics(merchantId, user.deviceId!, query.credentialVersion);
    const [conflicts, audit] = await Promise.all([
      this.repo.conflicts(merchantId, query.locationId, user.deviceId!, query.credentialVersion),
      this.repo.audit(merchantId, query.locationId, user.deviceId!),
    ]);
    return {
      contractVersion: '1.6.0',
      serverLastAcceptedSequence: Number(value.lastAcceptedSequence),
      acceptedCount: Number(value.acceptedCount),
      conflictCount: conflicts.length,
      lastReplayAt: value.lastReplayAt?.toISOString() ?? null,
      lastSafeErrorCategory: conflicts[0]?.failure?.classification ?? null,
      // The queue is the work the server processed but did not accept. A
      // sequence number minus a lifetime count is not a queue: one discarded
      // command made that subtraction report work that no longer exists.
      queueDepth: Math.max(
        0,
        Number(value.lastProcessedSequence) - Number(value.lastAcceptedSequence),
      ),
      unresolvedCount: conflicts.length,
      audit,
    };
  }

  async acknowledge(
    user: AuthUser,
    merchantId: string,
    query: ReplayContextQuery,
    reconciliationId: string,
  ) {
    await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      query.credentialVersion,
    );
    return {
      acknowledged: await this.repo.acknowledge(merchantId, user.deviceId!, reconciliationId),
    };
  }

  async conflicts(user: AuthUser, merchantId: string, query: ReplayContextQuery) {
    await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      query.credentialVersion,
    );
    return {
      items: await this.repo.conflicts(
        merchantId,
        query.locationId,
        user.deviceId!,
        query.credentialVersion,
      ),
    };
  }

  async resolveConflict(
    user: AuthUser,
    merchantId: string,
    query: ReplayContextQuery,
    commandId: string,
  ) {
    await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      query.credentialVersion,
    );
    const result = await this.repo.resolveConflict(
      merchantId,
      query.locationId,
      user.deviceId!,
      query.credentialVersion,
      commandId,
    );
    if (!result) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    if (!result.resolved) {
      throw new ConflictException({ code: 'CONFLICT_NOT_RESOLVABLE' });
    }
    return {
      resolved: true,
      commandId,
      deviceSequence: result.deviceSequence,
      nextAcceptedSequence: result.nextAcceptedSequence,
    };
  }

  /**
   * How a typed checkout refusal becomes a conflict classification, or `null` when the
   * error is not one — in which case the caller must let it escape rather than record it
   * as an operator's problem.
   *
   * `OPTIMISTIC_VERSION_CONFLICT` is the stale-cart case and has an exact name in the
   * vocabulary: the aggregate the command was built against moved. Everything else the
   * checkout refuses over is a validation failure from the till's point of view.
   */
  private checkoutRefusalClassification(error: unknown): ConflictClassification | null {
    if (!(error instanceof ConflictException)) return null;
    const body: unknown = error.getResponse();
    const code =
      typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : '';
    if (code === 'OPTIMISTIC_VERSION_CONFLICT' || code === 'CART_VERSION_CONFLICT') {
      return 'aggregate_version_conflict';
    }
    if (code === 'CHECKOUT_CART_CHANGED') return 'cart_mismatch';
    // A table another till took while this one was offline is the one refusal a
    // dine-in operator can act on by choosing another table. Reporting it as
    // "validation failed" sent them to look at the wrong thing.
    if (
      code === 'CART_TABLE_ACCOUNT_EXISTS' ||
      code === 'CART_ALREADY_ASSIGNED' ||
      code === 'TABLE_NOT_IN_PLAN' ||
      code === 'TABLE_UNAVAILABLE' ||
      code === 'TABLE_OCCUPIED' ||
      code === 'TABLE_ALREADY_OCCUPIED' ||
      code === 'TABLE_NOT_OCCUPIED' ||
      code === 'TABLE_CAPACITY_EXCEEDED' ||
      code === 'CART_ACCOUNT_BUSY'
    ) {
      return 'table_unavailable';
    }
    this.logger.warn(`offline_checkout_refused code=${code || 'unknown'}`);
    return 'server_validation_failed';
  }

  private kitchenRefusalClassification(error: unknown): ConflictClassification | null {
    if (!(error instanceof ConflictException) && !(error instanceof ForbiddenException)) {
      return null;
    }
    const body: unknown = error.getResponse();
    const code =
      typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : '';
    if (code === 'DEVICE_REVOKED') return 'device_revoked';
    if (code === 'KITCHEN_VERSION_CONFLICT' || code === 'OPTIMISTIC_VERSION_CONFLICT') {
      return 'aggregate_version_conflict';
    }
    return 'server_validation_failed';
  }

  /**
   * The display order of each local cart line in the ticket the LAN host
   * showed the cook. It travels only on replayed KDS commands; the wire
   * contract of the live POS command does not carry it.
   */
  private replayLineMap(value: unknown): Record<string, number> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const map: Record<string, number> = {};
    for (const [itemId, order] of Object.entries(value)) {
      if (typeof order !== 'number' || !Number.isInteger(order) || order < 0) return null;
      map[itemId] = order;
    }
    return Object.keys(map).length > 0 ? map : null;
  }

  private exceptionCode(error: unknown): string {
    if (!(error instanceof ConflictException) && !(error instanceof ForbiddenException)) {
      return 'unknown';
    }
    const body: unknown = error.getResponse();
    return typeof body === 'object' && body !== null && 'code' in body
      ? String(body.code)
      : 'unknown';
  }

  /**
   * Flutter receives some server timestamps as PostgreSQL text and writes that
   * text into the offline cart snapshot. The contract requires ISO-8601. Shape
   * the two known cart timestamp fields without changing the values.
   */
  private normalizeSnapshotTimestamps(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeSnapshotTimestamps(item));
    }
    if (value === null || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => {
        if ((key === 'createdAt' || key === 'updatedAt') && typeof entry === 'string') {
          return [key, this.isoTimestamp(entry)];
        }
        return [key, this.normalizeSnapshotTimestamps(entry)];
      }),
    );
  }

  private isoTimestamp(value: string): string {
    if (/T/.test(value)) return value;
    const match =
      /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/.exec(value);
    if (!match) return value;
    return `${match[1]}T${match[2]}${match[3]}:${match[4] ?? '00'}`;
  }

  private isOrderCommand(commandType: string): boolean {
    return commandType.startsWith('pos.cart.');
  }

  /**
   * The account or table lane that one command can change.
   *
   * A refusal blocks this lane only. Commands for other lanes keep the same
   * device order and can continue. A command with no shared lane keeps the
   * global stop rule.
   */
  private streamKey(command: OfflineCommand): string | null {
    const payload: Record<string, unknown> = command.payload;
    if (command.commandType === 'pos.command.group') {
      const group = OfflineCommandGroupPayload.safeParse(payload);
      if (!group.success) return null;
      return (
        group.data.aggregateKeys.find((key) => key.startsWith('account:')) ??
        `group:${group.data.groupId}`
      );
    }
    if (command.commandType === 'pos.checkout.cash') {
      const snapshot = payload.snapshot;
      if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
        return null;
      }
      const checkoutCommand = (snapshot as Record<string, unknown>).checkoutCommand;
      if (
        typeof checkoutCommand !== 'object' ||
        checkoutCommand === null ||
        Array.isArray(checkoutCommand)
      ) {
        return null;
      }
      const cartId = (checkoutCommand as Record<string, unknown>).cartId;
      return typeof cartId === 'string' ? `account:${cartId}` : null;
    }
    if (command.commandType === 'pos.table.command') {
      const envelope = OfflineTableCommandPayload.safeParse(payload);
      if (!envelope.success) return null;
      const request = envelope.data.request;
      if (typeof request.tableId === 'string') return `table:${request.tableId}`;
      if (Array.isArray(request.tableIds)) {
        const ids = request.tableIds.filter((value): value is string => typeof value === 'string');
        if (ids.length > 0) return `table:${[...ids].sort().join(',')}`;
      }
      return null;
    }
    if (command.commandType === 'pos.kds.command') {
      return typeof payload.kitchenOrderId === 'string'
        ? `kitchen:${payload.kitchenOrderId}`
        : null;
    }
    if (this.isOrderCommand(command.commandType)) {
      return typeof payload.cartId === 'string' ? `account:${payload.cartId}` : null;
    }
    return null;
  }

  /**
   * Apply one queued order command through the same cart service a live tap uses.
   *
   * The live cart version is substituted because the device queues commands in order
   * and its copy advances with every accepted command. The server's version remains
   * the authority, and the cart service still checks the cart, lifecycle and
   * permission on every command.
   */
  private async applyOrderCommand(
    user: AuthUser,
    merchantId: string,
    command: OfflineCommand,
    cartAliases: Map<string, string>,
    scope: ReplayScope,
  ): Promise<{ applied: boolean; cartId?: string }> {
    const raw: Record<string, unknown> = command.payload;
    const provisionalCartId = raw.cartId;
    const locationId = raw.locationId;
    // The command keeps the session that wrote it for attribution. The cart
    // operation must authorize with the session that is open now; using the
    // journalled session made every replay after a lock/restart end in 401.
    const operatorSessionId = scope.operatorSessionId;
    if (
      typeof provisionalCartId !== 'string' ||
      typeof locationId !== 'string' ||
      typeof operatorSessionId !== 'string'
    ) {
      return { applied: false };
    }
    if (command.commandType === 'pos.cart.open') {
      const requestBody: Record<string, unknown> = {
        ...raw,
        idempotencyKey: command.idempotencyKey,
        operatorSessionId,
      };
      delete requestBody.cartId;
      const parsed = CreateCartRequest.safeParse(requestBody);
      if (!parsed.success) return { applied: false };
      let cart = await this.cart.create(user, merchantId, parsed.data);
      /*
       * A journaled open is a NEW account, even though `create` prefers to
       * resume the one the operator already has open. Online, "Nueva cuenta"
       * saves the account in front of you and then opens the next one; offline
       * that save cannot be journaled, so a till that restarted mid-account
       * replays an open against a server that still holds the old cart. Adopting
       * it put the new account's lines on the old account's total, and the
       * checkout then refused the sale as `price_changed` with no way forward.
       *
       * An empty resumed cart is the same account in every way that matters, so
       * it is adopted. A cart with lines or a table is somebody's open account:
       * it is saved first, exactly as the counter would have done, and the new
       * account opens behind it.
       */
      if (cart.id !== provisionalCartId) {
        const hasContent = (cart.items?.length ?? 0) > 0 || cart.tableId != null;
        if (hasContent) {
          await this.cart.suspendAccount(user, merchantId, {
            cartId: cart.id,
            locationId: cart.locationId,
            operatorSessionId: cart.operatorSessionId,
            expectedVersion: cart.version,
            idempotencyKey: randomUUID(),
          });
          cart = await this.cart.create(user, merchantId, {
            ...parsed.data,
            idempotencyKey: randomUUID(),
          });
        }
      }
      cartAliases.set(provisionalCartId, cart.id);
      return { applied: true, cartId: cart.id };
    }
    let cartId =
      cartAliases.get(provisionalCartId) ??
      (await this.repo.provisionalCartId?.(merchantId, locationId, provisionalCartId)) ??
      provisionalCartId;
    let current;
    try {
      current = await this.cart.readAccount(
        user,
        merchantId,
        cartId,
        locationId,
        operatorSessionId,
      );
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      // A later replay batch has no in-memory alias map. The cart this
      // operator session opened is still the one active cart on the server.
      current = await this.cart.read(user, merchantId, locationId, operatorSessionId);
      cartId = current.id;
      cartAliases.set(provisionalCartId, cartId);
    }
    const withCurrentVersion = {
      ...raw,
      cartId,
      operatorSessionId,
      expectedVersion: current.version,
      idempotencyKey: command.idempotencyKey,
    };
    switch (command.commandType) {
      case 'pos.cart.line.add': {
        const parsed = CartLineInput.safeParse(withCurrentVersion);
        if (!parsed.success) return { applied: false };
        await this.cart.add(user, merchantId, parsed.data);
        return { applied: true, cartId };
      }
      case 'pos.cart.line.update': {
        const lineId = raw.lineId;
        if (typeof lineId !== 'string') return { applied: false };
        const line: Record<string, unknown> = { ...withCurrentVersion };
        delete line.lineId;
        const parsed = CartLineInput.safeParse(line);
        if (!parsed.success) return { applied: false };
        await this.cart.update(user, merchantId, lineId, parsed.data);
        return { applied: true, cartId };
      }
      case 'pos.cart.line.remove': {
        const lineId = raw.lineId;
        if (typeof lineId !== 'string') return { applied: false };
        const remove: Record<string, unknown> = { ...withCurrentVersion };
        delete remove.lineId;
        const parsed = RemoveCartLineRequest.safeParse(remove);
        if (!parsed.success) return { applied: false };
        await this.cart.remove(user, merchantId, lineId, parsed.data);
        return { applied: true, cartId };
      }
      case 'pos.cart.clear': {
        const parsed = ClearCartRequest.safeParse(withCurrentVersion);
        if (!parsed.success) return { applied: false };
        await this.cart.clear(user, merchantId, parsed.data);
        return { applied: true, cartId };
      }
      case 'pos.cart.prepare': {
        const parsed = PrepareSaleRequest.safeParse(withCurrentVersion);
        if (!parsed.success) return { applied: false };
        await this.cart.prepare(user, merchantId, parsed.data);
        return { applied: true, cartId };
      }
      case 'pos.cart.fire': {
        const parsed = FireOrderRequest.safeParse(withCurrentVersion);
        if (!parsed.success) return { applied: false };
        await this.cart.fire(user, merchantId, parsed.data);
        return { applied: true, cartId };
      }
      case 'pos.cart.fulfillment.set': {
        const parsed = SetCartFulfillmentRequest.safeParse(withCurrentVersion);
        if (!parsed.success) return { applied: false };
        await this.cart.setFulfillment(user, merchantId, parsed.data);
        return { applied: true, cartId };
      }
      case 'pos.cart.table.set': {
        // Dine-in only. The table is a server fact (two tills must not claim it),
        // so the till journals the choice and this assigns it at replay, exactly
        // as the counter would have done while connected.
        const assign: Record<string, unknown> = { ...withCurrentVersion };
        delete assign.cartId;
        const parsed = AssignCartTableRequest.safeParse(assign);
        if (!parsed.success) return { applied: false };
        try {
          await this.cart.assignAccountTable(user, merchantId, cartId, parsed.data);
        } catch (error) {
          /*
           * A retry can arrive after the assignment already happened — an
           * online attempt that recovered mid-journal, or a batch whose
           * response was lost. The cart service refuses to assign a table the
           * cart already holds, which is right for a second account and wrong
           * as a verdict on this command: the work is done, so the entry should
           * settle as accepted and stop showing a conflict badge.
           */
          if (error instanceof ConflictException) {
            const body: unknown = error.getResponse();
            const code =
              typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : '';
            if (code === 'CART_ALREADY_ASSIGNED' || code === 'CART_TABLE_ACCOUNT_EXISTS') {
              const current = await this.cart.readAccount(
                user,
                merchantId,
                cartId,
                command.locationId,
                command.operatorSessionId,
              );
              if (current.tableId === parsed.data.tableId) {
                return { applied: true, cartId };
              }
            }
          }
          throw error;
        }
        return { applied: true, cartId };
      }
      default:
        return { applied: false };
    }
  }

  private async authorize(
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    credentialVersion: number,
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    const context = await this.repo.context({
      userId: user.id,
      deviceId: user.deviceId,
      merchantId,
      locationId,
      operatorSessionId,
      credentialVersion,
    });
    if (!context || context.lifecycle !== 'active')
      throw new ForbiddenException({ code: 'DEVICE_REVOKED' });
    if (context.credentialVersion !== credentialVersion)
      throw new ForbiddenException({ code: 'DEVICE_CREDENTIAL_ROTATED' });
    if (!context.permissions.includes('*') && !context.permissions.includes('offline.replay')) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    return context;
  }

  private cursor(
    deviceId: string,
    credentialVersion: number,
    lastAcceptedSequence: number,
    lastProcessedSequence: number = lastAcceptedSequence,
  ) {
    return {
      deviceId,
      credentialVersion,
      lastAcceptedSequence,
      lastProcessedSequence,
      reconciliationRequired: false,
      updatedAt: new Date().toISOString(),
    };
  }
}

function normalizeProvisionalId(value: string | null): string | null {
  return value?.startsWith('prov-') ? value.slice('prov-'.length) : value;
}

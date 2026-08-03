import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  BeginReplayRequest,
  OfficialCommitResult,
  OfflineCashPolicy,
  OfflinePolicy,
  ReplayBatch,
  ReplayBatchResult,
  ReconcileRequest,
  ReconciliationSummary,
  ReplayContextQuery,
} from '@umi/contract';
import { OfflineCheckoutCommand } from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { canonicalJson } from '../integrity/canonical-json';
import { PosCheckoutService } from '../pos-checkout/pos-checkout.service';
import { PosOfflineRepository } from './pos-offline.repository';

@Injectable()
export class PosOfflineService {
  constructor(
    private readonly repo: PosOfflineRepository,
    private readonly checkout: PosCheckoutService,
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
      cursor: this.cursor(user.deviceId!, dto.credentialVersion, context.lastAcceptedSequence),
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
    const hasEntitlement = context.entitlements.some(
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
    return {
      cash,
      allowedCommandTypes: enabled ? ['operational.ack', 'pos.checkout.cash'] : ['operational.ack'],
      maxBatchSize: 20,
      webSensitiveJournalEnabled: false,
    };
  }

  async batch(user: AuthUser, merchantId: string, batch: ReplayBatch): Promise<ReplayBatchResult> {
    const first = batch.commands[0];
    const release = await this.repo.acquireReplayLock(
      first.deviceId,
      first.deviceCredentialVersion,
    );
    try {
      return await this.batchLocked(user, merchantId, batch);
    } finally {
      await release();
    }
  }

  private async batchLocked(
    user: AuthUser,
    merchantId: string,
    batch: ReplayBatch,
  ): Promise<ReplayBatchResult> {
    const first = batch.commands[0];
    const replayContext = await this.authorize(
      user,
      merchantId,
      first.locationId,
      first.operatorSessionId,
      first.deviceCredentialVersion,
    );
    const sorted = [...batch.commands].sort((a, b) => a.deviceSequence - b.deviceSequence);
    if (
      sorted.some(
        (command, index) =>
          command.merchantId !== merchantId ||
          command.deviceId !== user.deviceId ||
          command.locationId !== first.locationId ||
          command.operatorSessionId !== first.operatorSessionId ||
          command.deviceCredentialVersion !== first.deviceCredentialVersion ||
          command.deviceSequence !== sorted[0].deviceSequence + index,
      )
    ) {
      throw new ForbiddenException({ code: 'REPLAY_SCOPE_INVALID' });
    }
    const results = [];
    let stopped = false;
    let expectedSequence = replayContext.lastAcceptedSequence + 1;
    let batchCashMinorUnits = 0;
    let batchCashCount = 0;
    const exposureByPolicy = new Map<string, { count: number; amount: number }>();
    for (const command of sorted) {
      const { fingerprint, ...unsignedCommand } = command;
      const expectedFingerprint = createHash('sha256')
        .update(canonicalJson(unsignedCommand))
        .digest('hex');
      if (expectedFingerprint !== fingerprint) {
        results.push(await this.repo.recordConflict(command, 'fingerprint_mismatch', true));
        stopped = true;
        break;
      }
      if (command.deviceSequence < expectedSequence) {
        const duplicate = await this.repo.replay(command);
        results.push(duplicate);
        if (duplicate.failure?.blocksFollowing) {
          stopped = true;
          break;
        }
        continue;
      }
      if (command.deviceSequence > expectedSequence) {
        results.push(await this.repo.recordConflict(command, 'sequence_gap', true));
        stopped = true;
        break;
      }
      let officialCommit: OfficialCommitResult | null = null;
      if (command.commandType === 'pos.checkout.cash') {
        const parsed = OfflineCheckoutCommand.safeParse(command.payload);
        if (!parsed.success || !command.provisionalId) {
          const conflict = await this.repo.recordConflict(
            command,
            'server_validation_failed',
            true,
          );
          results.push(conflict);
          stopped = true;
          break;
        }
        const policy = await this.issuePolicy(user, merchantId, {
          locationId: command.locationId,
          operatorSessionId: command.operatorSessionId,
          credentialVersion: command.deviceCredentialVersion,
        });
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
        const createdAt = new Date(command.createdAt);
        const catalogAt = new Date(snapshot.catalogSnapshotAt);
        const pricingAt = new Date(snapshot.pricingSnapshotAt);
        const taxAt = new Date(snapshot.taxSnapshotAt);
        const invalidSnapshot =
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
          results.push(await this.repo.recordConflict(command, 'server_validation_failed', true));
          stopped = true;
          break;
        }
        if (Date.now() - createdAt.getTime() > policy.cash.limits.maxCommandAgeSeconds * 1000) {
          results.push(await this.repo.recordConflict(command, 'command_expired', true));
          stopped = true;
          break;
        }
        const preview = await this.checkout.checkout(user, merchantId, {
          ...snapshot.checkoutCommand,
          totalsFingerprint: null,
          idempotencyKey: command.idempotencyKey,
        });
        const authoritativeAmount = preview.confirmation.totals.grandTotal.minorUnits;
        const authoritativeCurrency = preview.confirmation.totals.grandTotal.currency;
        batchCashMinorUnits += authoritativeAmount;
        batchCashCount += 1;
        if (
          preview.status !== 'confirmation_required' ||
          preview.confirmation.fingerprint !== snapshot.checkoutCommand.totalsFingerprint ||
          authoritativeAmount !== snapshot.amountDueMinorUnits ||
          authoritativeCurrency !== snapshot.currency ||
          authoritativeAmount > policy.cash.limits.maxSingleSaleMinorUnits ||
          exposure.amount + batchCashMinorUnits > policy.cash.limits.maxAccumulatedMinorUnits ||
          exposure.count + batchCashCount > policy.cash.limits.maxOfflineSaleCount
        ) {
          results.push(await this.repo.recordConflict(command, 'price_changed', true));
          stopped = true;
          break;
        }
        const checkout = await this.checkout.checkout(
          user,
          merchantId,
          parsed.data.snapshot.checkoutCommand,
        );
        if (
          checkout.status !== 'completed' ||
          !checkout.sale ||
          !checkout.receipt ||
          !checkout.payment
        ) {
          const classification =
            checkout.status === 'payment_unknown'
              ? 'ambiguous_payment_requires_query'
              : 'price_changed';
          const conflict = await this.repo.recordConflict(command, classification, true);
          results.push(conflict);
          stopped = true;
          break;
        }
        officialCommit = {
          provisionalSaleId: command.provisionalId,
          officialSaleId: checkout.sale.id,
          officialReceiptId: checkout.sale.receiptId,
          officialReceiptNumber: checkout.receipt.receiptRef,
          committedTotals: checkout.confirmation,
          businessDate: checkout.receipt.businessDate,
          acceptedAt: checkout.sale.committedAt,
          paymentSummary: checkout.payment,
          reconciliationReference: randomUUID(),
        };
      }
      const result = await this.repo.replay(command, officialCommit);
      results.push(result);
      if (result.status === 'accepted' || result.status === 'duplicate') {
        expectedSequence += 1;
      }
      if (result.failure?.blocksFollowing) {
        stopped = true;
        break;
      }
    }
    const last = results
      .filter((r) => r.status === 'accepted' || r.status === 'duplicate')
      .reduce(
        (value, result) => Math.max(value, result.deviceSequence),
        sorted[0].deviceSequence - 1,
      );
    return {
      replaySessionId: batch.replaySessionId,
      results,
      cursor: this.cursor(user.deviceId!, first.deviceCredentialVersion, last),
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
    for (
      let value = context.lastAcceptedSequence + 1;
      value <= dto.localLastAllocatedSequence && missing.length < 100;
      value++
    )
      missing.push(value);
    const [conflicts, provisionalMappings] = await Promise.all([
      this.repo.conflicts(merchantId, locationId, user.deviceId!),
      this.repo.mappings(merchantId, locationId, user.deviceId!),
    ]);
    const summary = {
      deviceId: user.deviceId!,
      credentialVersion,
      localLastAllocatedSequence: dto.localLastAllocatedSequence,
      localLastAcknowledgedSequence: dto.localLastAcknowledgedSequence,
      serverLastAcceptedSequence: context.lastAcceptedSequence,
      missingSequences: missing,
      duplicates: [],
      conflicts,
      provisionalMappings,
      reconciliationRequired:
        missing.length > 0 ||
        context.lastAcceptedSequence > dto.localLastAcknowledgedSequence ||
        dto.localLastAcknowledgedSequence > context.lastAcceptedSequence ||
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
    return this.cursor(user.deviceId!, query.credentialVersion, context.lastAcceptedSequence);
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
      this.repo.conflicts(merchantId, query.locationId, user.deviceId!),
      this.repo.audit(merchantId, query.locationId, user.deviceId!),
    ]);
    return {
      contractVersion: '1.6.0',
      serverLastAcceptedSequence: Number(value.lastAcceptedSequence),
      acceptedCount: Number(value.acceptedCount),
      conflictCount: conflicts.length,
      lastReplayAt: value.lastReplayAt?.toISOString() ?? null,
      lastSafeErrorCategory: conflicts[0]?.failure?.classification ?? null,
      queueDepth: Math.max(0, Number(value.lastAcceptedSequence) - Number(value.acceptedCount)),
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
    return { items: await this.repo.conflicts(merchantId, query.locationId, user.deviceId!) };
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

  private cursor(deviceId: string, credentialVersion: number, lastAcceptedSequence: number) {
    return {
      deviceId,
      credentialVersion,
      lastAcceptedSequence,
      reconciliationRequired: false,
      updatedAt: new Date().toISOString(),
    };
  }
}

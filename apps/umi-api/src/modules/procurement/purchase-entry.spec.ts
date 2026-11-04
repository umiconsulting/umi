import { describe, expect, it } from 'vitest';
import { ProcurementService } from './procurement.service';
import type { MerchantAccess } from '../auth/auth.types';
const merchantId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const access = { merchantId, locationId, permissions: ['merchant.manage'] } as MerchantAccess;

describe('purchase private reads', () => {
  it('refuses an invalid invoice UUID before byte access', async () => {
    const service = new ProcurementService({} as never, {} as never, {} as never);
    await expect(service.supplierInvoiceArtifact(access, 'invalid')).rejects.toMatchObject({
      response: { code: 'VALIDATION_FAILED' },
    });
  });
  it('does not reveal absent or other-merchant artifacts', async () => {
    const repo = {
      supplierInvoiceArtifact: async (merchant: string) => {
        if (merchant !== merchantId) throw new Error('wrong merchant');
        return null;
      },
    };
    const service = new ProcurementService(repo as never, {} as never, {} as never);
    await expect(service.supplierInvoiceArtifact(access, locationId)).rejects.toMatchObject({
      response: { code: 'SUPPLIER_INVOICE_ARTIFACT_NOT_FOUND' },
    });
  });
  it('returns artifact bytes only in the explicit private read', async () => {
    const repo = {
      supplierInvoiceArtifact: async () => ({
        contentType: 'image/png',
        bytes: Buffer.from([137, 80, 78, 71]),
      }),
    };
    const service = new ProcurementService(repo as never, {} as never, {} as never);
    expect(await service.supplierInvoiceArtifact(access, locationId)).toMatchObject({
      contentType: 'image/png',
      dataBase64: 'iVBORw==',
    });
  });
  it('rejects a different branch before context reads', async () => {
    const service = new ProcurementService({} as never, {} as never, {} as never);
    await expect(
      service.purchaseEntryContext(access, { locationId: merchantId }),
    ).rejects.toMatchObject({ response: { error: 'location_switch_denied' } });
  });
});

import { PurchaseEntryService } from './purchase-entry.service';
import type { AuthUser } from '../auth/auth.types';
import type { PersistedDashboardAdministrativeCommandContext } from '../administrative-commands/administrative-command-context.service';
import type { RecordInventoryPurchaseRequest } from '@umi/contract';

describe('purchase write authority', () => {
  const dto: RecordInventoryPurchaseRequest = {
    commandId: merchantId,
    idempotencyKey: locationId,
    locationId,
    inventoryLocationId: locationId,
    issuedOn: '2026-11-03',
    currency: 'MXN',
    lines: [
      {
        inventoryItemId: merchantId,
        quantity: { value: 1, scale: 0, unit: 'unit' },
        unitCostMinor: 100,
      },
    ],
  };
  const user = { id: merchantId, sessionId: locationId, deviceId: null } as AuthUser;
  const writer = {
    ...access,
    membershipId: merchantId,
    permissions: ['inventory.invoice.approve'],
  };
  const context = {
    type: 'dashboard_administrative',
    actorUserId: user.id,
    membershipId: writer.membershipId,
    merchantId,
    locationId,
    sessionId: user.sessionId,
    permission: 'inventory.invoice.approve',
    operation: 'inventory.purchase.record',
    targetAggregateId: merchantId,
    commandId: dto.commandId,
    idempotencyKey: dto.idempotencyKey,
  } as PersistedDashboardAdministrativeCommandContext;
  it('refuses a capture-only actor before transaction access', async () => {
    const service = new PurchaseEntryService({} as never, {} as never);
    await expect(
      service.recordPurchase(
        user,
        { ...writer, permissions: ['inventory.invoice.capture'] },
        context,
        dto,
      ),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });
  it('refuses a context for a different branch, actor, command or merchant', async () => {
    const service = new PurchaseEntryService({} as never, {} as never);
    for (const changed of [
      { locationId: merchantId },
      { actorUserId: locationId },
      { commandId: locationId },
      { merchantId: locationId },
    ]) {
      await expect(
        service.recordPurchase(user, writer, { ...context, ...changed }, dto),
      ).rejects.toMatchObject({ response: { code: 'COMMAND_CONTEXT_NOT_ALLOWED' } });
    }
  });
});

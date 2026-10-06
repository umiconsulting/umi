import { createHash } from 'node:crypto';
import type { HardwareCommandRequest } from '@umi/contract';
import { canonicalJson } from '../integrity/canonical-json';

const excludedKeys = new Set([
  'accessToken',
  'authorizationToken',
  'customerContact',
  'giftCardCode',
  'managerPin',
  'password',
  'pin',
  'token',
  'transportCredential',
]);

export function hardwareCommandFingerprint(command: HardwareCommandRequest): string {
  const safe = omitSecrets({
    locationId: command.locationId,
    registerId: command.registerId,
    targetHardwareId: command.targetHardwareId,
    commandType: command.commandType,
    sourceAggregateType: command.sourceAggregateType,
    sourceAggregateId: command.sourceAggregateId,
    expectedConfigurationVersion: command.expectedConfigurationVersion,
    requiredCapability: requiredHardwareCapability(command.commandType) ?? 'hardware.diagnostics',
    drawer: command.drawer,
    display: command.display,
    printPayload: command.printPayload,
  });
  return createHash('sha256').update(canonicalJson(safe)).digest('hex');
}

function omitSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !excludedKeys.has(key))
      .map(([key, child]) => [key, omitSecrets(child)]),
  );
}

export function requiredHardwareCapability(
  commandType: HardwareCommandRequest['commandType'],
): string | null {
  switch (commandType) {
    case 'print_receipt':
    case 'controlled_reprint':
      return 'printer.receipt';
    case 'print_test_page':
      return 'printer.test_page';
    case 'open_drawer':
    case 'test_drawer':
      return 'drawer.open';
    case 'begin_scanner_session':
    case 'end_scanner_session':
      return 'scanner.barcode';
    case 'update_customer_display':
    case 'clear_customer_display':
      return 'customer_display.totals';
    default:
      return null;
  }
}

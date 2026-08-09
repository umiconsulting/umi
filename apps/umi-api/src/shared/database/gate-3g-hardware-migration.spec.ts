import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/40_pos_hardware_runtime.sql'),
  'utf8',
);
const pilotSql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/41_pos_hardware_pilot.sql'),
  'utf8',
);
const hardwareRepository = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-hardware/pos-hardware.repository.ts'),
  'utf8',
);
const cashRepository = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-cash/pos-cash.repository.ts'),
  'utf8',
);

describe('Gate 3G-A hardware persistence', () => {
  it('owns one scoped registry and explicit assignments', () => {
    expect(sql).toContain('create table merchant.hardware_device');
    expect(sql).toContain('create table merchant.hardware_assignment');
    expect(sql).toContain('hardware_device_physical_identity_uidx');
    expect(sql).toContain('primary_receipt_printer_uidx');
    expect(sql).toContain('hardware_capability_compatibility');
    expect(sql).toContain('configuration_version bigint not null');
  });

  it('persists immutable commands, print jobs, and diagnostics', () => {
    expect(sql).toContain('create table merchant.hardware_command');
    expect(sql).toContain('create table merchant.hardware_print_job');
    expect(sql).toContain('create table merchant.hardware_diagnostic');
    expect(sql).toContain('hardware_command_immutable');
    expect(sql).toContain('hardware_print_job_identity_uidx');
    expect(sql).toContain('unknown_outcome');
    expect(sql).toContain("when 'unknown' then 'unknown_outcome'");
  });

  it('provides scoped command and recovery functions', () => {
    expect(sql).toContain('merchant.create_hardware_command');
    expect(sql).toContain('merchant.transition_hardware_command');
    expect(sql).toContain('v_dispatch_count>=3');
    expect(sql).toContain("v_effective_failure:='terminal_hardware_failure'");
    expect(sql).toContain('foreign key(merchant_id,location_id,register_id)');
    expect(sql).toContain('foreign key(merchant_id,location_id,assigned_pos_device_id)');
    expect(sql).toContain('merchant.read_hardware_runtime');
    expect(sql).toContain('merchant.create_controlled_reprint');
    expect(sql).toContain('HARDWARE_IDEMPOTENCY_CONFLICT');
    expect(sql).toContain('HARDWARE_CASH_FACT_REQUIRED');
    expect(sql).toContain('hardware_drawer_source_once_uidx');
    expect(sql).toContain('hardware.command.execute');
    expect(sql).toContain('force row level security');
    expect(hardwareRepository).toContain('deterministicUuid(`hardware-reprint:${dto.commandId}`)');
    expect(hardwareRepository).toContain('hardware-reprint-dispatch-${dto.commandId}');
    expect(cashRepository).toContain("permission: 'cash.drawer.no_sale.approve'");
    expect(cashRepository).toContain('dto.approvalFingerprint !== expectedFingerprint');
    expect(sql).toContain('no_sale_drawer_event alter column approval_id set not null');
  });

  it('keeps payment-terminal and scale operations disabled', () => {
    expect(sql).toContain("'payment_terminal_foundation'");
    expect(sql).toContain("'scale_foundation'");
    expect(sql).toContain('hardware_foundation_execution_block');
  });

  it('adds scoped pilot transports, configuration, and policy', () => {
    expect(pilotSql).toContain("'network_tcp','printer_attached','keyboard_wedge'");
    expect(pilotSql).toContain('connection_configuration jsonb not null');
    expect(pilotSql).toContain('merchant.validate_hardware_connection');
    expect(pilotSql).toContain('create table merchant.hardware_pilot_policy');
    expect(pilotSql).toContain('hardware_transport_device_compatibility');
    expect(pilotSql).toContain('primary_receipt_printer_uidx');
    expect(pilotSql).toContain('primary_replaced');
    expect(pilotSql).toContain('hardware_pilot_policy_location_scope');
    expect(pilotSql).toContain('force row level security');
  });
});

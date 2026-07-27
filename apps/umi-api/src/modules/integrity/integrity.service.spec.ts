import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { IntegrityRepository } from './integrity.repository';
import { IntegrityService } from './integrity.service';

const command = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  branchId: '20000000-0000-4000-8000-000000000001',
  commandId: '30000000-0000-4000-8000-000000000001',
  idempotencyKey: 'test-command-key',
  commandType: 'test.command',
  payload: { amount: 100 },
  correlationId: 'test-correlation',
};

describe('IntegrityService', () => {
  it('commits one successful command and returns its durable result', async () => {
    const row = {
      commandId: command.commandId,
      fingerprint: 'a'.repeat(64),
      status: 'succeeded' as const,
      responseData: { accepted: true },
      failureCode: null,
      retryable: false,
      correlationId: command.correlationId,
    };
    const repository = mockRepository();
    repository.claimCommand.mockResolvedValue({
      owner: true,
      row: { ...row, status: 'processing' },
    });
    repository.getCommand.mockResolvedValue(row);
    repository.result.mockReturnValue({
      commandId: command.commandId,
      status: 'succeeded',
      duplicate: false,
      retryable: false,
      result: { accepted: true },
      failureCode: null,
      failureClass: null,
      correlationId: command.correlationId,
    });

    const result = await new IntegrityService(repository).execute(command, async () => ({
      ok: true,
      value: { accepted: true },
    }));

    expect(repository.succeed).toHaveBeenCalledOnce();
    expect(repository.fail).not.toHaveBeenCalled();
    expect(repository.getCommand).toHaveBeenCalledOnce();
    expect(result.result).toEqual({ accepted: true });
  });

  it('returns an existing matching command without executing the operation', async () => {
    const repository = mockRepository();
    repository.claimCommand.mockResolvedValue({
      owner: false,
      row: {
        commandId: command.commandId,
        fingerprint: 'a'.repeat(64),
        status: 'succeeded',
        responseData: { accepted: true },
        failureCode: null,
        retryable: false,
        correlationId: command.correlationId,
      },
    });
    repository.result.mockReturnValue({
      commandId: command.commandId,
      status: 'succeeded',
      duplicate: true,
      retryable: false,
      result: { accepted: true },
      failureCode: null,
      failureClass: null,
      correlationId: command.correlationId,
    });
    const operation = vi.fn();

    const result = await new IntegrityService(repository).execute(command, operation);

    expect(operation).not.toHaveBeenCalled();
    expect(result.duplicate).toBe(true);
  });

  it('persists classified failures without re-claiming retryable commands', async () => {
    const repository = mockRepository();
    repository.claimCommand.mockResolvedValue({
      owner: true,
      row: {
        commandId: command.commandId,
        fingerprint: 'a'.repeat(64),
        status: 'processing',
        responseData: null,
        failureCode: null,
        retryable: false,
        correlationId: command.correlationId,
      },
    });
    repository.getCommand.mockResolvedValue({
      commandId: command.commandId,
      fingerprint: 'a'.repeat(64),
      status: 'failed',
      responseData: { failureClass: 'transient' },
      failureCode: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
      correlationId: command.correlationId,
    });
    repository.result.mockReturnValue({
      commandId: command.commandId,
      status: 'failed',
      duplicate: false,
      retryable: true,
      result: null,
      failureCode: 'DEPENDENCY_UNAVAILABLE',
      failureClass: 'transient',
      correlationId: command.correlationId,
    });

    const result = await new IntegrityService(repository).execute(command, async () => ({
      ok: false,
      code: 'DEPENDENCY_UNAVAILABLE',
      failureClass: 'transient',
      retryable: true,
    }));

    expect(repository.fail).toHaveBeenCalledWith(
      expect.anything(),
      command.tenantId,
      command.idempotencyKey,
      'DEPENDENCY_UNAVAILABLE',
      'transient',
      true,
    );
    expect(repository.claimCommand).toHaveBeenCalledOnce();
    expect(result.retryable).toBe(true);
  });
});

function mockRepository() {
  const client = {} as PoolClient;
  const repository = {
    transaction: vi.fn(async (work: (value: PoolClient) => Promise<unknown>) => work(client)),
    claimCommand: vi.fn(),
    getCommand: vi.fn(),
    result: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    claimVersion: vi.fn(),
    appendAudit: vi.fn(),
    appendFinancial: vi.fn(),
  };
  return repository as unknown as IntegrityRepository & typeof repository;
}

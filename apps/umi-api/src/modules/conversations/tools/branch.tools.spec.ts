import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchTools } from './branch.tools';
import type { ToolContext } from '../turn.types';

const CTX: ToolContext = {
  tenantId: 't1',
  personId: 'p1',
  conversationId: 'c1',
  turnId: 'turn-1',
  locationId: null,
  customerPhone: '+5210000000000',
};

const TWO_BRANCHES = [
  { id: 'loc-chapu', name: 'Chapultepec' },
  { id: 'loc-roma', name: 'Roma' },
];

describe('BranchTools.setBranch', () => {
  let tenants: { listActiveLocationsWorker: ReturnType<typeof vi.fn> };
  let conversations: { setSelectedLocationWorker: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };

  function build() {
    return new BranchTools(tenants as never, conversations as never, config as never);
  }

  beforeEach(() => {
    tenants = { listActiveLocationsWorker: vi.fn().mockResolvedValue(TWO_BRANCHES) };
    conversations = { setSelectedLocationWorker: vi.fn().mockResolvedValue(undefined) };
    config = { get: vi.fn().mockReturnValue(true) };
  });

  it('is a no-op error when the feature is off (never touches the column)', async () => {
    config.get.mockReturnValue(false);
    const r = await build().setBranch(CTX, { branch: 'Chapultepec' });
    expect(r.success).toBe(false);
    expect(conversations.setSelectedLocationWorker).not.toHaveBeenCalled();
  });

  it('resolves an exact (accent/case-insensitive) branch name and persists it', async () => {
    const r = await build().setBranch(CTX, { branch: 'chapultepec' });
    expect(r.success).toBe(true);
    expect(r.branch).toBe('Chapultepec');
    expect(conversations.setSelectedLocationWorker).toHaveBeenCalledWith('c1', 'loc-chapu');
  });

  it('resolves a customer abbreviation via prefix ("chapu" -> Chapultepec)', async () => {
    const r = await build().setBranch(CTX, { branch: 'chapu' });
    expect(r.success).toBe(true);
    expect(conversations.setSelectedLocationWorker).toHaveBeenCalledWith('c1', 'loc-chapu');
  });

  it('asks again (needs_input) when the branch is unknown', async () => {
    const r = await build().setBranch(CTX, { branch: 'polanco' });
    expect(r.success).toBe(false);
    expect(r.error_type).toBe('needs_input');
    expect(conversations.setSelectedLocationWorker).not.toHaveBeenCalled();
  });

  it('asks to disambiguate when a query matches more than one branch equally', async () => {
    tenants.listActiveLocationsWorker.mockResolvedValue([
      { id: 'loc-1', name: 'Centro Roma' },
      { id: 'loc-2', name: 'Centro Condesa' },
    ]);
    const r = await build().setBranch(CTX, { branch: 'centro' });
    expect(r.success).toBe(false);
    expect(r.error_type).toBe('needs_input');
    expect(conversations.setSelectedLocationWorker).not.toHaveBeenCalled();
  });

  it('is a no-op success for a single-branch tenant', async () => {
    tenants.listActiveLocationsWorker.mockResolvedValue([{ id: 'loc-only', name: 'Centro' }]);
    const r = await build().setBranch(CTX, { branch: 'lo que sea' });
    expect(r.success).toBe(true);
    expect(conversations.setSelectedLocationWorker).not.toHaveBeenCalled();
  });
});

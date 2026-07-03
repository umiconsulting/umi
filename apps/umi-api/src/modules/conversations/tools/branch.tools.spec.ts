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

type Cand = { id: string; name: string; aliases: string[]; sim: number };

describe('BranchTools.setBranch', () => {
  let tenants: { matchBranchCandidates: ReturnType<typeof vi.fn> };
  let conversations: { setSelectedLocationWorker: ReturnType<typeof vi.fn> };

  const build = () => new BranchTools(tenants as never, conversations as never);
  const withCandidates = (c: Cand[]) => tenants.matchBranchCandidates.mockResolvedValue(c);

  beforeEach(() => {
    tenants = { matchBranchCandidates: vi.fn() };
    conversations = { setSelectedLocationWorker: vi.fn().mockResolvedValue(undefined) };
  });

  it('no-op success for a single-branch tenant', async () => {
    withCandidates([{ id: 'loc-only', name: 'Centro', aliases: [], sim: 0 }]);
    const r = await build().setBranch(CTX, { branch: 'lo que sea' });
    expect(r.success).toBe(true);
    expect(conversations.setSelectedLocationWorker).not.toHaveBeenCalled();
  });

  it('auto-selects a unique exact name match', async () => {
    withCandidates([
      { id: 'loc-chapu', name: 'Chapultepec', aliases: [], sim: 1 },
      { id: 'loc-roma', name: 'Roma', aliases: [], sim: 0 },
    ]);
    const r = await build().setBranch(CTX, { branch: 'chapultepec' });
    expect(r.success).toBe(true);
    expect(conversations.setSelectedLocationWorker).toHaveBeenCalledWith('c1', 'loc-chapu');
  });

  it('auto-selects via an owner-curated alias ("chapu")', async () => {
    withCandidates([
      { id: 'loc-chapu', name: 'Chapultepec', aliases: ['chapu', 'chapus'], sim: 0.5 },
      { id: 'loc-roma', name: 'Roma', aliases: [], sim: 0 },
    ]);
    const r = await build().setBranch(CTX, { branch: 'chapu' });
    expect(r.success).toBe(true);
    expect(conversations.setSelectedLocationWorker).toHaveBeenCalledWith('c1', 'loc-chapu');
  });

  it('auto-selects a unique prefix match with no aliases', async () => {
    withCandidates([
      { id: 'loc-chapu', name: 'Chapultepec', aliases: [], sim: 0.6 },
      { id: 'loc-roma', name: 'Roma', aliases: [], sim: 0 },
    ]);
    const r = await build().setBranch(CTX, { branch: 'chapu' });
    expect(r.success).toBe(true);
    expect(conversations.setSelectedLocationWorker).toHaveBeenCalledWith('c1', 'loc-chapu');
  });

  it('asks to disambiguate when the literal match is ambiguous', async () => {
    withCandidates([
      { id: 'loc-1', name: 'Centro Roma', aliases: [], sim: 0.5 },
      { id: 'loc-2', name: 'Centro Condesa', aliases: [], sim: 0.5 },
    ]);
    const r = await build().setBranch(CTX, { branch: 'centro' });
    expect(r.success).toBe(false);
    expect(r.error_type).toBe('needs_input');
    expect(conversations.setSelectedLocationWorker).not.toHaveBeenCalled();
  });

  it('CONFIRMS (never auto) a strong pg_trgm fuzzy match on a typo', async () => {
    withCandidates([
      { id: 'loc-chapu', name: 'Chapultepec', aliases: [], sim: 0.82 },
      { id: 'loc-roma', name: 'Roma', aliases: [], sim: 0.1 },
    ]);
    const r = await build().setBranch(CTX, { branch: 'chapultpec' }); // typo, no literal hit
    expect(r.success).toBe(false);
    expect(r.error_type).toBe('needs_input');
    expect(String(r.error)).toContain('Chapultepec');
    expect(conversations.setSelectedLocationWorker).not.toHaveBeenCalled();
  });

  it('re-asks with options when nothing is plausible', async () => {
    withCandidates([
      { id: 'loc-chapu', name: 'Chapultepec', aliases: [], sim: 0.1 },
      { id: 'loc-roma', name: 'Roma', aliases: [], sim: 0.05 },
    ]);
    const r = await build().setBranch(CTX, { branch: 'polanco' });
    expect(r.success).toBe(false);
    expect(r.error_type).toBe('needs_input');
    expect(conversations.setSelectedLocationWorker).not.toHaveBeenCalled();
  });
});

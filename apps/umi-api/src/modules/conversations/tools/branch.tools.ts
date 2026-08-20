import { Injectable } from '@nestjs/common';
import { TenantsRepository } from '../../tenants/tenants.repository';
import { ConversationsRepository } from '../conversations.repository';
import type { ToolContext, ToolResult } from '../turn.types';
import { needsInputToolError } from './tool-errors';

/**
 * Lenient branch-name normalization: lowercase, strip accents/punctuation,
 * collapse whitespace. Makes "Chapultepec", "chapultepec." and "CHAPULTEPEC"
 * compare equal, and lets a customer's "chapu" prefix-match "chapultepec".
 */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * pg_trgm `word_similarity` tuning knobs for the fuzzy second vote (used only
 * when there is no literal name/alias hit). Confirm vs. re-ask boundaries:
 *   - CONFIRM: a strong, clearly-separated top score -> ask the customer to
 *     confirm (never auto; this is typo territory).
 *   - ASK: anything above the floor but not confidently separated -> re-ask with
 *     the near candidates; below it, nothing is plausible.
 */
const FUZZY_CONFIRM_MIN_SIM = 0.72;
const FUZZY_CONFIRM_MIN_MARGIN = 0.25;
const FUZZY_ASK_MIN_SIM = 0.4;

/**
 * `set_branch` — records which branch a customer wants for the in-flight order.
 * The prompt only advertises it to multi-branch tenants that still need a choice
 * (see OrderLocationResolver / the `# SUCURSALES` block). The LLM does the fuzzy
 * read and passes a branch name; this tool VALIDATES it against the tenant's real
 * active branches and persists the pick to
 * `runtime.conversation_state.selected_location_id`. It never invents a branch.
 *
 * Matching (Phase 2) combines two votes over `name + owner-curated aliases`:
 *   - a deterministic literal match (exact > prefix > substring). A UNIQUE literal
 *     match is confident enough to auto-select ("chapu" -> "Chapultepec").
 *   - a pg_trgm `word_similarity` fuzzy score (the DB "second vote"), used only
 *     when there is no literal hit: a strong, clearly-separated score asks the
 *     customer to CONFIRM (never auto — this is where typos/near-misses live);
 *     anything ambiguous or weak re-asks with the options. Disambiguation is
 *     always voiced by the LLM (needs_input), never a hardcoded customer string.
 */
@Injectable()
export class BranchTools {
  constructor(
    private readonly tenants: TenantsRepository,
    private readonly conversations: ConversationsRepository,
  ) {}

  async setBranch(
    ctx: ToolContext,
    input: { branch?: string },
  ): Promise<ToolResult> {
    const raw = (input.branch ?? '').trim();
    const candidates = await this.tenants.matchBranchCandidates(ctx.tenantId, raw);
    if (candidates.length <= 1) {
      // Single-branch: nothing to choose (defensive — prompt won't offer this).
      return { success: true, message: 'El negocio tiene una sola sucursal.' };
    }
    const names = candidates.map((c) => c.name);
    if (!raw) {
      return needsInputToolError(
        'No se indicó la sucursal.',
        `Pregúntale al cliente de qué sucursal quiere ordenar. Opciones: ${names.join(', ')}.`,
      );
    }

    const q = normalize(raw);
    const detLevel = (c: { name: string; aliases: string[] }): number => {
      const targets = [c.name, ...c.aliases].map(normalize).filter(Boolean);
      if (targets.some((t) => t === q)) return 3; // exact name/alias
      if (targets.some((t) => t.startsWith(q) || q.startsWith(t))) return 2; // prefix
      if (targets.some((t) => t.includes(q) || q.includes(t))) return 1; // substring
      return 0;
    };
    const scored = candidates.map((c) => ({ c, det: detLevel(c), sim: c.sim }));

    // 1. Deterministic name/alias match — a UNIQUE best wins outright.
    const maxDet = Math.max(...scored.map((s) => s.det));
    if (maxDet > 0) {
      const top = scored.filter((s) => s.det === maxDet);
      if (top.length === 1) return this.persist(ctx, top[0].c);
      return this.ask(top.map((s) => s.c.name)); // equally-good literals → ask
    }

    // 2. No literal hit → pg_trgm fuzzy second vote.
    const bySim = [...scored].sort((a, b) => b.sim - a.sim);
    const s1 = bySim[0];
    const margin = s1.sim - (bySim[1]?.sim ?? 0);
    if (s1.sim >= FUZZY_CONFIRM_MIN_SIM && margin >= FUZZY_CONFIRM_MIN_MARGIN) {
      // Strong, clearly-separated fuzzy match → CONFIRM, never auto (typo territory).
      return needsInputToolError(
        `¿Te refieres a la sucursal ${s1.c.name}?`,
        `Confírmale al cliente si se refiere a la sucursal ${s1.c.name}. Si dice que sí, vuelve a llamar set_branch con "${s1.c.name}". Si no, muéstrale: ${names.join(', ')}.`,
      );
    }
    if (s1.sim >= FUZZY_ASK_MIN_SIM) {
      const near = bySim.filter((s) => s.sim >= FUZZY_ASK_MIN_SIM).map((s) => s.c.name);
      return this.ask(near.length > 1 ? near : names);
    }
    // 3. Nothing plausible.
    return needsInputToolError(
      `No reconocí "${raw}" como una sucursal.`,
      `Pídele al cliente que elija una de estas sucursales: ${names.join(', ')}.`,
    );
  }

  private async persist(
    ctx: ToolContext,
    loc: { id: string; name: string },
  ): Promise<ToolResult> {
    await this.conversations.setSelectedLocationWorker(ctx.conversationId, loc.id);
    return {
      success: true,
      branch: loc.name,
      message: `Sucursal seleccionada: ${loc.name}. Continúa con el pedido del cliente en esta sucursal.`,
    };
  }

  private ask(branchNames: string[]): ToolResult {
    return needsInputToolError(
      'Hay que aclarar la sucursal.',
      `Pídele al cliente que elija entre: ${branchNames.join(', ')}.`,
    );
  }
}

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
 * `set_branch` — records which branch a customer wants for the in-flight order.
 * The prompt only advertises it to multi-branch tenants that still need a choice
 * (see OrderLocationResolver / the `# SUCURSALES` block). The LLM does the fuzzy
 * read ("chapu" -> "Chapultepec") and passes a branch name; this tool VALIDATES
 * that name against the tenant's real active locations and persists the pick to
 * `comms.conversations.selected_location_id`. It never invents a branch: an
 * ambiguous or unmatched name returns `needs_input` so the bot re-asks in the
 * business voice (no hardcoded customer-facing string).
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
    const locations = await this.tenants.listActiveLocationsWorker(ctx.tenantId);
    if (locations.length <= 1) {
      // Single-branch: nothing to choose (defensive — prompt won't offer this).
      return { success: true, message: 'El negocio tiene una sola sucursal.' };
    }

    const names = locations.map((l) => l.name);
    const query = normalize(input.branch ?? '');
    if (!query) {
      return needsInputToolError(
        'No se indicó la sucursal.',
        `Pregúntale al cliente de qué sucursal quiere ordenar. Opciones: ${names.join(', ')}.`,
      );
    }

    // Rank: exact normalized name (3) > prefix either way (2) > substring (1).
    const scored = locations
      .map((l) => {
        const n = normalize(l.name);
        let score = 0;
        if (n === query) score = 3;
        else if (n.startsWith(query) || query.startsWith(n)) score = 2;
        else if (n.includes(query) || query.includes(n)) score = 1;
        return { l, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const top = scored[0];
    if (!top) {
      return needsInputToolError(
        `No reconocí "${input.branch}" como una sucursal.`,
        `Pídele al cliente que elija una de estas sucursales: ${names.join(', ')}.`,
      );
    }
    const tied = scored.filter((s) => s.score === top.score);
    if (tied.length > 1) {
      return needsInputToolError(
        `"${input.branch}" coincide con más de una sucursal.`,
        `Pídele al cliente que aclare entre: ${tied.map((s) => s.l.name).join(', ')}.`,
      );
    }

    await this.conversations.setSelectedLocationWorker(ctx.conversationId, top.l.id);
    return {
      success: true,
      branch: top.l.name,
      message: `Sucursal seleccionada: ${top.l.name}. Continúa con el pedido del cliente en esta sucursal.`,
    };
  }
}

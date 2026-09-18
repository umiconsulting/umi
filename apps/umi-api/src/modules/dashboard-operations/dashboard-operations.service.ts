import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  DashboardOperationsQuery,
  ReportsSalesInsight,
  ReportsSalesQuery,
  ReportsSalesSummary,
} from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { LLM_COMPLETION, type LlmCompletionProvider } from '../../shared/adapters/llm-completion';
import { DashboardOperationsRepository } from './dashboard-operations.repository';
import { DASHBOARD_DOMAIN_POLICY, hasDashboardPermission } from './dashboard-operations.policy';

// The AI sales narrative is cheap-stale: a 6-hour, size-bounded in-memory cache keyed by a
// fingerprint of the summary means the model fires only when the figures actually move, not
// on every view. Mirrors the customer-portrait pattern in CustomersService.
const INSIGHT_TTL_MS = 6 * 60 * 60 * 1000;
const INSIGHT_CACHE_MAX = 500;

// Spanish, plain language (lenguaje claro) — read by café owners on a phone. The model gets
// ONLY the summary figures and MUST NOT invent. One or two short sentences.
const SALES_INSIGHT_SYSTEM = `Eres el analista de ventas de un café. Escribes un resumen muy breve del desempeño de ventas para el dueño del negocio.

Reglas:
- Escribe en español claro y sencillo (lenguaje llano). Usa frases cortas.
- Máximo 2 frases y 40 palabras. Solo el texto: sin títulos, sin listas, sin emojis.
- Usa solo los datos que te doy (montos en pesos). No inventes nada.
- Di si vendió más o menos que el periodo anterior y qué producto o método de pago destaca.
- Termina con una acción concreta solo si los datos la sugieren.`;

/** Cheap, stable fingerprint of the insight inputs (djb2 over the JSON). */
function fingerprintInsight(value: unknown): string {
  const json = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < json.length; i += 1) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + json.length.toString(36);
}

@Injectable()
export class DashboardOperationsService {
  /** merchant:location:range:fingerprint → narrative, with an expiry. */
  private readonly insightCache = new Map<string, { text: string; expires: number }>();

  constructor(
    private readonly repository: DashboardOperationsRepository,
    @Inject(LLM_COMPLETION) private readonly llm: LlmCompletionProvider,
  ) {}

  async snapshot(user: AuthUser, access: MerchantAccess, query: DashboardOperationsQuery) {
    const selected = DASHBOARD_DOMAIN_POLICY.find((entry) => entry.domain === query.domain);
    if (!selected || !hasDashboardPermission(access.permissions, selected.permissions)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    if (access.locationId && query.locationId && access.locationId !== query.locationId) {
      throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    }
    const locationId = access.locationId ?? query.locationId ?? null;
    const rows = await this.repository.list(user.id, access.merchantId, query, locationId);
    const items = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    return {
      merchantId: access.merchantId,
      locationId,
      scope: access.locationId
        ? 'assigned_location'
        : locationId
          ? 'selected_location'
          : 'merchant',
      domains: DASHBOARD_DOMAIN_POLICY.map((entry) => ({
        domain: entry.domain,
        label: entry.label,
        priority: entry.priority,
        available: hasDashboardPermission(access.permissions, entry.permissions),
        administrative: entry.administrative,
        boundary: entry.boundary,
        requiredPermissions: entry.permissions,
        allowedActions: entry.actions,
        recovery: entry.recovery,
      })),
      selectedDomain: query.domain,
      items,
      page: {
        limit: query.limit,
        hasMore,
        nextCursor: hasMore ? String(query.cursor + query.limit) : null,
      },
      capturedAt: new Date().toISOString(),
    };
  }

  // The sale detail = its receipt snapshot. Gated by the same `sales` permission as
  // the list, and by the caller's location scope. Read-only.
  async saleReceipt(user: AuthUser, access: MerchantAccess, saleId: string) {
    const selected = DASHBOARD_DOMAIN_POLICY.find((entry) => entry.domain === 'sales');
    if (!selected || !hasDashboardPermission(access.permissions, selected.permissions)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(saleId)) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    }
    const row = await this.repository.saleReceipt(
      user.id,
      access.merchantId,
      saleId,
      access.locationId ?? null,
    );
    if (!row) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    }
    if (access.locationId && row.locationId && row.locationId !== access.locationId) {
      throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    }
    return { receiptNumber: row.receiptNumber, snapshot: row.snapshot, exceptions: row.exceptions };
  }

  // The Reportes → Ventas aggregate. Gated by the same `sales` permission as the sales
  // list, and by the caller's location scope. Read-only.
  async salesSummary(user: AuthUser, access: MerchantAccess, query: ReportsSalesQuery) {
    const selected = DASHBOARD_DOMAIN_POLICY.find((entry) => entry.domain === 'sales');
    if (!selected || !hasDashboardPermission(access.permissions, selected.permissions)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    if (access.locationId && query.locationId && access.locationId !== query.locationId) {
      throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    }
    const locationId = access.locationId ?? query.locationId ?? null;
    return this.repository.salesSummary(user.id, access.merchantId, query, locationId);
  }

  // The reconciliation drill-down for one cash shift. Gated by the same `cash_shifts`
  // permission as the shift list, and by the caller's location scope. Read-only.
  async cashShiftDetail(user: AuthUser, access: MerchantAccess, shiftId: string) {
    const selected = DASHBOARD_DOMAIN_POLICY.find((entry) => entry.domain === 'cash_shifts');
    if (!selected || !hasDashboardPermission(access.permissions, selected.permissions)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(shiftId)) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    }
    const row = await this.repository.cashShiftDetail(
      user.id,
      access.merchantId,
      shiftId,
      access.locationId ?? null,
    );
    if (!row) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    }
    return row;
  }

  // The AI sales narrative over the Reportes → Ventas summary. Same `sales` permission and
  // location scope as the summary (it reuses salesSummary), grounded only in its figures.
  // Fail-safe: the narrative is optional, so a model/skip/failure returns a null narrative
  // and the UI hides the card — it never breaks the report.
  async salesInsight(
    user: AuthUser,
    access: MerchantAccess,
    query: ReportsSalesQuery,
  ): Promise<ReportsSalesInsight> {
    const summary = await this.salesSummary(user, access, query);
    const capturedAt = new Date().toISOString();

    // Nothing to narrate: no sales in the window.
    if (summary.totals.orders === 0) {
      return { narrative: null, generated: false, capturedAt };
    }

    const input = this.insightInput(summary);
    const key = `${summary.merchantId}:${summary.locationId ?? 'all'}:${summary.range}:${fingerprintInsight(input)}`;
    const now = Date.now();
    const cached = this.insightCache.get(key);
    if (cached && cached.expires > now) {
      return { narrative: cached.text, generated: false, capturedAt };
    }

    let text: string | null = null;
    try {
      const completion = await this.llm.createCompletion({
        maxTokens: 180,
        system: SALES_INSIGHT_SYSTEM,
        userMessage: JSON.stringify(input),
      });
      text = completion?.text?.trim() || null;
    } catch {
      // fail-safe: the narrative is optional; `text` stays null so the card hides
    }
    if (text) {
      this.insightCache.set(key, { text, expires: now + INSIGHT_TTL_MS });
      this.pruneInsightCache();
    }
    return { narrative: text, generated: Boolean(text), capturedAt };
  }

  // Compact, model-friendly view of the summary: pesos (not minor units), the prior-period
  // delta, and the few dimensions worth narrating. Kept small so the fingerprint is stable.
  private insightInput(summary: ReportsSalesSummary) {
    const pesos = (minor: number) => Math.round(minor) / 100;
    const t = summary.totals;
    const prior = t.priorNetSalesMinorUnits;
    const deltaPct =
      prior && prior > 0 ? Math.round(((t.netSalesMinorUnits - prior) / prior) * 100) : null;
    return {
      rango: summary.range,
      moneda: summary.currency ?? 'MXN',
      ventasNetas: pesos(t.netSalesMinorUnits),
      ordenes: t.orders,
      ticketPromedio: pesos(t.averageTicketMinorUnits),
      propinas: pesos(t.tipsMinorUnits),
      descuentos: pesos(t.discountMinorUnits),
      ventasPeriodoAnterior: prior == null ? null : pesos(prior),
      cambioPorcentaje: deltaPct,
      metodosPago: summary.paymentMix.map((m) => ({
        metodo: m.method,
        monto: pesos(m.amountMinorUnits),
      })),
      topProductos: summary.productMix.slice(0, 5).map((p) => ({
        nombre: p.productName,
        unidades: p.units,
        monto: pesos(p.netMinorUnits),
      })),
    };
  }

  /** Drop expired entries; if still over the cap, evict oldest-inserted first. */
  private pruneInsightCache() {
    const now = Date.now();
    for (const [k, v] of this.insightCache) {
      if (v.expires <= now) this.insightCache.delete(k);
    }
    while (this.insightCache.size > INSIGHT_CACHE_MAX) {
      const oldest = this.insightCache.keys().next().value;
      if (oldest === undefined) break;
      this.insightCache.delete(oldest);
    }
  }
}

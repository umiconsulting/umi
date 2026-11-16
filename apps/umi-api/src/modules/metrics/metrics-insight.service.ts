import { Inject, Injectable } from '@nestjs/common';
import type {
  MetricsId,
  MetricsInsightQuery,
  MetricsInsightResponse,
  MetricsResponse,
} from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { LLM_COMPLETION, type LlmCompletionProvider } from '../../shared/adapters/llm-completion';
import { AiUsageRepository } from '../../shared/usage/ai-usage.repository';
import { MetricsService } from './metrics.service';

// The AI sales narrative is cheap-stale: a 6-hour, size-bounded in-memory cache keyed by a
// fingerprint of the summary means the model fires only when the figures actually move, not
// on every view. Mirrors the customer-portrait pattern in CustomersService.
const INSIGHT_TTL_MS = 6 * 60 * 60 * 1000;
const INSIGHT_CACHE_MAX = 500;

const SALES_INSIGHT_METRICS: MetricsId[] = [
  'net_sales',
  'orders',
  'average_ticket',
  'tips',
  'discounts',
  'prior_net_sales',
  'payment_mix',
  'product_mix',
];

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

/**
 * The sales narrative over the same period and location as the metrics query.
 *
 * The service calls `MetricsService.query` with one eight-metric request. That
 * call applies the sales policy and the location scope. A model failure returns
 * a null narrative, so the summary stays complete and the card hides.
 */
@Injectable()
export class MetricsInsightService {
  /** merchant:location:range:fingerprint → narrative, with an expiry. */
  private readonly insightCache = new Map<string, { text: string; expires: number }>();

  constructor(
    private readonly metrics: MetricsService,
    @Inject(LLM_COMPLETION) private readonly llm: LlmCompletionProvider,
    private readonly usage: AiUsageRepository,
  ) {}

  async insight(
    user: AuthUser,
    access: MerchantAccess,
    query: MetricsInsightQuery,
  ): Promise<MetricsInsightResponse> {
    const summary = await this.metrics.query(user, access, {
      metrics: SALES_INSIGHT_METRICS,
      dimensions: [],
      range: query.range,
      ...(query.locationId ? { locationId: query.locationId } : {}),
    });
    const values = summary.totals?.values;
    if (!values) throw new Error('the insight query returned rows, not totals');

    const capturedAt = new Date().toISOString();
    if (Number(values.orders ?? 0) === 0) {
      return { narrative: null, generated: false, capturedAt };
    }

    const input = this.insightInput(summary);
    const key = `${summary.scope.merchantId}:${summary.scope.locationId ?? 'all'}:${summary.period.range}:${fingerprintInsight(input)}`;
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
      if (completion) {
        await this.usage.record({
          merchantId: access.merchantId,
          kind: 'narrative',
          promptTokens: completion.inputTokens,
          completionTokens: completion.outputTokens,
        });
      }
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
  private insightInput(summary: MetricsResponse) {
    const values = summary.totals?.values ?? {};
    const pesos = (minor: unknown) => Math.round(Number(minor ?? 0)) / 100;
    const prior = values.prior_net_sales;
    const priorValue = prior == null ? null : Number(prior);
    const net = Number(values.net_sales ?? 0);
    const deltaPct =
      priorValue && priorValue > 0 ? Math.round(((net - priorValue) / priorValue) * 100) : null;
    const payment = values.payment_mix as
      { items?: { method: string; amountMinorUnits: number }[] } | undefined;
    const products = values.product_mix as
      | { items?: { productName: string; units: number; merchandiseMinorUnits: number }[] }
      | undefined;
    return {
      rango: summary.period.range,
      moneda: summary.scope.currency ?? 'MXN',
      ventasNetas: pesos(values.net_sales),
      ordenes: Number(values.orders ?? 0),
      ticketPromedio: pesos(values.average_ticket),
      propinas: pesos(values.tips),
      descuentos: pesos(values.discounts),
      ventasPeriodoAnterior: priorValue == null ? null : pesos(priorValue),
      cambioPorcentaje: deltaPct,
      metodosPago: (payment?.items ?? []).map((m) => ({
        metodo: m.method,
        monto: pesos(m.amountMinorUnits),
      })),
      topProductos: (products?.items ?? []).slice(0, 5).map((p) => ({
        nombre: p.productName,
        unidades: p.units,
        monto: pesos(p.merchandiseMinorUnits),
      })),
    };
  }

  private pruneInsightCache() {
    const now = Date.now();
    for (const [k, v] of this.insightCache) {
      if (v.expires <= now) this.insightCache.delete(k);
    }
    while (this.insightCache.size > INSIGHT_CACHE_MAX) {
      const oldest = this.insightCache.keys().next().value;
      if (!oldest) break;
      this.insightCache.delete(oldest);
    }
  }
}

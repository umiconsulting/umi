import { Injectable, Logger } from '@nestjs/common';
import { LeadsRepository, type LeadDiagnosticData } from './leads.repository';
import { SequencesService } from './sequences.service';

/**
 * Diagnostic scoring + lead creation (Phase 5). Ports:
 *   - `calculateDiagnostic` (the landing `/api/diagnostic` route) → `score()`
 *   - `DiagnosticTrigger.processDiagnostic` → `process()`
 *
 * On submission we score the answers, upsert the prospect into `grow.leads`,
 * append a `diagnostic_completed` event, and fire the day-0 welcome (idempotent,
 * flag-gated in SequencesService).
 */

export interface DiagnosticScore {
  score: number;
  level: string;
  recommendations: string[];
  areas: {
    dataCollection: number;
    analysis: number;
    visualization: number;
    decisionMaking: number;
  };
}

export interface ProcessDiagnosticResult {
  diagnostic: DiagnosticScore;
  isNewLead: boolean;
  leadId: string;
}

// Ported from getScoreFromString (landing /api/diagnostic route).
const SCORE_MAP: Record<string, number> = {
  muy_bajo: 1, bajo: 2, medio: 3, alto: 4, muy_alto: 5,
  nunca: 1, rara_vez: 2, a_veces: 3, frecuentemente: 4, siempre: 5,
  inicial: 1, intermedio: 3, avanzado: 5,
  pedidos: 1, cocina: 3, clientes: 5,
  recopilacion: 1, organizacion: 3, interpretacion: 5,
};

const AREA_KEYS = {
  dataCollection: ['analytics_stage', 'data_challenge', 'data_sources', 'data_quality', 'data_integration'],
  analysis: ['analytics_stage', 'decision_basis', 'analysis_tools', 'analysis_frequency', 'analysis_depth'],
  visualization: ['analytics_stage', 'visualization_tools', 'dashboard_usage', 'report_creation'],
  decisionMaking: ['decision_basis', 'data_challenge', 'decision_speed', 'data_driven_decisions', 'kpi_tracking'],
} as const;

@Injectable()
export class DiagnosticService {
  private readonly logger = new Logger(DiagnosticService.name);

  constructor(
    private readonly repo: LeadsRepository,
    private readonly sequences: SequencesService,
  ) {}

  /** Pure scoring — port of the landing `calculateDiagnostic`. */
  score(responses: Record<string, string | number>): DiagnosticScore {
    const areas = {
      dataCollection: this.areaScore(responses, AREA_KEYS.dataCollection),
      analysis: this.areaScore(responses, AREA_KEYS.analysis),
      visualization: this.areaScore(responses, AREA_KEYS.visualization),
      decisionMaking: this.areaScore(responses, AREA_KEYS.decisionMaking),
    };
    const total = Math.round(
      (areas.dataCollection + areas.analysis + areas.visualization + areas.decisionMaking) / 4,
    );

    let level: string;
    let recommendations: string[];
    if (total >= 8) {
      level = 'Avanzado';
      recommendations = [
        'Fortalecer observabilidad y trazas',
        'Automatizar con controles de intervención',
        'Medir el ciclo completo pedido-cocina-cliente',
      ];
    } else if (total >= 5) {
      level = 'Intermedio';
      recommendations = [
        'Conectar KDS, Cash y Dashboard',
        'Unificar estados de pedidos y recompensas',
        'Definir alertas operativas para gerencia',
      ];
    } else {
      level = 'Inicial';
      recommendations = [
        'Activar ConversaFlow como entrada operativa',
        'Estructurar el contrato mínimo de pedido y cliente',
        'Crear la primera vista de seguimiento',
      ];
    }
    return { score: total, level, recommendations, areas };
  }

  private areaScore(
    responses: Record<string, string | number>,
    keys: readonly string[],
  ): number {
    let total = 0;
    let valid = 0;
    for (const key of keys) {
      const r = responses[key];
      if (r === undefined || r === null) continue;
      const s = typeof r === 'number' ? r : SCORE_MAP[String(r).toLowerCase().trim()] || 1;
      total += s;
      valid++;
    }
    return valid > 0 ? Math.round(total / valid) : 1;
  }

  /** Score + upsert lead + welcome. Port of DiagnosticTrigger.processDiagnostic. */
  async process(input: {
    email: string;
    name: string;
    company?: string;
    responses: Record<string, string | number>;
  }): Promise<ProcessDiagnosticResult> {
    const diagnostic = this.score(input.responses);
    const diagnosticData: LeadDiagnosticData = {
      score: diagnostic.score,
      level: diagnostic.level,
      recommendations: diagnostic.recommendations,
      areas: diagnostic.areas,
    };

    const { lead, isNew } = await this.repo.upsertByEmail({
      email: input.email,
      name: input.name,
      company: input.company ?? null,
      diagnosticData,
      diagnosticDate: new Date().toISOString(),
    });

    await this.repo.recordEvent(lead.id, 'diagnostic_completed', {
      score: diagnostic.score,
      level: diagnostic.level,
      is_new_lead: isNew,
    });

    if (isNew) {
      await this.sequences.sendWelcome(lead);
    }

    this.logger.log(
      `diagnostic processed for ${input.email} (new=${isNew}, level=${diagnostic.level})`,
    );
    return { diagnostic, isNewLead: isNew, leadId: lead.id };
  }
}

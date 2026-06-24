import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PgService } from '../database/pg.service';
import type { AppConfig } from '../config/config.schema';

// Ported from umi-conversaflow `_shared/logger.ts`. Writes the runtime trace
// tables that umi-logs reads (ai_turn_logs, edge_function_logs, security_logs)
// plus the internal pipeline_traces, in the observability schema (default
// `conversaflow`). All writes are BEST-EFFORT: a trace insert must never break
// the request or job — failures are logged and swallowed. Uses the worker
// (BYPASSRLS) pool since these are service-role-only tables.

export interface AiTurnLog {
  conversation_id?: string;
  customer_id?: string;
  business_id?: string;
  model: string;
  prompt_version?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  response_type?: string;
  products_referenced?: unknown[];
  customer_context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  request_id?: string;
}

export interface EdgeFunctionLog {
  function_name: string;
  status: 'success' | 'error';
  duration_ms?: number;
  error_message?: string;
  error_stack?: string;
  metadata?: Record<string, unknown>;
  request_id?: string;
}

export interface PipelineTrace {
  trace_id: string;
  conversation_id?: string;
  turn_id?: string;
  business_id?: string;
  stage: 'inbound' | 'integrity' | 'process' | 'dispatch';
  event: string;
  detail?: Record<string, unknown>;
  error?: string;
}

@Injectable()
export class TraceService {
  private readonly logger = new Logger(TraceService.name);
  private readonly schema: string;

  constructor(
    private readonly pg: PgService,
    config: ConfigService<AppConfig, true>,
  ) {
    // Already validated as a safe identifier by the config schema.
    this.schema = config.get('OBSERVABILITY_SCHEMA', { infer: true });
  }

  /**
   * SEC-04: a stable, non-reversible 16-hex-char (8-byte) SHA-256 prefix of a
   * phone number — loggable and correlatable, but not the raw value.
   */
  hashPhone(phone: string): string {
    return createHash('sha256').update(phone).digest('hex').slice(0, 16);
  }

  async logAiTurn(data: AiTurnLog): Promise<void> {
    await this.insert(
      'ai_turn_logs',
      `INSERT INTO ${this.schema}.ai_turn_logs
         (conversation_id, customer_id, business_id, model, prompt_version,
          prompt_tokens, completion_tokens, cost_usd, latency_ms, response_type,
          products_referenced, customer_context, metadata, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14)`,
      [
        data.conversation_id ?? null,
        data.customer_id ?? null,
        data.business_id ?? null,
        data.model,
        data.prompt_version ?? null,
        data.prompt_tokens ?? null,
        data.completion_tokens ?? null,
        data.cost_usd ?? null,
        data.latency_ms ?? null,
        data.response_type ?? null,
        this.json(data.products_referenced),
        this.json(data.customer_context),
        this.json(data.metadata),
        data.request_id ?? null,
      ],
    );
  }

  async logEdgeFunction(data: EdgeFunctionLog): Promise<void> {
    await this.insert(
      'edge_function_logs',
      `INSERT INTO ${this.schema}.edge_function_logs
         (function_name, status, duration_ms, error_message, error_stack, metadata, request_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        data.function_name,
        data.status,
        data.duration_ms ?? null,
        data.error_message ?? null,
        data.error_stack ?? null,
        this.json(data.metadata),
        data.request_id ?? null,
      ],
    );
  }

  async logSecurityEvent(params: {
    phone: string;
    eventType: string;
    inputText: string;
    details?: string;
    requestId?: string;
  }): Promise<void> {
    await this.insert(
      'security_logs',
      `INSERT INTO ${this.schema}.security_logs
         (phone, event_type, input_text, details, timestamp, request_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        params.phone, // raw phone only in the restricted security_logs table
        params.eventType,
        params.inputText.substring(0, 500),
        params.details ?? null,
        new Date().toISOString(),
        params.requestId ?? null,
      ],
    );
  }

  async logPipelineTrace(data: PipelineTrace): Promise<void> {
    await this.insert(
      'pipeline_traces',
      `INSERT INTO ${this.schema}.pipeline_traces
         (trace_id, conversation_id, turn_id, business_id, stage, event, detail, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        data.trace_id,
        data.conversation_id ?? null,
        data.turn_id ?? null,
        data.business_id ?? null,
        data.stage,
        data.event,
        this.json(data.detail),
        data.error ?? null,
      ],
    );
  }

  private json(value: unknown): string | null {
    return value == null ? null : JSON.stringify(value);
  }

  /** Best-effort insert: never throws — a failed trace must not break the caller. */
  private async insert(
    table: string,
    text: string,
    params: unknown[],
  ): Promise<void> {
    try {
      await this.pg.query(text, params);
    } catch (err) {
      this.logger.warn(
        `${table}_insert_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

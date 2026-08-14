import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { createHash } from 'node:crypto';
import { PgService } from '../database/pg.service';
import type { AppConfig } from '../config/config.schema';
import { errorCategory, redactTelemetry } from '../operations/redaction';

export interface AiTurnLog {
  conversation_id?: string;
  customer_id?: string;
  merchant_id?: string;
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
  merchant_id?: string;
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
    this.schema = config.get('OBSERVABILITY_SCHEMA', { infer: true });
  }

  hashPhone(phone: string): string {
    return createHash('sha256').update(phone).digest('hex').slice(0, 16);
  }

  async logAiTurn(data: AiTurnLog): Promise<void> {
    await this.insert(
      'ai_turn_logs',
      `INSERT INTO ${this.schema}.ai_turn_logs
         (conversation_id, customer_id, merchant_id, model, prompt_version,
          prompt_tokens, completion_tokens, cost_usd, latency_ms, response_type,
          products_referenced, customer_context, metadata, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14)`,
      [
        data.conversation_id ?? null,
        data.customer_id ?? null,
        data.merchant_id ?? null,
        data.model,
        data.prompt_version ?? null,
        data.prompt_tokens ?? null,
        data.completion_tokens ?? null,
        data.cost_usd ?? null,
        data.latency_ms ?? null,
        data.response_type ?? null,
        this.json(data.products_referenced),
        this.json(redactTelemetry(data.customer_context)),
        this.json(redactTelemetry(data.metadata)),
        data.request_id ?? null,
      ],
    );
    this.emit('umi.ai.turn', {
      'gen_ai.request.model': data.model,
      'umi.duration_ms': data.latency_ms,
    });
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
        data.error_message ? '[REDACTED_ERROR]' : null,
        data.error_stack ? '[REDACTED_STACK]' : null,
        this.json(redactTelemetry(data.metadata)),
        data.request_id ?? null,
      ],
    );
    this.emit(
      'umi.edge.operation',
      { 'umi.operation.name': data.function_name },
      data.status === 'error',
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
        this.hashPhone(params.phone),
        params.eventType,
        '[REDACTED_INPUT]',
        params.details ? '[REDACTED_DETAILS]' : null,
        new Date().toISOString(),
        params.requestId ?? null,
      ],
    );
    this.emit('umi.security.event', { 'umi.security.event_type': params.eventType });
  }

  async logPipelineTrace(data: PipelineTrace): Promise<void> {
    await this.insert(
      'pipeline_traces',
      `INSERT INTO ${this.schema}.pipeline_traces
         (trace_id, conversation_id, turn_id, merchant_id, stage, event, detail, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        data.trace_id,
        data.conversation_id ?? null,
        data.turn_id ?? null,
        data.merchant_id ?? null,
        data.stage,
        data.event,
        this.json(redactTelemetry(data.detail)),
        data.error ? '[REDACTED_ERROR]' : null,
      ],
    );
    this.emit('umi.pipeline.event', { 'umi.pipeline.stage': data.stage }, Boolean(data.error));
  }

  private json(value: unknown): string | null {
    if (value == null) return null;
    try {
      return JSON.stringify(value);
    } catch (err) {
      this.logger.warn(`trace_json_serialize_failed category=${errorCategory(err)}`);
      return JSON.stringify({ _unserializable: true });
    }
  }

  private async insert(table: string, text: string, params: unknown[]): Promise<void> {
    try {
      await this.pg.query(text, params);
    } catch (err) {
      this.logger.warn(`${table}_insert_failed category=${errorCategory(err)}`);
    }
  }

  private emit(
    name: string,
    attributes: Record<string, string | number | undefined>,
    failed = false,
  ): void {
    trace.getTracer('umi-api').startActiveSpan(name, (span) => {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined)
          span.setAttribute(key, typeof value === 'string' ? value.slice(0, 120) : value);
      }
      if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    });
  }
}

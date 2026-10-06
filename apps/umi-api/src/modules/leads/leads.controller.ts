import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { LeadsService } from './leads.service';
import { DiagnosticService } from './diagnostic.service';
import { ContactDto } from './dto/contact.dto';
import { DiagnosticDto } from './dto/diagnostic.dto';
import { EmailResponseWebhookDto } from './dto/webhook.dto';

/**
 * PUBLIC landing-page endpoints (Phase 5, spec §7.3). No auth guards — the
 * landing page is anonymous. Each route carries BOTH the domain-namespaced path
 * (`/api/leads/*`) and the legacy landing path (`/api/contact`, `/api/diagnostic`,
 * `/api/webhook/email-response`) as an alias so the landing page cuts over with a
 * single base-URL swap (spec §13, Phase 5).
 *
 * This surface is intentionally the ONLY anonymous one: contact + diagnostic +
 * the signature-verified webhook. The internal lead-admin operations (metrics,
 * list-triggered sends, pause/resume/mark-responded by id) are deliberately NOT
 * exposed here — on a shared production API they must sit behind an authenticated
 * owner/admin surface, so they live only as SequencesService/LeadsService methods
 * until such a controller exists.
 */
@Controller()
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly diagnostic: DiagnosticService,
  ) {}

  // ── Contact form ───────────────────────────────────────────────────────────
  @Post(['api/leads/contact', 'api/contact'])
  @HttpCode(200)
  async contact(@Body() dto: ContactDto): Promise<{ success: boolean; message: string }> {
    await this.leads.sendContact(dto);
    return { success: true, message: 'Consulta enviada exitosamente' };
  }

  // ── Diagnostic ─────────────────────────────────────────────────────────────
  @Post(['api/leads/diagnostic', 'api/diagnostic'])
  @HttpCode(200)
  async submitDiagnostic(@Body() dto: DiagnosticDto): Promise<{
    diagnostic: ReturnType<DiagnosticService['score']>;
    processing: {
      success: boolean;
      isNewLead: boolean;
      leadId: string;
      level: string;
      timestamp: string;
    };
  }> {
    const result = await this.diagnostic.process(dto);
    return {
      diagnostic: result.diagnostic,
      processing: {
        success: true,
        isNewLead: result.isNewLead,
        leadId: result.leadId,
        level: result.diagnostic.level,
        timestamp: new Date().toISOString(),
      },
    };
  }

  @Get(['api/leads/diagnostic', 'api/diagnostic'])
  diagnosticHealth(): unknown {
    return { status: 'ok', service: 'leads-api', timestamp: new Date().toISOString() };
  }

  // ── Email-response webhook ─────────────────────────────────────────────────
  @Post(['api/leads/webhook/email-response', 'api/webhook/email-response'])
  @HttpCode(200)
  async emailResponseWebhook(
    @Req() req: FastifyRequest,
    @Body() dto: EmailResponseWebhookDto,
    @Headers('x-webhook-signature') signature?: string,
  ): Promise<unknown> {
    // NOTE: signature is verified over the re-serialized JSON body. That's exact
    // for a same-shape sender; a provider that signs its own raw bytes will need
    // raw-body capture wired in the bootstrap first. Deferred until a concrete
    // provider is chosen — the webhook is dormant and fails closed in prod
    // (LEADS_WEBHOOK_SECRET required when the sequence runs; see config.schema).
    const rawBody = JSON.stringify(req.body ?? {});
    if (!this.leads.verifyWebhookSignature(signature ?? null, rawBody)) {
      throw new UnauthorizedException('Webhook signature inválida');
    }
    await this.leads.handleEmailResponse(dto);
    return {
      success: true,
      processed: dto.type,
      leadId: dto.leadId,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(['api/leads/webhook/email-response', 'api/webhook/email-response'])
  webhookHealth(): unknown {
    return {
      status: 'active',
      service: 'email-response-webhook',
      timestamp: new Date().toISOString(),
    };
  }
}

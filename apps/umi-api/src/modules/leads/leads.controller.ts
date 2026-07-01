import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { LeadsService } from './leads.service';
import { DiagnosticService } from './diagnostic.service';
import { SequencesService } from './sequences.service';
import { ContactDto } from './dto/contact.dto';
import { DiagnosticDto } from './dto/diagnostic.dto';
import { CreateLeadDto, UpdateLeadDto } from './dto/lead.dto';
import { EmailResponseWebhookDto } from './dto/webhook.dto';

/**
 * PUBLIC landing-page endpoints (Phase 5, spec §7.3). No auth guards — the
 * landing page is anonymous. Each route carries BOTH the domain-namespaced path
 * (`/api/leads/*`) and the legacy landing path (`/api/contact`, `/api/diagnostic`,
 * `/api/webhook/email-response`) as an alias so the landing page cuts over with a
 * single base-URL swap (spec §13, Phase 5). The email-response webhook is
 * signature-verified in LeadsService (fails closed in production).
 */
@Controller()
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly diagnostic: DiagnosticService,
    private readonly sequences: SequencesService,
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
  async diagnosticInfo(@Query('action') action?: string): Promise<unknown> {
    switch (action) {
      case 'metrics':
        return { metrics: await this.leads.getStats() };
      case 'leads':
        return { scheduledEmails: await this.sequences.sendDueEmails() };
      case 'health':
        return { status: 'healthy', service: 'diagnostic-api', timestamp: new Date().toISOString() };
      default:
        return { status: 'ok', service: 'leads-api' };
    }
  }

  // ── Lead management ────────────────────────────────────────────────────────
  @Post('api/leads')
  @HttpCode(200)
  async createLead(@Body() dto: CreateLeadDto): Promise<unknown> {
    const r = await this.leads.createLead(dto);
    return {
      success: true,
      message: 'Lead agregado exitosamente',
      leadId: r.leadId,
      isNew: r.isNew,
      sequenceStarted: r.sequenceStarted,
    };
  }

  @Get('api/leads')
  async stats(): Promise<unknown> {
    return { success: true, stats: await this.leads.getStats(), lastUpdated: new Date().toISOString() };
  }

  @Put('api/leads')
  async updateLead(@Body() dto: UpdateLeadDto): Promise<unknown> {
    const success = await this.leads.updateLead(dto);
    return { success, leadId: dto.leadId, action: dto.action };
  }

  // ── Email-response webhook ─────────────────────────────────────────────────
  @Post(['api/leads/webhook/email-response', 'api/webhook/email-response'])
  @HttpCode(200)
  async emailResponseWebhook(
    @Req() req: FastifyRequest,
    @Body() dto: EmailResponseWebhookDto,
    @Headers('x-webhook-signature') signature?: string,
  ): Promise<unknown> {
    const rawBody = JSON.stringify(req.body ?? {});
    if (!this.leads.verifyWebhookSignature(signature ?? null, rawBody)) {
      throw new UnauthorizedException('Webhook signature inválida');
    }
    await this.leads.handleEmailResponse(dto);
    return { success: true, processed: dto.type, leadId: dto.leadId, timestamp: new Date().toISOString() };
  }

  @Get(['api/leads/webhook/email-response', 'api/webhook/email-response'])
  webhookHealth(): unknown {
    return { status: 'active', service: 'email-response-webhook', timestamp: new Date().toISOString() };
  }
}

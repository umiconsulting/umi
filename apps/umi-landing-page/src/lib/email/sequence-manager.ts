// Manager de Secuencias Modular
// src/lib/email/sequenceManager.ts

import { EmailService, getEmailService, getInternalEmail } from "./email-service";
import { EmailTemplates, EmailTemplateData } from "./templates";
import { LeadDatabasePostgres, getLeadDatabasePostgres } from "../database/postgres";
import { LeadDatabase } from "../database/sqlite";

type AnyLeadDatabase = LeadDatabase | LeadDatabasePostgres;

export interface Lead {
  id: string;
  email: string;
  name: string;
  company: string;
  diagnosticDate: Date;
  lastResponse?: Date;
  meetingScheduled: boolean;
  meetingDate?: Date;
  meetingAttended: boolean;
  emailsSent: string[];
  sequencePaused: boolean;
  pauseReason?: string;
  diagnosticData: {
    score: number;
    level: string;
    primaryChallenge: string;
    quickWins: Array<{ action: string; description: string }>;
    estimatedROI: {
      timeToValue: number;
      expectedReturn: number;
    };
  };
}

export interface SequenceConfig {
  id: string;
  name: string;
  trigger: "diagnostic_completed" | "no_response" | "meeting_missed";
  emails: Array<{
    day: number;
    template: keyof typeof EmailTemplates;
    subject: string;
    priority: "high" | "normal" | "low";
    conditions?: (lead: Lead) => boolean;
  }>;
}

export interface SequenceMetrics {
  totalLeads: number;
  emailsSent: number;
  emailsFailed: number;
  responsesReceived: number;
  meetingsScheduled: number;
  conversions: number;
  sequenceCompletions: number;
}

interface EmailConfig {
  day: number;
  template: keyof typeof EmailTemplates;
  subject: string;
  priority: "high" | "normal" | "low";
  conditions?: (lead: Lead) => boolean;
}

export class SequenceManager {
  private emailService: EmailService;
  private sequences: Map<string, SequenceConfig> = new Map();
  private database: AnyLeadDatabase | null = null;
  private isPostgres: boolean = false;
  private metrics: SequenceMetrics = {
    totalLeads: 0,
    emailsSent: 0,
    emailsFailed: 0,
    responsesReceived: 0,
    meetingsScheduled: 0,
    conversions: 0,
    sequenceCompletions: 0,
  };

  constructor(emailService?: EmailService, database?: AnyLeadDatabase) {
    this.emailService = emailService || getEmailService();
    this.initializeSequences();
    if (database) {
      this.database = database;
      this.isPostgres = database instanceof LeadDatabasePostgres;
    } else {
      // Auto-detect from env
      const dbType = process.env.DATABASE_TYPE || "sqlite";
      if (dbType === "postgres") {
        this.database = getLeadDatabasePostgres();
        this.isPostgres = true;
      } else {
        this.database = new LeadDatabase();
        this.isPostgres = false;
      }
    }
  }

  private initializeSequences() {
    // Secuencia principal de diagnóstico
    this.addSequence({
      id: "diagnostic_followup",
      name: "Seguimiento de Diagnóstico",
      trigger: "diagnostic_completed",
      emails: [
        {
          day: 0,
          template: "day0Urgency",
          subject: "⚡ ¡Momento clave para ${company}!",
          priority: "high",
        },
        {
          day: 2,
          template: "day2Pressure",
          subject: "⏰ ${company}: Ventana cerrándose",
          priority: "high",
          conditions: (lead) => !this.hasRespondedRecently(lead, 2),
        },
        {
          day: 5,
          template: "day5CaseStudy",
          subject: "📊 Caso real: Empresa como ${company}",
          priority: "normal",
          conditions: (lead) => !this.hasRespondedRecently(lead, 5),
        },
        {
          day: 10,
          template: "day10FreeOffer",
          subject: "🎁 Última oportunidad: Implementación gratuita",
          priority: "normal",
          conditions: (lead) => !this.hasRespondedRecently(lead, 10),
        },
        {
          day: 30,
          template: "day30Reactivation",
          subject: "📈 Actualización del mercado: Nuevas tendencias BI",
          priority: "low",
          conditions: (lead) => !this.hasRespondedRecently(lead, 30),
        },
      ],
    });

    // Secuencia para no-shows
    this.addSequence({
      id: "meeting_noshow",
      name: "Seguimiento No-Show",
      trigger: "meeting_missed",
      emails: [
        {
          day: 0,
          template: "noShow",
          subject: "❓ ¿Todo bien? Reagendemos tu consulta",
          priority: "high",
        },
      ],
    });
  }

  // Gestión de secuencias
  addSequence(sequence: SequenceConfig) {
    this.sequences.set(sequence.id, sequence);
    console.log(`✅ Secuencia agregada: ${sequence.name}`);
  }

  getSequence(id: string): SequenceConfig | undefined {
    return this.sequences.get(id);
  }

  // Procesamiento principal
  async processAllSequences(): Promise<SequenceMetrics> {
    console.log("🔄 Iniciando procesamiento de todas las secuencias...");

    try {
      const leads = await this.getActiveLeads();
      this.metrics.totalLeads = leads.length;

      let totalEmailsSent = 0;
      let totalEmailsFailed = 0;

      for (const lead of leads) {
        try {
          const results = await this.processLeadSequences(lead);
          totalEmailsSent += results.sent;
          totalEmailsFailed += results.failed;

          // Pequeño delay entre leads para evitar rate limiting
          await this.delay(500);
        } catch (leadError) {
          console.error(`❌ Error procesando lead ${lead.id}:`, leadError);
          totalEmailsFailed++;
        }
      }

      this.metrics.emailsSent += totalEmailsSent;
      this.metrics.emailsFailed += totalEmailsFailed;

      console.log(
        `✅ Procesamiento completado: ${totalEmailsSent} enviados, ${totalEmailsFailed} fallidos`
      );

      // Enviar reporte si hubo actividad
      if (totalEmailsSent > 0) {
        await this.sendDailyReport();
      }

      return { ...this.metrics };
    } catch (error) {
      console.error("❌ Error en processAllSequences:", error);
      await this.sendErrorAlert(error);
      throw error;
    }
  }

  async processLeadSequences(
    lead: Lead
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    // Determinar qué secuencias aplicar
    const applicableSequences = this.getApplicableSequences(lead);

    for (const sequence of applicableSequences) {
      const emailsToSend = this.getEmailsToSend(lead, sequence);

      for (const emailConfig of emailsToSend) {
        try {
          const success = await this.sendSequenceEmail(
            lead,
            emailConfig,
            sequence
          );
          if (success) {
            sent++;
            await this.markEmailSent(lead, emailConfig, sequence);
          } else {
            failed++;
          }

          // Delay entre emails del mismo lead
          await this.delay(1000);
        } catch (error) {
          console.error(`❌ Error enviando email a ${lead.email}:`, error);
          failed++;
        }
      }
    }

    return { sent, failed };
  }

  private getApplicableSequences(lead: Lead): SequenceConfig[] {
    const applicable: SequenceConfig[] = [];

    // Verificar si el lead está pausado
    if (lead.sequencePaused) {
      console.log(
        `⏸️ Lead ${lead.email} tiene secuencias pausadas: ${lead.pauseReason}`
      );
      return applicable;
    }

    // Secuencia de diagnóstico
    if (!this.hasResponded(lead)) {
      const diagnosticSequence = this.sequences.get("diagnostic_followup");
      if (diagnosticSequence) {
        applicable.push(diagnosticSequence);
      }
    }

    // Secuencia de no-show
    if (lead.meetingScheduled && !lead.meetingAttended && lead.meetingDate) {
      const noShowSequence = this.sequences.get("meeting_noshow");
      if (noShowSequence) {
        applicable.push(noShowSequence);
      }
    }

    return applicable;
  }

  private getEmailsToSend(lead: Lead, sequence: SequenceConfig): EmailConfig[] {
    const emailsToSend: EmailConfig[] = [];

    for (const emailConfig of sequence.emails) {
      // Verificar si ya se envió este email
      const emailKey = `${sequence.id}_day_${emailConfig.day}`;
      if (lead.emailsSent.includes(emailKey)) {
        continue;
      }

      // Calcular días transcurridos según el tipo de secuencia
      let daysSince: number;
      if (sequence.trigger === "meeting_missed" && lead.meetingDate) {
        daysSince = this.calculateDaysSince(lead.meetingDate);
      } else {
        daysSince = this.calculateDaysSince(lead.diagnosticDate);
      }

      // Verificar si es tiempo de enviar este email
      if (daysSince >= emailConfig.day) {
        // Aplicar condiciones adicionales si existen
        if (emailConfig.conditions && !emailConfig.conditions(lead)) {
          console.log(
            `⚠️ Condición no cumplida para ${lead.email}, email día ${emailConfig.day}`
          );
          continue;
        }

        emailsToSend.push(emailConfig);
      }
    }

    return emailsToSend;
  }

  private async sendSequenceEmail(
    lead: Lead,
    emailConfig: EmailConfig,
    sequence: SequenceConfig
  ): Promise<boolean> {
    // Convertir lead a EmailTemplateData
    const templateData: EmailTemplateData = {
      contactInfo: {
        name: lead.name,
        email: lead.email,
        company: lead.company,
      },
      diagnosticData: lead.diagnosticData,
    };

    // Obtener la función del template
    const templateFunction = EmailTemplates[emailConfig.template];
    if (!templateFunction) {
      console.error(`❌ Template no encontrado: ${emailConfig.template}`);
      return false;
    }

    // Personalizar subject
    const personalizedSubject = emailConfig.subject
      .replace(/\$\{company\}/g, lead.company)
      .replace(/\$\{name\}/g, lead.name);

    console.log(
      `📧 Enviando ${emailConfig.template} a ${lead.email} (día ${emailConfig.day})`
    );

    return this.emailService.sendWithTemplate(
      templateData,
      templateFunction,
      personalizedSubject,
      {
        priority: emailConfig.priority,
        campaign: sequence.id,
        leadId: lead.id,
      }
    );
  }

  private async markEmailSent(
    lead: Lead,
    emailConfig: EmailConfig,
    sequence: SequenceConfig
  ): Promise<void> {
    const emailKey = `${sequence.id}_day_${emailConfig.day}`;
    lead.emailsSent.push(emailKey);

    // En producción, actualizar en base de datos
    console.log(
      `✅ Email marcado como enviado: ${emailKey} para ${lead.email}`
    );
  }

  // Métodos de gestión de leads
  async pauseSequenceForLead(leadId: string, reason: string): Promise<boolean> {
    try {
      if (this.isPostgres) {
        await (this.database as LeadDatabasePostgres).pauseSequenceAsync(
          leadId,
          reason
        );
      } else {
        (this.database as LeadDatabase).pauseSequence(leadId, reason);
      }
      console.log(`⏸️ Pausando secuencias para lead ${leadId}: ${reason}`);
      return true;
    } catch (error) {
      console.error(`❌ Error pausando secuencias para ${leadId}:`, error);
      return false;
    }
  }

  async resumeSequenceForLead(leadId: string): Promise<boolean> {
    try {
      if (this.isPostgres) {
        await (this.database as LeadDatabasePostgres).resumeSequenceAsync(
          leadId
        );
      } else {
        (this.database as LeadDatabase).resumeSequence(leadId);
      }
      console.log(`▶️ Reanudando secuencias para lead ${leadId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error reanudando secuencias para ${leadId}:`, error);
      return false;
    }
  }

  async markLeadAsResponded(
    leadId: string,
    responseType: string = "email"
  ): Promise<boolean> {
    try {
      this.metrics.responsesReceived++;

      if (responseType === "meeting") {
        this.metrics.meetingsScheduled++;
      }

      // Pause sequence when lead responds
      if (this.isPostgres) {
        await (this.database as LeadDatabasePostgres).pauseSequenceAsync(
          leadId,
          `Lead responded via ${responseType}`
        );
      } else {
        (this.database as LeadDatabase).pauseSequence(
          leadId,
          `Lead responded via ${responseType}`
        );
      }

      console.log(`✅ Lead ${leadId} marcado como respondido: ${responseType}`);
      return true;
    } catch (error) {
      console.error(`❌ Error marcando respuesta para ${leadId}:`, error);
      return false;
    }
  }

  // Métodos auxiliares
  private calculateDaysSince(date: Date): number {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  private hasResponded(lead: Lead): boolean {
    return lead.lastResponse !== undefined;
  }

  private hasRespondedRecently(lead: Lead, days: number): boolean {
    if (!lead.lastResponse) return false;
    const daysSinceResponse = this.calculateDaysSince(lead.lastResponse);
    return daysSinceResponse <= days;
  }

  private async getActiveLeads(): Promise<Lead[]> {
    if (!this.database) return [];

    if (this.isPostgres) {
      const pgDb = this.database as LeadDatabasePostgres;
      const leads = await pgDb.getActiveLeadsAsync();
      return leads.map((ld) => {
        const lead: Lead = {
          id: ld.id,
          email: ld.email,
          name: ld.name,
          company: ld.company || "",
          diagnosticDate: new Date(ld.diagnosticDate),
          meetingScheduled: false,
          meetingAttended: false,
          emailsSent: ld.emailsSent,
          sequencePaused: ld.sequencePaused,
          ...(ld.pauseReason ? { pauseReason: ld.pauseReason } : {}),
          diagnosticData: {
            score: ld.diagnosticData.score,
            level: ld.diagnosticData.level,
            primaryChallenge: ld.diagnosticData.recommendations[0] || "",
            quickWins: ld.diagnosticData.recommendations.map((r) => ({
              action: r,
              description: "",
            })),
            estimatedROI: {
              timeToValue: 0,
              expectedReturn: 0,
            },
          },
        };
        return lead;
      });
    }

    const sqliteDb = this.database as LeadDatabase;
    const leads = sqliteDb.getActiveLeads();
    return leads.map((ld) => {
      const lead: Lead = {
        id: ld.id,
        email: ld.email,
        name: ld.name,
        company: ld.company || "",
        diagnosticDate: new Date(ld.diagnosticDate),
        meetingScheduled: false,
        meetingAttended: false,
        emailsSent: ld.emailsSent,
        sequencePaused: ld.sequencePaused,
        ...(ld.pauseReason ? { pauseReason: ld.pauseReason } : {}),
        diagnosticData: {
          score: ld.diagnosticData.score,
          level: ld.diagnosticData.level,
          primaryChallenge: ld.diagnosticData.recommendations[0] || "",
          quickWins: ld.diagnosticData.recommendations.map((r) => ({
            action: r,
            description: "",
          })),
          estimatedROI: {
            timeToValue: 0,
            expectedReturn: 0,
          },
        },
      };
      return lead;
    });
  }

  private async sendDailyReport(): Promise<void> {
    const reportHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #223979;">📊 Reporte Diario - Sistema de Secuencias</h2>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px;">
          <h3>Métricas del Día</h3>
          <ul>
            <li><strong>Emails enviados:</strong> ${this.metrics.emailsSent}</li>
            <li><strong>Emails fallidos:</strong> ${this.metrics.emailsFailed}</li>
            <li><strong>Tasa de éxito:</strong> ${this.calculateSuccessRate()}%</li>
            <li><strong>Respuestas recibidas:</strong> ${this.metrics.responsesReceived}</li>
          </ul>
        </div>
      </div>
    `;

    await this.emailService.sendEmail({
      to: getInternalEmail(),
      subject: "📈 Reporte Diario - Sistema de Secuencias",
      html: reportHtml,
      campaign: "daily_report",
    });
  }

  private async sendErrorAlert(error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack =
      error instanceof Error ? error.stack : "No stack trace available";

    const errorHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">🚨 Error Crítico - Sistema de Secuencias</h2>
        <div style="background: #fef2f2; padding: 20px; border-radius: 8px; border: 1px solid #fecaca;">
          <p><strong>Error:</strong> ${errorMessage}</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <pre style="background: #f3f4f4; padding: 10px; border-radius: 5px; overflow-x: auto;">
${errorStack}
          </pre>
          <p style="color: #dc2626;">⚠️ Revisa el sistema inmediatamente.</p>
        </div>
      </div>
    `;

    await this.emailService.sendEmail({
      to: getInternalEmail(),
      subject: "🚨 Error Crítico - Sistema de Secuencias",
      html: errorHtml,
      priority: "high",
      campaign: "error_alert",
    });
  }

  // Métricas y estadísticas
  getMetrics(): SequenceMetrics {
    return { ...this.metrics };
  }

  private calculateSuccessRate(): string {
    if (this.metrics.emailsSent === 0) return "0";
    const rate =
      ((this.metrics.emailsSent - this.metrics.emailsFailed) /
        this.metrics.emailsSent) *
      100;
    return rate.toFixed(1);
  }

  resetMetrics() {
    this.metrics = {
      totalLeads: 0,
      emailsSent: 0,
      emailsFailed: 0,
      responsesReceived: 0,
      meetingsScheduled: 0,
      conversions: 0,
      sequenceCompletions: 0,
    };
  }

  // Testing
  async testSequence(
    testEmail: string,
    sequenceId: string = "diagnostic_followup"
  ): Promise<boolean> {
    const testLead: Lead = {
      id: "test_lead_" + Date.now(),
      email: testEmail,
      name: "Usuario de Prueba",
      company: "Empresa Test",
      diagnosticDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 días atrás
      meetingScheduled: false,
      meetingAttended: false,
      emailsSent: [],
      sequencePaused: false,
      diagnosticData: {
        score: 3,
        level: "Inicial",
        primaryChallenge: "Organización de datos",
        quickWins: [
          { action: "Dashboard básico", description: "Test quick win" },
        ],
        estimatedROI: {
          timeToValue: 30,
          expectedReturn: 200,
        },
      },
    };

    console.log(`🧪 Testing secuencia ${sequenceId} para ${testEmail}`);

    const results = await this.processLeadSequences(testLead);
    console.log(
      `✅ Test completado: ${results.sent} enviados, ${results.failed} fallidos`
    );

    return results.sent > 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Instancia singleton
let sequenceManagerInstance: SequenceManager | null = null;

export const getSequenceManager = (): SequenceManager => {
  if (!sequenceManagerInstance) {
    sequenceManagerInstance = new SequenceManager();
  }
  return sequenceManagerInstance;
};

export const createSequenceManager = (
  emailService?: EmailService
): SequenceManager => {
  return new SequenceManager(emailService);
};

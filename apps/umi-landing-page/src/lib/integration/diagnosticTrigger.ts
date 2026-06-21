// src/lib/integration/diagnosticTrigger.ts
import { getSequenceManager } from "../email/sequenceManager";
import {
  LeadDatabase,
  DiagnosticData,
  LeadData,
  EmailLog,
} from "../database/sqlite";
import {
  LeadDatabasePostgres,
  getLeadDatabasePostgres,
} from "../database/postgres";
import { v4 as uuidv4 } from "uuid";

// Interface para el resultado del procesamiento
export interface ProcessDiagnosticResult {
  isNewLead: boolean;
  leadId: string;
  emailsToSend: Array<{
    template: string;
    day: number;
    subject: string;
  }>;
  message: string;
}

// Interface para métricas
export interface DiagnosticMetrics {
  totalLeads: number;
  activeSequences: number;
  emailsSent: number;
}

// Interface para el resultado de emails programados
export interface ScheduledEmailsResult {
  processed: number;
  sent: number;
  failed: number;
}

// Interface para submission de diagnóstico - EXPORTADA
export interface DiagnosticSubmission {
  email: string;
  name: string;
  company?: string;
  diagnosticResult: {
    score: number;
    level: string;
    recommendations: string[];
    areas: {
      dataCollection: number;
      analysis: number;
      visualization: number;
      decisionMaking: number;
    };
  };
  submissionDate: string;
}

// Union type for either database adapter
type AnyLeadDatabase = LeadDatabase | LeadDatabasePostgres;

export class DiagnosticTrigger {
  private database: AnyLeadDatabase;
  private isPostgres: boolean;
  private sequenceManager: unknown;

  constructor(database?: AnyLeadDatabase) {
    if (database) {
      this.database = database;
      this.isPostgres = database instanceof LeadDatabasePostgres;
    } else {
      const dbType = process.env.DATABASE_TYPE || "sqlite";
      if (dbType === "postgres") {
        this.database = getLeadDatabasePostgres();
        this.isPostgres = true;
      } else {
        this.database = new LeadDatabase();
        this.isPostgres = false;
      }
    }
    this.sequenceManager = getSequenceManager();
  }

  // ---- Async wrappers that normalize sync vs async adapters ----

  private async findLeadByEmail(email: string): Promise<LeadData | null> {
    if (this.isPostgres) {
      return (this.database as LeadDatabasePostgres).findLeadByEmailAsync(email);
    }
    return (this.database as LeadDatabase).findLeadByEmail(email);
  }

  private async upsertLead(leadData: LeadData): Promise<LeadData> {
    if (this.isPostgres) {
      return (this.database as LeadDatabasePostgres).upsertLeadAsync(leadData);
    }
    return (this.database as LeadDatabase).upsertLead(leadData);
  }

  private async wasEmailSent(
    leadId: string,
    sequenceDay: number
  ): Promise<boolean> {
    if (this.isPostgres) {
      return (this.database as LeadDatabasePostgres).wasEmailSentAsync(
        leadId,
        sequenceDay
      );
    }
    return (this.database as LeadDatabase).wasEmailSent(leadId, sequenceDay);
  }

  private async logEmailSent(emailLog: EmailLog): Promise<void> {
    if (this.isPostgres) {
      return (this.database as LeadDatabasePostgres).logEmailSentAsync(emailLog);
    }
    return (this.database as LeadDatabase).logEmailSent(emailLog);
  }

  private async getDaysElapsed(leadId: string): Promise<number> {
    if (this.isPostgres) {
      return (this.database as LeadDatabasePostgres).getDaysElapsedAsync(leadId);
    }
    return (this.database as LeadDatabase).getDaysElapsed(leadId);
  }

  private async getLeadsPendingEmails(): Promise<
    (LeadData & { daysElapsed: number })[]
  > {
    if (this.isPostgres) {
      return (
        this.database as LeadDatabasePostgres
      ).getLeadsPendingEmailsAsync();
    }
    return (this.database as LeadDatabase).getLeadsPendingEmails();
  }

  // -----------------------------------------------------------------------
  // processDiagnostic
  // -----------------------------------------------------------------------
  async processDiagnostic(
    submission: DiagnosticSubmission
  ): Promise<ProcessDiagnosticResult> {
    try {
      this.validateSubmission(submission);

      const existingLead = await this.findLeadByEmail(submission.email);

      if (existingLead) {
        return await this.updateExistingLead(existingLead, submission);
      } else {
        return await this.createNewLead(submission);
      }
    } catch (error) {
      console.error("❌ Error procesando diagnóstico:", error);
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // createNewLead
  // -----------------------------------------------------------------------
  private async createNewLead(
    submission: DiagnosticSubmission
  ): Promise<ProcessDiagnosticResult> {
    const leadId = uuidv4();

    const diagnosticData: DiagnosticData = {
      score: submission.diagnosticResult.score,
      level: submission.diagnosticResult.level,
      recommendations: submission.diagnosticResult.recommendations,
      areas: submission.diagnosticResult.areas,
    };

    const newLead: LeadData = {
      id: leadId,
      email: submission.email,
      name: submission.name,
      diagnosticDate: submission.submissionDate,
      emailsSent: [],
      sequencePaused: false,
      diagnosticData,
    };

    if (submission.company) {
      newLead.company = submission.company;
    }

    await this.upsertLead(newLead);

    const daysElapsed = await this.getDaysElapsed(leadId);
    const allEmails = this.calculateEmailsToSend(newLead);

    // Fresh submissions send only the immediate welcome email. Short backfills
    // can catch up on delayed follow-ups; very old imports restart at welcome.
    const emailsToSend =
      daysElapsed > 2 && daysElapsed <= 10
        ? allEmails.filter((email) => email.day > 0)
        : allEmails.filter((email) => email.day === 0);

    await this.sendScheduledEmails(leadId, emailsToSend);

    return {
      isNewLead: true,
      leadId,
      emailsToSend,
      message: `Nuevo lead creado. ${emailsToSend.length} emails programados.`,
    };
  }

  // -----------------------------------------------------------------------
  // updateExistingLead
  // -----------------------------------------------------------------------
  private async updateExistingLead(
    existingLead: LeadData,
    submission: DiagnosticSubmission
  ): Promise<ProcessDiagnosticResult> {
    const updatedDiagnosticData: DiagnosticData = {
      score: submission.diagnosticResult.score,
      level: submission.diagnosticResult.level,
      recommendations: submission.diagnosticResult.recommendations,
      areas: submission.diagnosticResult.areas,
    };

    const updatedLead: LeadData = {
      id: existingLead.id,
      email: existingLead.email,
      name: submission.name,
      diagnosticDate: existingLead.diagnosticDate,
      emailsSent: existingLead.emailsSent,
      sequencePaused: existingLead.sequencePaused,
      diagnosticData: updatedDiagnosticData,
    };

    if (submission.company) {
      updatedLead.company = submission.company;
    } else if (existingLead.company) {
      updatedLead.company = existingLead.company;
    }

    if (existingLead.lastEmailSent) {
      updatedLead.lastEmailSent = existingLead.lastEmailSent;
    }
    if (existingLead.pauseReason) {
      updatedLead.pauseReason = existingLead.pauseReason;
    }
    if (existingLead.createdAt) {
      updatedLead.createdAt = existingLead.createdAt;
    }
    if (existingLead.updatedAt) {
      updatedLead.updatedAt = existingLead.updatedAt;
    }

    await this.upsertLead(updatedLead);

    const emailsToSend = this.calculateEmailsToSend(updatedLead);

    return {
      isNewLead: false,
      leadId: existingLead.id,
      emailsToSend,
      message: `Lead actualizado. ${emailsToSend.length} emails enviados.`,
    };
  }

  // -----------------------------------------------------------------------
  // calculateEmailsToSend
  // -----------------------------------------------------------------------
  private calculateEmailsToSend(lead: LeadData): Array<{
    template: string;
    day: number;
    subject: string;
  }> {
    // Use sync method for calculation (both adapters support it)
    const daysElapsed = this.isPostgres
      ? 0
      : (this.database as LeadDatabase).getDaysElapsed(lead.id);
    const emailsToSend: Array<{ template: string; day: number; subject: string }> =
      [];

    const emailSequence = [
      { day: 0, template: "diagnostic_welcome", subject: "Bienvenida" },
      { day: 2, template: "diagnostic_followup_1", subject: "Seguimiento 1" },
      { day: 5, template: "diagnostic_followup_2", subject: "Seguimiento 2" },
      { day: 10, template: "diagnostic_followup_3", subject: "Seguimiento 3" },
    ];

    for (const emailConfig of emailSequence) {
      // For postgres we can't check synchronously — handled at send time
      if (
        daysElapsed >= emailConfig.day ||
        this.isPostgres
      ) {
        emailsToSend.push(emailConfig);
      }
    }

    return emailsToSend;
  }

  // -----------------------------------------------------------------------
  // calculatePendingEmails
  // -----------------------------------------------------------------------
  private calculatePendingEmails(lead: LeadData): Array<{
    template: string;
    day: number;
    subject: string;
  }> {
    const daysElapsed = this.isPostgres
      ? 999
      : (this.database as LeadDatabase).getDaysElapsed(lead.id);
    const emailsToSend: Array<{ template: string; day: number; subject: string }> =
      [];

    const emailSequence = [
      { day: 0, template: "diagnostic_welcome", subject: "Bienvenida" },
      { day: 2, template: "diagnostic_followup_1", subject: "Seguimiento 1" },
      { day: 5, template: "diagnostic_followup_2", subject: "Seguimiento 2" },
      { day: 10, template: "diagnostic_followup_3", subject: "Seguimiento 3" },
    ];

    for (const emailConfig of emailSequence) {
      if (
        daysElapsed >= emailConfig.day ||
        this.isPostgres
      ) {
        emailsToSend.push(emailConfig);
      }
    }

    return emailsToSend;
  }

  // -----------------------------------------------------------------------
  // sendScheduledEmails
  // -----------------------------------------------------------------------
  private async sendScheduledEmails(
    leadId: string,
    emails: Array<{ template: string; day: number; subject: string }>
  ): Promise<void> {
    for (const email of emails) {
      try {
        await this.logEmailSent({
          leadId,
          templateName: email.template,
          sequenceDay: email.day,
          subject: email.subject,
          status: "sent",
        });

        console.log(
          `📧 Email enviado: ${email.template} (Day ${email.day}) para lead ${leadId}`
        );
      } catch (error) {
        console.error(`❌ Error enviando email ${email.template}:`, error);

        await this.logEmailSent({
          leadId,
          templateName: email.template,
          sequenceDay: email.day,
          subject: email.subject,
          status: "failed",
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // processScheduledEmails
  // -----------------------------------------------------------------------
  async processScheduledEmails(): Promise<ScheduledEmailsResult> {
    try {
      const pendingLeads = await this.getLeadsPendingEmails();
      let processed = 0;
      let sent = 0;
      let failed = 0;

      console.log(`🔍 Procesando ${pendingLeads.length} leads pendientes`);

      for (const lead of pendingLeads) {
        const emailsToSend = this.calculatePendingEmails(lead);

        if (emailsToSend.length > 0) {
          processed++;

          try {
            await this.sendScheduledEmails(lead.id, emailsToSend);
            sent += emailsToSend.length;
          } catch (error) {
            failed++;
            console.error(`❌ Error procesando lead ${lead.id}:`, error);
          }
        }
      }

      console.log(
        `📊 Resumen: ${processed} procesados, ${sent} enviados, ${failed} fallidos`
      );
      return { processed, sent, failed };
    } catch (error) {
      console.error("❌ Error en processScheduledEmails:", error);
      return { processed: 0, sent: 0, failed: 0 };
    }
  }

  // -----------------------------------------------------------------------
  // getMetrics
  // -----------------------------------------------------------------------
  getMetrics(): DiagnosticMetrics {
    try {
      const dbMetrics = (this.database as LeadDatabase).getMetrics();

      return {
        totalLeads: dbMetrics.totalLeads,
        activeSequences: dbMetrics.activeSequences,
        emailsSent: dbMetrics.emailsSentToday,
      };
    } catch (error) {
      console.error("❌ Error obteniendo métricas:", error);
      return {
        totalLeads: 0,
        activeSequences: 0,
        emailsSent: 0,
      };
    }
  }

  // -----------------------------------------------------------------------
  // validateSubmission
  // -----------------------------------------------------------------------
  private validateSubmission(submission: DiagnosticSubmission): void {
    if (!submission.email || !this.isValidEmail(submission.email)) {
      throw new Error("Email inválido");
    }

    if (!submission.name || submission.name.trim().length === 0) {
      throw new Error("Nombre requerido");
    }

    if (
      !submission.submissionDate ||
      !this.isValidDate(submission.submissionDate)
    ) {
      throw new Error("Fecha de submisión inválida");
    }

    if (
      !submission.diagnosticResult ||
      typeof submission.diagnosticResult.score !== "number"
    ) {
      throw new Error("Resultado de diagnóstico inválido");
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isValidDate(dateString: string): boolean {
    const date = new Date(dateString);
    return !isNaN(date.getTime());
  }

  close(): void {
    this.database.close();
  }
}

// Instancia singleton para uso en la aplicación
let diagnosticTriggerInstance: DiagnosticTrigger | null = null;

export const getDiagnosticTrigger = (): DiagnosticTrigger => {
  if (!diagnosticTriggerInstance) {
    diagnosticTriggerInstance = new DiagnosticTrigger();
  }
  return diagnosticTriggerInstance;
};

export const createDiagnosticTrigger = (
  database?: AnyLeadDatabase
): DiagnosticTrigger => {
  return new DiagnosticTrigger(database);
};

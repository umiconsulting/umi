// src/lib/database/postgres.ts
// PostgreSQL adapter for landing page leads — async-only interface for Postgres.
// The diagnosticTrigger selects between this and the SQLite adapter via DATABASE_TYPE env.
import { createClient } from "@supabase/supabase-js";

// Re-export the shared interfaces from sqlite.ts so consumers don't
// need to know which adapter is active.
export type {
  DiagnosticData,
  LeadData,
  EmailLog,
  LeadMetrics,
} from "./sqlite";
import type { DiagnosticData, LeadData, EmailLog, LeadMetrics } from "./sqlite";

// ---------------------------------------------------------------------------
// Row shapes coming from Postgres (snake_case)
// ---------------------------------------------------------------------------
interface LeadRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  company: string | null;
  role_title: string | null;
  consent_state: string | null;
  lifecycle_status: string;
  diagnostic_data: DiagnosticData | null;
  diagnostic_date: string;
  first_contact_channel: string | null;
  first_contact_campaign: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
  landing_path: string | null;
  submitted_form: string | null;
  source_app: string;
  first_contact_at: string;
  sequence_paused: boolean;
  pause_reason: string | null;
  emails_sent: string[];
  last_email_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LeadEventRow {
  id: string;
  lead_id: string;
  event_type: string;
  event_data: Record<string, unknown> | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------
function leadRowToLeadData(row: LeadRow): LeadData {
  const lead: LeadData = {
    id: row.id,
    email: row.email,
    name: row.name,
    diagnosticDate: row.diagnostic_date,
    emailsSent: row.emails_sent || [],
    sequencePaused: row.sequence_paused,
    diagnosticData: row.diagnostic_data || {
      score: 0,
      level: "Inicial",
      recommendations: [],
      areas: { dataCollection: 0, analysis: 0, visualization: 0, decisionMaking: 0 },
    },
  };
  if (row.company) lead.company = row.company;
  if (row.last_email_sent_at) lead.lastEmailSent = row.last_email_sent_at;
  if (row.pause_reason) lead.pauseReason = row.pause_reason;
  if (row.created_at) lead.createdAt = row.created_at;
  if (row.updated_at) lead.updatedAt = row.updated_at;
  return lead;
}

// ---------------------------------------------------------------------------
// LeadDatabasePostgres — async-only Postgres adapter
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientAny = any;

export class LeadDatabasePostgres {
  private supabase: SupabaseClientAny;

  constructor(supabaseClient?: SupabaseClientAny) {
    if (supabaseClient) {
      this.supabase = supabaseClient;
    } else {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new Error(
          "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Postgres adapter"
        );
      }
      this.supabase = createClient(url, key, {
        db: { schema: "platform" },
      });
    }
  }

  // -----------------------------------------------------------------------
  // findLeadByEmailAsync
  // -----------------------------------------------------------------------
  async findLeadByEmailAsync(email: string): Promise<LeadData | null> {
    const { data, error } = await this.supabase
      .from("leads")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("❌ Error buscando lead por email:", error);
      return null;
    }
    if (!data) return null;
    return leadRowToLeadData(data as LeadRow);
  }

  // -----------------------------------------------------------------------
  // upsertLeadAsync
  // -----------------------------------------------------------------------
  async upsertLeadAsync(leadData: LeadData): Promise<LeadData> {
    const existing = await this.findLeadByEmailAsync(leadData.email);

    const row = {
      email: leadData.email,
      name: leadData.name,
      company: leadData.company ?? null,
      diagnostic_date: leadData.diagnosticDate,
      diagnostic_data: leadData.diagnosticData,
      sequence_paused: leadData.sequencePaused,
      pause_reason: leadData.pauseReason ?? null,
      emails_sent: leadData.emailsSent,
      last_email_sent_at: leadData.lastEmailSent ?? null,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await this.supabase
        .from("leads")
        .update(row)
        .eq("email", leadData.email);

      if (error) {
        console.error("❌ Error actualizando lead:", error);
        throw error;
      }
    } else {
      const insertRow = {
        ...row,
        id: leadData.id,
        created_at: leadData.createdAt || new Date().toISOString(),
      };
      const { error } = await this.supabase
        .from("leads")
        .insert(insertRow);

      if (error) {
        console.error("❌ Error creando lead:", error);
        throw error;
      }
    }

    const result = await this.findLeadByEmailAsync(leadData.email);
    if (!result) {
      throw new Error("Error: No se pudo recuperar el lead después de upsert");
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // wasEmailSentAsync
  // -----------------------------------------------------------------------
  async wasEmailSentAsync(
    leadId: string,
    sequenceDay: number
  ): Promise<boolean> {
    const { count, error } = await this.supabase
      .from("lead_events")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("event_type", "email_sent")
      .eq("event_data->>sequence_day", String(sequenceDay));

    if (error) {
      console.error("❌ Error verificando email enviado:", error);
      return false;
    }
    return (count ?? 0) > 0;
  }

  // -----------------------------------------------------------------------
  // logEmailSentAsync
  // -----------------------------------------------------------------------
  async logEmailSentAsync(emailLog: EmailLog): Promise<void> {
    const { error } = await this.supabase
      .from("lead_events")
      .insert({
        lead_id: emailLog.leadId,
        event_type: emailLog.status === "failed" ? "email_failed" : "email_sent",
        event_data: {
          template_name: emailLog.templateName,
          sequence_day: emailLog.sequenceDay,
          subject: emailLog.subject,
          status: emailLog.status,
        },
      });

    if (error) {
      console.error("❌ Error registrando email enviado:", error);
      throw error;
    }

    // Also update last_email_sent_at on the lead
    const emailKey = `${emailLog.templateName}_day_${emailLog.sequenceDay}`;
    await this.supabase
      .from("leads")
      .update({
        last_email_sent_at: emailLog.sentAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", emailLog.leadId);

    // Append to emails_sent array
    await this.supabase.rpc("append_to_array", {
      table_name: "leads",
      column_name: "emails_sent",
      row_id: emailLog.leadId,
      value: emailKey,
    }).maybeSingle();
  }

  // -----------------------------------------------------------------------
  // getDaysElapsedAsync
  // -----------------------------------------------------------------------
  async getDaysElapsedAsync(leadId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from("leads")
      .select("diagnostic_date")
      .eq("id", leadId)
      .maybeSingle();

    if (error || !data) {
      console.error("❌ Error calculando días transcurridos:", error);
      return 0;
    }

    const row = data as { diagnostic_date: string };
    const diagnosticDate = new Date(row.diagnostic_date);
    const today = new Date();
    const diffTime = today.getTime() - diagnosticDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  // -----------------------------------------------------------------------
  // getLeadsPendingEmailsAsync
  // -----------------------------------------------------------------------
  async getLeadsPendingEmailsAsync(): Promise<
    (LeadData & { daysElapsed: number })[]
  > {
    const { data, error } = await this.supabase
      .from("leads")
      .select("*")
      .eq("sequence_paused", false)
      .order("diagnostic_date", { ascending: true });

    if (error) {
      console.error("❌ Error obteniendo leads pendientes:", error);
      return [];
    }

    const rows = (data || []) as LeadRow[];
    return rows.map((row) => {
      const lead = leadRowToLeadData(row);
      const diagnosticDate = new Date(row.diagnostic_date);
      const diffTime = Date.now() - diagnosticDate.getTime();
      return {
        ...lead,
        daysElapsed: Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24))),
      };
    });
  }

  // -----------------------------------------------------------------------
  // getMetricsAsync
  // -----------------------------------------------------------------------
  async getMetricsAsync(): Promise<LeadMetrics> {
    const { count: totalLeads } = await this.supabase
      .from("leads")
      .select("*", { count: "exact", head: true });

    const { count: activeSequences } = await this.supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("sequence_paused", false);

    const { count: pausedSequences } = await this.supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("sequence_paused", true);

    const today = new Date().toISOString().split("T")[0];
    const { count: emailsSentToday } = await this.supabase
      .from("lead_events")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "email_sent")
      .gte("created_at", today);

    return {
      totalLeads: totalLeads ?? 0,
      emailsSentToday: emailsSentToday ?? 0,
      emailsSentThisWeek: (emailsSentToday ?? 0) * 7,
      emailsSentThisMonth: (emailsSentToday ?? 0) * 30,
      activeSequences: activeSequences ?? 0,
      pausedSequences: pausedSequences ?? 0,
      conversionRate: 0,
    };
  }

  // -----------------------------------------------------------------------
  // pauseSequenceAsync
  // -----------------------------------------------------------------------
  async pauseSequenceAsync(leadId: string, reason?: string): Promise<void> {
    const { error: updateError } = await this.supabase
      .from("leads")
      .update({
        sequence_paused: true,
        pause_reason: reason || "Pausado manualmente",
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    if (updateError) {
      console.error("❌ Error pausando secuencia:", updateError);
      throw updateError;
    }

    await this.supabase
      .from("lead_events")
      .insert({
        lead_id: leadId,
        event_type: "sequence_paused",
        event_data: { reason: reason || "Pausado manualmente" },
      });
  }

  // -----------------------------------------------------------------------
  // resumeSequenceAsync
  // -----------------------------------------------------------------------
  async resumeSequenceAsync(leadId: string): Promise<void> {
    const { error } = await this.supabase
      .from("leads")
      .update({
        sequence_paused: false,
        pause_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    if (error) {
      console.error("❌ Error reanudando secuencia:", error);
      throw error;
    }

    await this.supabase
      .from("lead_events")
      .insert({
        lead_id: leadId,
        event_type: "sequence_resumed",
      });

    console.log(`✅ Secuencia reanudada para lead ${leadId}`);
  }

  // -----------------------------------------------------------------------
  // getLeadEmailLogsAsync
  // -----------------------------------------------------------------------
  async getLeadEmailLogsAsync(leadId: string): Promise<EmailLog[]> {
    const { data, error } = await this.supabase
      .from("lead_events")
      .select("*")
      .eq("lead_id", leadId)
      .in("event_type", ["email_sent", "email_failed"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Error obteniendo logs del lead:", error);
      return [];
    }

    return ((data || []) as LeadEventRow[]).map((row) => {
      const ed = row.event_data || {};
      const log: EmailLog = {
        leadId: row.lead_id,
        templateName: (ed.template_name as string) || "",
        sequenceDay: (ed.sequence_day as number) || 0,
        sentAt: row.created_at,
        status:
          row.event_type === "email_failed"
            ? ("failed" as const)
            : ("sent" as const),
      };
      if ((ed.subject as string)) log.subject = ed.subject as string;
      return log;
    });
  }

  // -----------------------------------------------------------------------
  // findLeadByIdAsync
  // -----------------------------------------------------------------------
  async findLeadByIdAsync(id: string): Promise<LeadData | null> {
    const { data, error } = await this.supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("❌ Error buscando lead por ID:", error);
      return null;
    }
    if (!data) return null;
    return leadRowToLeadData(data as LeadRow);
  }

  // -----------------------------------------------------------------------
  // getActiveLeadsAsync
  // -----------------------------------------------------------------------
  async getActiveLeadsAsync(): Promise<LeadData[]> {
    const { data, error } = await this.supabase
      .from("leads")
      .select("*")
      .eq("sequence_paused", false)
      .order("diagnostic_date", { ascending: false });

    if (error) {
      console.error("❌ Error obteniendo leads activos:", error);
      return [];
    }

    return ((data || []) as LeadRow[]).map(leadRowToLeadData);
  }

  // -----------------------------------------------------------------------
  // close
  // -----------------------------------------------------------------------
  close(): void {
    // Supabase client is stateless — no connection to close.
    console.log("✅ Conexión a base de datos cerrada (Supabase — no-op)");
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------
let postgresInstance: LeadDatabasePostgres | null = null;

export function getLeadDatabasePostgres(): LeadDatabasePostgres {
  if (!postgresInstance) {
    postgresInstance = new LeadDatabasePostgres();
  }
  return postgresInstance;
}

export function createLeadDatabasePostgres(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any
): LeadDatabasePostgres {
  return new LeadDatabasePostgres(client);
}

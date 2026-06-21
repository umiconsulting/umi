// src/lib/database/sqlite.ts
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";

// AGREGAR: Interface DiagnosticData tipada
export interface DiagnosticData {
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

// ACTUALIZAR: LeadData con DiagnosticData tipada
export interface LeadData {
  id: string;
  email: string;
  name: string;
  company?: string; // CAMBIO: De string a string | undefined para exactOptionalPropertyTypes
  diagnosticDate: string;
  lastEmailSent?: string;
  emailsSent: string[]; // Array of email template names
  sequencePaused: boolean;
  pauseReason?: string;
  diagnosticData: DiagnosticData; // CAMBIO: De Record<string, any> a DiagnosticData
  createdAt?: string;
  updatedAt?: string;
}

export interface EmailLog {
  id?: number;
  leadId: string;
  templateName: string;
  sequenceDay: number;
  sentAt?: string;
  subject?: string;
  status: "sent" | "failed" | "pending";
}

export interface LeadMetrics {
  totalLeads: number;
  emailsSentToday: number;
  emailsSentThisWeek: number;
  emailsSentThisMonth: number;
  activeSequences: number;
  pausedSequences: number;
  conversionRate: number;
}

export class LeadDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    // Crear directorio data si no existe
    const dataDir = path.join(process.cwd(), "data");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = process.env.DATABASE_PATH || path.join(dataDir, "leads.db");
    this.db = new Database(this.dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    try {
      // Crear tabla de leads
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS leads (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          company TEXT,
          diagnosticDate TEXT NOT NULL,
          lastEmailSent TEXT,
          emailsSent TEXT DEFAULT '[]',
          sequencePaused BOOLEAN DEFAULT 0,
          pauseReason TEXT,
          diagnosticData TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Crear tabla de logs de emails
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS email_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          leadId TEXT NOT NULL,
          templateName TEXT NOT NULL,
          sequenceDay INTEGER NOT NULL,
          sentAt TEXT DEFAULT CURRENT_TIMESTAMP,
          subject TEXT,
          status TEXT DEFAULT 'sent',
          FOREIGN KEY (leadId) REFERENCES leads (id)
        )
      `);

      // Crear índices para optimizar consultas
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
        CREATE INDEX IF NOT EXISTS idx_leads_diagnostic_date ON leads(diagnosticDate);
        CREATE INDEX IF NOT EXISTS idx_email_logs_lead_id ON email_logs(leadId);
        CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sentAt);
      `);

      console.log("✅ Base de datos SQLite inicializada correctamente");
    } catch (error) {
      console.error("❌ Error inicializando base de datos:", error);
      throw error;
    }
  }

  /**
   * Buscar lead por email
   */
  findLeadByEmail(email: string): LeadData | null {
    try {
      const stmt = this.db.prepare("SELECT * FROM leads WHERE email = ?");
      const row = stmt.get(email) as Record<string, unknown>;

      if (!row) return null;

      // Construir objeto base requerido
      const leadData: LeadData = {
        id: row.id as string,
        email: row.email as string,
        name: row.name as string,
        diagnosticDate: row.diagnosticDate as string,
        emailsSent: JSON.parse((row.emailsSent as string) || "[]"),
        sequencePaused: Boolean(row.sequencePaused),
        diagnosticData: JSON.parse((row.diagnosticData as string) || "{}"),
      };

      // Añadir propiedades opcionales solo si existen
      if (row.company) {
        leadData.company = row.company as string;
      }
      if (row.lastEmailSent) {
        leadData.lastEmailSent = row.lastEmailSent as string;
      }
      if (row.pauseReason) {
        leadData.pauseReason = row.pauseReason as string;
      }
      if (row.createdAt) {
        leadData.createdAt = row.createdAt as string;
      }
      if (row.updatedAt) {
        leadData.updatedAt = row.updatedAt as string;
      }

      return leadData;
    } catch (error) {
      console.error("❌ Error buscando lead por email:", error);
      return null;
    }
  }

  /**
   * Crear o actualizar lead - DEBE retornar LeadData
   */
  upsertLead(leadData: LeadData): LeadData {
    try {
      const existingLead = this.findLeadByEmail(leadData.email);

      if (existingLead) {
        // Actualizar lead existente
        const stmt = this.db.prepare(`
          UPDATE leads 
          SET name = ?, company = ?, diagnosticDate = ?, diagnosticData = ?, updatedAt = CURRENT_TIMESTAMP
          WHERE email = ?
        `);

        stmt.run(
          leadData.name,
          leadData.company || null,
          leadData.diagnosticDate,
          JSON.stringify(leadData.diagnosticData),
          leadData.email
        );
      } else {
        // Crear nuevo lead
        const stmt = this.db.prepare(`
          INSERT INTO leads (id, email, name, company, diagnosticDate, emailsSent, sequencePaused, diagnosticData)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          leadData.id,
          leadData.email,
          leadData.name,
          leadData.company || null,
          leadData.diagnosticDate,
          JSON.stringify(leadData.emailsSent || []),
          leadData.sequencePaused ? 1 : 0,
          JSON.stringify(leadData.diagnosticData)
        );
      }

      // IMPORTANTE: Siempre retornar el lead actualizado
      const updatedLead = this.findLeadByEmail(leadData.email);
      if (!updatedLead) {
        throw new Error(
          "Error: No se pudo recuperar el lead después de upsert"
        );
      }

      return updatedLead;
    } catch (error) {
      console.error("❌ Error creando/actualizando lead:", error);
      throw error;
    }
  }

  /**
   * Verificar si un email específico fue enviado
   */
  wasEmailSent(leadId: string, sequenceDay: number): boolean {
    try {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM email_logs 
        WHERE leadId = ? AND sequenceDay = ? AND status = 'sent'
      `);

      const result = stmt.get(leadId, sequenceDay) as { count: number };
      return result.count > 0;
    } catch (error) {
      console.error("❌ Error verificando email enviado:", error);
      return false;
    }
  }

  /**
   * Registrar email enviado
   */
  logEmailSent(emailLog: EmailLog): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO email_logs (leadId, templateName, sequenceDay, subject, status)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        emailLog.leadId,
        emailLog.templateName,
        emailLog.sequenceDay,
        emailLog.subject || null,
        emailLog.status
      );
    } catch (error) {
      console.error("❌ Error registrando email enviado:", error);
      throw error;
    }
  }

  /**
   * Calcular días transcurridos desde el diagnóstico
   */
  getDaysElapsed(leadId: string): number {
    try {
      const stmt = this.db.prepare(
        "SELECT diagnosticDate FROM leads WHERE id = ?"
      );
      const result = stmt.get(leadId) as { diagnosticDate: string } | undefined;

      if (!result) return 0;

      const diagnosticDate = new Date(result.diagnosticDate);
      const today = new Date();

      // FIX: Usar Math.floor en lugar de Math.ceil para cálculo exacto
      const diffTime = today.getTime() - diagnosticDate.getTime(); // Remover Math.abs
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      return Math.max(0, diffDays); // Evitar días negativos
    } catch (error) {
      console.error("❌ Error calculando días transcurridos:", error);
      return 0;
    }
  }

  /**
   * Obtener leads pendientes de emails
   */
  getLeadsPendingEmails(): (LeadData & { daysElapsed: number })[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM leads 
        WHERE sequencePaused = 0
        ORDER BY diagnosticDate ASC
      `);

      const leads = stmt.all() as Record<string, unknown>[];

      return leads.map((row) => {
        // Construir LeadData base
        const leadData: LeadData = {
          id: row.id as string,
          email: row.email as string,
          name: row.name as string,
          diagnosticDate: row.diagnosticDate as string,
          emailsSent: JSON.parse((row.emailsSent as string) || "[]"),
          sequencePaused: Boolean(row.sequencePaused),
          diagnosticData: JSON.parse((row.diagnosticData as string) || "{}"),
        };

        // Añadir propiedades opcionales solo si existen
        if (row.company) {
          leadData.company = row.company as string;
        }
        if (row.lastEmailSent) {
          leadData.lastEmailSent = row.lastEmailSent as string;
        }
        if (row.pauseReason) {
          leadData.pauseReason = row.pauseReason as string;
        }
        if (row.createdAt) {
          leadData.createdAt = row.createdAt as string;
        }
        if (row.updatedAt) {
          leadData.updatedAt = row.updatedAt as string;
        }

        // Retornar con daysElapsed
        return {
          ...leadData,
          daysElapsed: this.getDaysElapsed(row.id as string),
        };
      });
    } catch (error) {
      console.error("❌ Error obteniendo leads pendientes:", error);
      return [];
    }
  }

  /**
   * Obtener métricas de la base de datos
   */
  getMetrics(): LeadMetrics {
    try {
      const totalLeadsStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM leads"
      );
      const totalLeads = (totalLeadsStmt.get() as { count: number }).count;

      const activeSequencesStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM leads WHERE sequencePaused = 0"
      );
      const activeSequences = (activeSequencesStmt.get() as { count: number })
        .count;

      const pausedSequencesStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM leads WHERE sequencePaused = 1"
      );
      const pausedSequences = (pausedSequencesStmt.get() as { count: number })
        .count;

      const today = new Date().toISOString().split("T")[0];
      const emailsTodayStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM email_logs WHERE DATE(sentAt) = ?"
      );
      const emailsSentToday = (emailsTodayStmt.get(today) as { count: number })
        .count;

      // Calcular emails de esta semana y mes (simplificado)
      const emailsSentThisWeek = emailsSentToday * 7; // Mock
      const emailsSentThisMonth = emailsSentToday * 30; // Mock

      return {
        totalLeads,
        emailsSentToday,
        emailsSentThisWeek,
        emailsSentThisMonth,
        activeSequences,
        pausedSequences,
        conversionRate: 0.15, // Mock - 15%
      };
    } catch (error) {
      console.error("❌ Error obteniendo métricas:", error);
      return {
        totalLeads: 0,
        emailsSentToday: 0,
        emailsSentThisWeek: 0,
        emailsSentThisMonth: 0,
        activeSequences: 0,
        pausedSequences: 0,
        conversionRate: 0,
      };
    }
  }

  /**
   * Pausar secuencia de un lead
   */
  pauseSequence(leadId: string, reason?: string): void {
    try {
      const stmt = this.db.prepare(`
        UPDATE leads 
        SET sequencePaused = 1, pauseReason = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      stmt.run(reason || "Pausado manualmente", leadId);
    } catch (error) {
      console.error("❌ Error pausando secuencia:", error);
      throw error;
    }
  }

  /**
   * Reanudar secuencia de un lead
   */
  resumeSequence(leadId: string): void {
    try {
      const stmt = this.db.prepare(`
        UPDATE leads 
        SET sequencePaused = 0, pauseReason = NULL, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      stmt.run(leadId);

      // FIX: Asegurar que pauseReason quede como null
      console.log(`✅ Secuencia reanudada para lead ${leadId}`);
    } catch (error) {
      console.error("❌ Error reanudando secuencia:", error);
      throw error;
    }
  }

  /**
   * Obtener todos los logs de un lead
   */
  getLeadEmailLogs(leadId: string): EmailLog[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM email_logs 
        WHERE leadId = ? 
        ORDER BY sentAt DESC
      `);

      return stmt.all(leadId) as EmailLog[];
    } catch (error) {
      console.error("❌ Error obteniendo logs del lead:", error);
      return [];
    }
  }

  /**
   * Buscar lead por ID
   */
  findLeadById(id: string): LeadData | null {
    try {
      const stmt = this.db.prepare("SELECT * FROM leads WHERE id = ?");
      const row = stmt.get(id) as Record<string, unknown>;

      if (!row) return null;

      // Construir objeto base requerido
      const leadData: LeadData = {
        id: row.id as string,
        email: row.email as string,
        name: row.name as string,
        diagnosticDate: row.diagnosticDate as string,
        emailsSent: JSON.parse((row.emailsSent as string) || "[]"),
        sequencePaused: Boolean(row.sequencePaused),
        diagnosticData: JSON.parse((row.diagnosticData as string) || "{}"),
      };

      // Añadir propiedades opcionales solo si existen
      if (row.company) {
        leadData.company = row.company as string;
      }
      if (row.lastEmailSent) {
        leadData.lastEmailSent = row.lastEmailSent as string;
      }
      if (row.pauseReason) {
        leadData.pauseReason = row.pauseReason as string;
      }
      if (row.createdAt) {
        leadData.createdAt = row.createdAt as string;
      }
      if (row.updatedAt) {
        leadData.updatedAt = row.updatedAt as string;
      }

      return leadData;
    } catch (error) {
      console.error("❌ Error buscando lead por ID:", error);
      return null;
    }
  }

  /**
   * Obtener leads activos
   */
  getActiveLeads(): LeadData[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM leads 
        WHERE sequencePaused = 0
        ORDER BY diagnosticDate DESC
      `);

      const leads = stmt.all() as Record<string, unknown>[];

      return leads.map((row) => {
        // Construir LeadData base
        const leadData: LeadData = {
          id: row.id as string,
          email: row.email as string,
          name: row.name as string,
          diagnosticDate: row.diagnosticDate as string,
          emailsSent: JSON.parse((row.emailsSent as string) || "[]"),
          sequencePaused: Boolean(row.sequencePaused),
          diagnosticData: JSON.parse((row.diagnosticData as string) || "{}"),
        };

        // Añadir propiedades opcionales solo si existen
        if (row.company) {
          leadData.company = row.company as string;
        }
        if (row.lastEmailSent) {
          leadData.lastEmailSent = row.lastEmailSent as string;
        }
        if (row.pauseReason) {
          leadData.pauseReason = row.pauseReason as string;
        }
        if (row.createdAt) {
          leadData.createdAt = row.createdAt as string;
        }
        if (row.updatedAt) {
          leadData.updatedAt = row.updatedAt as string;
        }

        return leadData;
      });
    } catch (error) {
      console.error("❌ Error obteniendo leads activos:", error);
      return [];
    }
  }

  /**
   * Cerrar conexión a la base de datos
   */
  close(): void {
    try {
      this.db.close();
      console.log("✅ Conexión a base de datos cerrada");
    } catch (error) {
      console.error("❌ Error cerrando base de datos:", error);
    }
  }
}

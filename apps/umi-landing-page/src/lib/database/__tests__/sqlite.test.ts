// src/lib/database/__tests__/sqlite.test.ts
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { LeadDatabase, LeadData, DiagnosticData } from "../sqlite";
import { existsSync, unlinkSync } from "fs";
import path from "path";

// Mock UUID para tests determinísticos
jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-123"),
}));

describe("LeadDatabase", () => {
  let database: LeadDatabase;
  const testDbPath = path.join(process.cwd(), "data", "test-leads.db");

  beforeEach(() => {
    // Limpiar base de datos de test si existe
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    // Configurar variables de entorno para test
    process.env.DATABASE_PATH = testDbPath;

    database = new LeadDatabase();
  });

  afterEach(() => {
    database.close();

    // Limpiar archivo de test
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe("Conexión y inicialización", () => {
    test("Debe crear la base de datos correctamente", () => {
      expect(existsSync(testDbPath)).toBe(true);
    });

    test("Debe tener las tablas necesarias", () => {
      // Verificar que las tablas existen consultando sqlite_master
      const metrics = database.getMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalLeads).toBe("number");
    });
  });

  describe("Gestión de leads", () => {
    const testLead: LeadData = {
      id: "test-lead-1",
      email: "test@example.com",
      name: "Test User",
      company: "Test Company",
      diagnosticDate: "2025-01-01",
      emailsSent: [],
      sequencePaused: false,
      diagnosticData: {
        score: 75,
        level: "Intermedio",
        recommendations: [
          "Implementar mejores prácticas de recolección de datos",
          "Crear dashboards más intuitivos",
        ],
        areas: {
          dataCollection: 70,
          analysis: 80,
          visualization: 75,
          decisionMaking: 75,
        },
      } as DiagnosticData,
    };

    test("Debe crear un nuevo lead", () => {
      const createdLead = database.upsertLead(testLead);

      expect(createdLead).toBeDefined();
      expect(createdLead.email).toBe(testLead.email);
      expect(createdLead.name).toBe(testLead.name);
      expect(createdLead.diagnosticData.score).toBe(75);
    });

    test("Debe encontrar lead por email", () => {
      database.upsertLead(testLead);

      const foundLead = database.findLeadByEmail("test@example.com");

      expect(foundLead).toBeDefined();
      expect(foundLead?.id).toBe("test-lead-1");
      expect(foundLead?.name).toBe("Test User");
    });

    test("Debe retornar null para email inexistente", () => {
      const foundLead = database.findLeadByEmail("nonexistent@example.com");
      expect(foundLead).toBeNull();
    });

    test("Debe actualizar lead existente", () => {
      // Crear lead inicial
      database.upsertLead(testLead);

      // Actualizar lead
      const updatedLead: LeadData = {
        ...testLead,
        name: "Updated Name",
        company: "Updated Company",
        diagnosticData: {
          ...testLead.diagnosticData,
          score: 85,
          level: "Avanzado",
          recommendations: [
            "Implementar análisis predictivo",
            "Automatizar procesos de reporting",
          ],
        } as DiagnosticData,
      };

      const result = database.upsertLead(updatedLead);

      expect(result.name).toBe("Updated Name");
      expect(result.company).toBe("Updated Company");
      expect(result.diagnosticData.score).toBe(85);

      // Verificar que no se duplicó
      const metrics = database.getMetrics();
      expect(metrics.totalLeads).toBe(1);
    });
  });

  describe("Gestión de emails", () => {
    const testLead: LeadData = {
      id: "test-lead-email",
      email: "email-test@example.com",
      name: "Email Test User",
      diagnosticDate: "2025-01-01",
      emailsSent: [],
      sequencePaused: false,
      diagnosticData: {
        score: 60,
        level: "Básico",
        recommendations: [
          "Establecer procesos básicos de recolección de datos",
        ],
        areas: {
          dataCollection: 50,
          analysis: 60,
          visualization: 65,
          decisionMaking: 65,
        },
      } as DiagnosticData,
    };

    beforeEach(() => {
      database.upsertLead(testLead);
    });

    test("Debe verificar que email no fue enviado inicialmente", () => {
      const wasEmailSent = database.wasEmailSent("test-lead-email", 0);
      expect(wasEmailSent).toBe(false);
    });

    test("Debe registrar email enviado", () => {
      database.logEmailSent({
        leadId: "test-lead-email",
        templateName: "diagnostic_welcome",
        sequenceDay: 0,
        subject: "Bienvenida",
        status: "sent",
      });

      const wasEmailSent = database.wasEmailSent("test-lead-email", 0);
      expect(wasEmailSent).toBe(true);
    });

    test("Debe obtener logs de emails del lead", () => {
      // Enviar algunos emails
      database.logEmailSent({
        leadId: "test-lead-email",
        templateName: "diagnostic_welcome",
        sequenceDay: 0,
        status: "sent",
      });

      database.logEmailSent({
        leadId: "test-lead-email",
        templateName: "diagnostic_followup_1",
        sequenceDay: 2,
        status: "sent",
      });

      const logs = database.getLeadEmailLogs("test-lead-email");
      expect(logs).toHaveLength(2);
      expect(logs[0]?.templateName).toBeDefined();
      expect(logs[0]?.sequenceDay).toBeDefined();
    });
  });

  describe("Cálculo de días transcurridos", () => {
    test("Debe calcular días transcurridos correctamente", () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const testLead: LeadData = {
        id: "test-lead-days",
        email: "days-test@example.com",
        name: "Days Test User",
        diagnosticDate: threeDaysAgo.toISOString(),
        emailsSent: [],
        sequencePaused: false,
        diagnosticData: {
          score: 60,
          level: "Básico",
          recommendations: ["Mejorar la recolección de datos"],
          areas: {
            dataCollection: 60,
            analysis: 60,
            visualization: 60,
            decisionMaking: 60,
          },
        } as DiagnosticData,
      };

      database.upsertLead(testLead);

      const daysElapsed = database.getDaysElapsed("test-lead-days");
      expect(daysElapsed).toBe(3);
    });

    test("Debe retornar 0 para lead inexistente", () => {
      const daysElapsed = database.getDaysElapsed("nonexistent-lead");
      expect(daysElapsed).toBe(0);
    });
  });

  describe("Leads pendientes", () => {
    test("Debe identificar leads pendientes de emails", () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const testLead: LeadData = {
        id: "test-lead-pending",
        email: "pending-test@example.com",
        name: "Pending Test User",
        diagnosticDate: twoDaysAgo.toISOString(),
        emailsSent: [],
        sequencePaused: false,
        diagnosticData: {
          score: 60,
          level: "Básico",
          recommendations: ["Establecer métricas básicas"],
          areas: {
            dataCollection: 60,
            analysis: 60,
            visualization: 60,
            decisionMaking: 60,
          },
        } as DiagnosticData,
      };

      database.upsertLead(testLead);

      const pendingLeads = database.getLeadsPendingEmails();
      expect(pendingLeads.length).toBeGreaterThan(0);

      const pendingLead = pendingLeads.find(
        (lead) => lead.id === "test-lead-pending"
      );
      expect(pendingLead?.daysElapsed).toBe(2);
    });

    test("No debe incluir leads pausados", () => {
      const testLead: LeadData = {
        id: "test-lead-paused",
        email: "paused-test@example.com",
        name: "Paused Test User",
        diagnosticDate: "2025-01-01",
        emailsSent: [],
        sequencePaused: true,
        diagnosticData: {
          score: 60,
          level: "Básico",
          recommendations: ["Recomendación básica"],
          areas: {
            dataCollection: 60,
            analysis: 60,
            visualization: 60,
            decisionMaking: 60,
          },
        } as DiagnosticData,
      };

      database.upsertLead(testLead);

      const pendingLeads = database.getLeadsPendingEmails();
      const pausedLead = pendingLeads.find(
        (lead) => lead.id === "test-lead-paused"
      );
      expect(pausedLead).toBeUndefined();
    });
  });

  describe("Pausar y reanudar secuencias", () => {
    const testLead: LeadData = {
      id: "test-lead-pause",
      email: "pause-test@example.com",
      name: "Pause Test User",
      diagnosticDate: "2025-01-01",
      emailsSent: [],
      sequencePaused: false,
      diagnosticData: {
        score: 60,
        level: "Básico",
        recommendations: ["Recomendación para pausar"],
        areas: {
          dataCollection: 60,
          analysis: 60,
          visualization: 60,
          decisionMaking: 60,
        },
      } as DiagnosticData,
    };

    beforeEach(() => {
      database.upsertLead(testLead);
    });

    test("Debe pausar secuencia de lead", () => {
      database.pauseSequence("test-lead-pause", "Test pause");

      const lead = database.findLeadByEmail("pause-test@example.com");
      expect(lead?.sequencePaused).toBe(true);
      expect(lead?.pauseReason).toBe("Test pause");
    });

    test("Debe reanudar secuencia de lead", () => {
      // Primero pausar
      database.pauseSequence("test-lead-pause", "Test pause");

      // Luego reanudar
      database.resumeSequence("test-lead-pause");

      const lead = database.findLeadByEmail("pause-test@example.com");
      expect(lead?.sequencePaused).toBe(false);
      // FIX: Cambiar de toBeNull() a toBeUndefined() porque SQLite NULL se convierte a undefined en JS
      expect(lead?.pauseReason).toBeUndefined();
    });
  });

  describe("Métricas", () => {
    test("Debe retornar métricas iniciales", () => {
      const metrics = database.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.totalLeads).toBe(0);
      expect(metrics.emailsSentToday).toBe(0);
      expect(metrics.activeSequences).toBe(0);
      expect(metrics.pausedSequences).toBe(0);
    });

    test("Debe actualizar métricas correctamente", () => {
      // Crear algunos leads
      const testLead1: LeadData = {
        id: "metrics-lead-1",
        email: "metrics1@example.com",
        name: "Metrics User 1",
        diagnosticDate: "2025-01-01",
        emailsSent: [],
        sequencePaused: false,
        diagnosticData: {
          score: 60,
          level: "Básico",
          recommendations: ["Recomendación 1"],
          areas: {
            dataCollection: 60,
            analysis: 60,
            visualization: 60,
            decisionMaking: 60,
          },
        } as DiagnosticData,
      };

      const testLead2: LeadData = {
        id: "metrics-lead-2",
        email: "metrics2@example.com",
        name: "Metrics User 2",
        diagnosticDate: "2025-01-01",
        emailsSent: [],
        sequencePaused: true,
        diagnosticData: {
          score: 80,
          level: "Avanzado",
          recommendations: ["Recomendación 2"],
          areas: {
            dataCollection: 80,
            analysis: 80,
            visualization: 80,
            decisionMaking: 80,
          },
        } as DiagnosticData,
      };

      database.upsertLead(testLead1);
      database.upsertLead(testLead2);

      const metrics = database.getMetrics();
      expect(metrics.totalLeads).toBe(2);
      expect(metrics.activeSequences).toBe(1);
      expect(metrics.pausedSequences).toBe(1);
    });
  });
});

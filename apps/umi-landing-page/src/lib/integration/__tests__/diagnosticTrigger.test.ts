// src/lib/integration/__tests__/diagnosticTrigger.test.ts - ARCHIVO COMPLETO CORREGIDO
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { DiagnosticTrigger } from "../diagnosticTrigger";
import { LeadDatabase, DiagnosticData } from "../../database/sqlite";
import { existsSync, unlinkSync } from "fs";
import path from "path";

// Interface para submisión de diagnóstico (diferente de DiagnosticData interna)

interface DiagnosticSubmission {
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

    // Campos adicionales para tests complejos

    metadata?: Record<string, unknown>;
    questionResponses?: Record<string, unknown>;
  };
  submissionDate: string;
}

describe("DiagnosticTrigger Integration", () => {
  let integration: DiagnosticTrigger;
  const testDbPath = path.join(process.cwd(), "data", "test-integration.db");

  beforeEach(() => {
    // Limpiar base de datos de test si existe
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    // Configurar variables de entorno para test
    process.env.DATABASE_PATH = testDbPath;

    integration = new DiagnosticTrigger();
  });

  afterEach(() => {
    integration.close();

    // Limpiar archivo de test
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe("Procesamiento de diagnósticos", () => {
    test("Debe crear nuevo lead con datos completos", async () => {
      const submission: DiagnosticSubmission = {
        email: "complete@example.com",
        name: "Complete User",
        company: "Complete Corp",
        diagnosticResult: {
          score: 85,
          level: "Avanzado",
          recommendations: [
            "Implementar análisis predictivo",
            "Automatizar reportes en tiempo real",
          ],
          areas: {
            dataCollection: 90,
            analysis: 85,
            visualization: 80,
            decisionMaking: 85,
          },
        },
        submissionDate: "2025-01-01T10:00:00Z",
      };

      const result = await integration.processDiagnostic(submission);
      expect(result.isNewLead).toBe(true);

      // Verificar que el lead fue creado correctamente
      const database = new LeadDatabase();
      const lead = database.findLeadByEmail("complete@example.com");

      expect(lead).toBeDefined();
      expect(lead?.name).toBe("Complete User");
      expect(lead?.company).toBe("Complete Corp");
      expect(lead?.diagnosticData.score).toBe(85);
      expect(lead?.diagnosticData.level).toBe("Avanzado");
      expect(lead?.diagnosticData.areas.dataCollection).toBe(90);
      expect(lead?.sequencePaused).toBe(false);

      database.close();
    });

    test("Debe actualizar lead existente sin duplicar email Day 0", async () => {
      const firstSubmission: DiagnosticSubmission = {
        email: "existing@example.com",
        name: "Existing Lead",
        company: "Company",
        diagnosticResult: {
          score: 50,
          level: "Básico",
          recommendations: ["Recomendación inicial"],
          areas: {
            dataCollection: 50,
            analysis: 50,
            visualization: 50,
            decisionMaking: 50,
          },
        },
        submissionDate: "2025-01-01T10:00:00Z",
      };

      // Primera submisión
      const firstResult = await integration.processDiagnostic(firstSubmission);
      expect(firstResult.isNewLead).toBe(true);

      // FIX: Con la nueva lógica, solo debe enviar email del día 0
      expect(firstResult.emailsToSend).toHaveLength(1);
      expect(firstResult.emailsToSend[0]?.day).toBe(0);

      // Segunda submisión del mismo lead
      const secondSubmission: DiagnosticSubmission = {
        ...firstSubmission,
        name: "Updated Name",
        diagnosticResult: {
          ...firstSubmission.diagnosticResult,
          score: 70,
          level: "Intermedio",
        },
        submissionDate: "2025-01-01T11:00:00Z",
      };

      const secondResult =
        await integration.processDiagnostic(secondSubmission);
      expect(secondResult.isNewLead).toBe(false);

      // Verificar que el lead fue actualizado
      const database = new LeadDatabase();
      const updatedLead = database.findLeadByEmail("existing@example.com");
      expect(updatedLead?.name).toBe("Updated Name");
      expect(updatedLead?.diagnosticData.score).toBe(70);
      expect(updatedLead?.diagnosticData.level).toBe("Intermedio");

      database.close();
    });

    test("Debe manejar lead sin empresa", async () => {
      const submission: DiagnosticSubmission = {
        email: "nocompany@example.com",
        name: "No Company User",
        // company is undefined
        diagnosticResult: {
          score: 60,
          level: "Intermedio",
          recommendations: ["Recomendación básica"],
          areas: {
            dataCollection: 60,
            analysis: 60,
            visualization: 60,
            decisionMaking: 60,
          },
        },
        submissionDate: "2025-01-01T10:00:00Z",
      };

      const result = await integration.processDiagnostic(submission);
      expect(result.isNewLead).toBe(true);

      const database = new LeadDatabase();
      const lead = database.findLeadByEmail("nocompany@example.com");
      expect(lead).toBeDefined();
      expect(lead?.company).toBeUndefined();

      database.close();
    });

    test("Debe manejar caracteres especiales y acentos", async () => {
      const submission: DiagnosticSubmission = {
        email: "josé.maría@example.com",
        name: "José María Rodríguez",
        company: "Ñoño & Cía",
        diagnosticResult: {
          score: 75,
          level: "Avanzado",
          recommendations: ["Implementación de análisis avanzado"],
          areas: {
            dataCollection: 75,
            analysis: 75,
            visualization: 75,
            decisionMaking: 75,
          },
        },
        submissionDate: "2025-01-01T10:00:00Z",
      };

      const result = await integration.processDiagnostic(submission);
      expect(result.isNewLead).toBe(true);

      const database = new LeadDatabase();
      const lead = database.findLeadByEmail("josé.maría@example.com");
      expect(lead?.name).toBe("José María Rodríguez");
      expect(lead?.company).toBe("Ñoño & Cía");

      database.close();
    });

    test("Debe manejar datos JSON complejos en diagnosticData", async () => {
      const submission: DiagnosticSubmission = {
        email: "complex@example.com",
        name: "Complex Data User",
        diagnosticResult: {
          score: 80,
          level: "Avanzado",
          recommendations: ["Recomendación compleja"],
          areas: {
            dataCollection: 80,
            analysis: 80,
            visualization: 80,
            decisionMaking: 80,
          },
          metadata: {
            industry: "Technology",
            size: "Medium",
            challenges: ["Data integration", "Real-time analysis"],
          },
          questionResponses: {
            q1: "Advanced",
            q2: ["Option A", "Option C"],
            q3: { preference: "automated", budget: "high" },
          },
        },
        submissionDate: "2025-01-01T10:00:00Z",
      };

      const result = await integration.processDiagnostic(submission);
      expect(result.isNewLead).toBe(true);

      const database = new LeadDatabase();
      const lead = database.findLeadByEmail("complex@example.com");
      expect(lead?.diagnosticData.score).toBe(80);

      database.close();
    });
  });

  describe("Cálculo de emails pendientes", () => {
    test("Debe enviar emails correspondientes según días transcurridos", async () => {
      // Crear un lead de hace 3 días
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const submission: DiagnosticSubmission = {
        email: "threedaysago@example.com",
        name: "Three Days User",
        diagnosticResult: {
          score: 60,
          level: "Básico",
          recommendations: ["Recomendación básica"],
          areas: {
            dataCollection: 60,
            analysis: 60,
            visualization: 60,
            decisionMaking: 60,
          },
        },
        submissionDate: threeDaysAgo.toISOString(),
      };

      const result = await integration.processDiagnostic(submission);

      // Si han pasado 3 días y no hay emails enviados, debería enviar solo el Day 2
      expect(result.emailsToSend.length).toBeGreaterThanOrEqual(1);

      const dayTwoEmail = result.emailsToSend.find((email) => email.day === 2);
      expect(dayTwoEmail).toBeDefined();
    });

    test("Debe respetar emails ya enviados", async () => {
      const database = new LeadDatabase();

      // Crear lead inicial con DiagnosticData completa
      const leadData = {
        id: "test-respect-emails",
        email: "respectemails@example.com",
        name: "Respect Emails Lead",
        diagnosticDate: "2025-01-01T10:00:00Z",
        emailsSent: [],
        sequencePaused: false,
        diagnosticData: {
          score: 60,
          level: "Básico",
          recommendations: ["Recomendación inicial"],
          areas: {
            dataCollection: 60,
            analysis: 60,
            visualization: 60,
            decisionMaking: 60,
          },
        } as DiagnosticData,
      };

      database.upsertLead(leadData);

      // Simular que Day 0 ya fue enviado
      database.logEmailSent({
        leadId: "test-respect-emails",
        templateName: "diagnostic_welcome",
        sequenceDay: 0,
        status: "sent",
      });

      // Simular que han pasado 3 días
      const threeDaysLater = new Date("2025-01-01T10:00:00Z");
      threeDaysLater.setDate(threeDaysLater.getDate() + 3);

      const submission: DiagnosticSubmission = {
        email: "respectemails@example.com",
        name: "Respect Emails Lead",
        diagnosticResult: {
          score: 65,
          level: "Intermedio",
          recommendations: ["Recomendación actualizada"],
          areas: {
            dataCollection: 65,
            analysis: 65,
            visualization: 65,
            decisionMaking: 65,
          },
        },
        submissionDate: threeDaysLater.toISOString(),
      };

      const result = await integration.processDiagnostic(submission);

      // No debe incluir Day 0 porque ya fue enviado
      const dayZeroEmail = result.emailsToSend.find((email) => email.day === 0);
      expect(dayZeroEmail).toBeUndefined();

      // Debe incluir Day 2 porque no fue enviado
      const dayTwoEmail = result.emailsToSend.find((email) => email.day === 2);
      expect(dayTwoEmail).toBeDefined();

      database.close();
    });
  });

  describe("Métricas", () => {
    test("Debe retornar métricas iniciales", () => {
      const metrics = integration.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.totalLeads).toBe(0);
      expect(metrics.activeSequences).toBe(0);
    });

    test("Debe actualizar métricas correctamente", async () => {
      // Crear algunos leads
      const submission1: DiagnosticSubmission = {
        email: "metrics1@example.com",
        name: "Metrics User 1",
        diagnosticResult: {
          score: 60,
          level: "Básico",
          recommendations: ["Recomendación 1"],
          areas: {
            dataCollection: 60,
            analysis: 60,
            visualization: 60,
            decisionMaking: 60,
          },
        },
        submissionDate: "2025-01-01T10:00:00Z",
      };

      const submission2: DiagnosticSubmission = {
        email: "metrics2@example.com",
        name: "Metrics User 2",
        diagnosticResult: {
          score: 80,
          level: "Avanzado",
          recommendations: ["Recomendación 2"],
          areas: {
            dataCollection: 80,
            analysis: 80,
            visualization: 80,
            decisionMaking: 80,
          },
        },
        submissionDate: "2025-01-01T10:00:00Z",
      };

      await integration.processDiagnostic(submission1);
      await integration.processDiagnostic(submission2);

      const metrics = integration.getMetrics();
      expect(metrics.totalLeads).toBe(2);
      expect(metrics.activeSequences).toBe(2);
    });
  });

  describe("Procesamiento de emails programados", () => {
    test("Debe procesar emails pendientes correctamente", async () => {
      // Crear un lead de hace algunos días para simular emails pendientes
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const submission: DiagnosticSubmission = {
        email: "scheduled@example.com",
        name: "Scheduled Email Lead",
        diagnosticResult: {
          score: 70,
          level: "Intermedio",
          recommendations: ["Recomendación programada"],
          areas: {
            dataCollection: 70,
            analysis: 70,
            visualization: 70,
            decisionMaking: 70,
          },
        },
        submissionDate: twoDaysAgo.toISOString(),
      };

      await integration.processDiagnostic(submission);

      // Procesar emails programados usando el método de cron
      const cronResult = await integration.processScheduledEmails();

      // FIX: Con la nueva lógica, debería procesar al menos 1 lead
      expect(cronResult.processed).toBeGreaterThan(0);
    });
  });

  describe("Manejo de errores", () => {
    test("Debe validar datos de entrada", async () => {
      const invalidSubmissions = [
        // Email inválido
        {
          email: "invalid-email",
          name: "Test User",
          diagnosticResult: {
            score: 60,
            level: "Intermedio",
            recommendations: [],
            areas: {
              dataCollection: 60,
              analysis: 60,
              visualization: 60,
              decisionMaking: 60,
            },
          },
          submissionDate: "2025-01-01T10:00:00Z",
        },
        // Nombre vacío
        {
          email: "test@example.com",
          name: "",
          diagnosticResult: {
            score: 60,
            level: "Intermedio",
            recommendations: [],
            areas: {
              dataCollection: 60,
              analysis: 60,
              visualization: 60,
              decisionMaking: 60,
            },
          },
          submissionDate: "2025-01-01T10:00:00Z",
        },
      ];

      for (const invalidSubmission of invalidSubmissions) {
        await expect(
          integration.processDiagnostic(
            invalidSubmission as DiagnosticSubmission
          )
        ).rejects.toThrow();
      }
    });
  });

  describe("Integración completa", () => {
    test("Debe manejar flujo completo de lead lifecycle", async () => {
      // 1. Crear nuevo lead
      const submission: DiagnosticSubmission = {
        email: "lifecycle@example.com",
        name: "Lifecycle Test",
        company: "Test Corp",
        diagnosticResult: {
          score: 65,
          level: "Intermedio",
          recommendations: ["Recomendación 1"],
          areas: {
            dataCollection: 65,
            analysis: 65,
            visualization: 65,
            decisionMaking: 65,
          },
        },
        submissionDate: "2025-01-01T10:00:00Z",
      };

      const createResult = await integration.processDiagnostic(submission);
      expect(createResult.isNewLead).toBe(true);
      // FIX: Solo debe enviar 1 email para nuevo lead (día 0)
      expect(createResult.emailsToSend).toHaveLength(1);

      // 2. Simular paso del tiempo y segunda submisión
      const laterSubmission: DiagnosticSubmission = {
        ...submission,
        diagnosticResult: {
          ...submission.diagnosticResult,
          score: 75,
          level: "Avanzado",
        },
        submissionDate: "2025-01-03T10:00:00Z", // 2 días después
      };

      const updateResult = await integration.processDiagnostic(laterSubmission);
      expect(updateResult.isNewLead).toBe(false);

      // 3. Verificar que el lead fue actualizado
      const database = new LeadDatabase();
      const lead = database.findLeadByEmail("lifecycle@example.com");
      expect(lead?.diagnosticData.score).toBe(75);
      expect(lead?.diagnosticData.level).toBe("Avanzado");

      // 4. Procesar emails programados
      const cronResult = await integration.processScheduledEmails();
      expect(cronResult.processed).toBeGreaterThan(0);

      // 5. Verificar métricas finales
      const metrics = integration.getMetrics();
      expect(metrics.totalLeads).toBe(1);
      expect(metrics.activeSequences).toBe(1);

      database.close();
    });
  });
});

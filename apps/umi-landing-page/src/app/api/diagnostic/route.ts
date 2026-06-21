// src/app/api/diagnostic/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getDiagnosticTrigger,
  DiagnosticSubmission,
} from "@/lib/integration/diagnosticTrigger";

interface DiagnosticRequest {
  email: string;
  name: string;
  company?: string;
  responses: Record<string, string | number>;
}

interface DiagnosticResponse {
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

export async function POST(request: NextRequest) {
  try {
    const body: DiagnosticRequest = await request.json();

    // Validar datos requeridos
    if (!body.email || !body.name || !body.responses) {
      return NextResponse.json(
        { error: "Email, nombre y respuestas son requeridos" },
        { status: 400 }
      );
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return NextResponse.json(
        { error: "Formato de email inválido" },
        { status: 400 }
      );
    }

    // Procesar diagnóstico (lógica existente)
    const diagnosticResult = calculateDiagnostic(body.responses);

    // Crear submission para el nuevo API (compatible con exactOptionalPropertyTypes)
    const submission: DiagnosticSubmission = {
      email: body.email,
      name: body.name,
      diagnosticResult: {
        score: diagnosticResult.score,
        level: diagnosticResult.level,
        recommendations: diagnosticResult.recommendations,
        areas: diagnosticResult.areas,
      },
      submissionDate: new Date().toISOString(),
    };

    // Añadir company solo si existe
    if (body.company) {
      submission.company = body.company;
    }

    // Procesar con el diagnostic trigger
    const diagnosticTrigger = getDiagnosticTrigger();
    const processResult = await diagnosticTrigger.processDiagnostic(submission);

    console.log(`✅ Diagnóstico procesado para ${body.email}:`, {
      isNewLead: processResult.isNewLead,
      level: diagnosticResult.level,
      score: diagnosticResult.score,
      emailsToSend: processResult.emailsToSend.length,
    });

    // Responder con resultado del diagnóstico
    return NextResponse.json({
      // Resultado del diagnóstico (visible para el usuario)
      diagnostic: diagnosticResult,

      // Información del procesamiento (para debugging)
      processing: {
        success: true,
        isNewLead: processResult.isNewLead,
        leadId: processResult.leadId,
        emailsScheduled: processResult.emailsToSend.length,
        level: diagnosticResult.level,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ Error en API de diagnóstico:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

// GET endpoint para métricas (opcional)
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    const diagnosticTrigger = getDiagnosticTrigger();

    switch (action) {
      case "metrics":
        const metrics = diagnosticTrigger.getMetrics();

        return NextResponse.json({
          metrics: {
            totalLeads: metrics.totalLeads,
            activeSequences: metrics.activeSequences,
            emailsSent: metrics.emailsSent,
          },
        });

      case "leads":
        // Usar la base de datos directamente para obtener leads
        const scheduledEmailsResult =
          await diagnosticTrigger.processScheduledEmails();

        return NextResponse.json({
          scheduledEmails: {
            processed: scheduledEmailsResult.processed,
            sent: scheduledEmailsResult.sent,
            failed: scheduledEmailsResult.failed,
          },
        });

      case "health":
        return NextResponse.json({
          status: "healthy",
          timestamp: new Date().toISOString(),
          service: "diagnostic-api",
        });

      default:
        return NextResponse.json(
          { error: "Acción no válida. Use: metrics, leads, health" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("❌ Error en GET de diagnóstico:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Calcular resultado del diagnóstico basado en respuestas
 */
function calculateDiagnostic(
  responses: Record<string, string | number>
): DiagnosticResponse {
  // Lógica de cálculo del diagnóstico (mantener la existente o implementar nueva)

  // Ejemplo de cálculo basado en preguntas típicas
  const scores = {
    dataCollection: calculateAreaScore(responses, [
      "analytics_stage",
      "data_challenge",
      "data_sources",
      "data_quality",
      "data_integration",
    ]),
    analysis: calculateAreaScore(responses, [
      "analytics_stage",
      "decision_basis",
      "analysis_tools",
      "analysis_frequency",
      "analysis_depth",
    ]),
    visualization: calculateAreaScore(responses, [
      "analytics_stage",
      "visualization_tools",
      "dashboard_usage",
      "report_creation",
    ]),
    decisionMaking: calculateAreaScore(responses, [
      "decision_basis",
      "data_challenge",
      "decision_speed",
      "data_driven_decisions",
      "kpi_tracking",
    ]),
  };

  // Calcular score general
  const totalScore = Math.round(
    (scores.dataCollection +
      scores.analysis +
      scores.visualization +
      scores.decisionMaking) /
      4
  );

  // Determinar nivel
  let level: string;
  let recommendations: string[];

  if (totalScore >= 8) {
    level = "Avanzado";
    recommendations = [
      "Fortalecer observabilidad y trazas",
      "Automatizar con controles de intervención",
      "Medir el ciclo completo pedido-cocina-cliente",
    ];
  } else if (totalScore >= 5) {
    level = "Intermedio";
    recommendations = [
      "Conectar KDS, Cash y Dashboard",
      "Unificar estados de pedidos y recompensas",
      "Definir alertas operativas para gerencia",
    ];
  } else {
    level = "Inicial";
    recommendations = [
      "Activar ConversaFlow como entrada operativa",
      "Estructurar el contrato mínimo de pedido y cliente",
      "Crear la primera vista de seguimiento",
    ];
  }

  return {
    score: totalScore,
    level,
    recommendations,
    areas: scores,
  };
}

/**
 * Calcular puntuación para un área específica
 */
function calculateAreaScore(
  responses: Record<string, string | number>,
  questionKeys: string[]
): number {
  let totalScore = 0;
  let validResponses = 0;

  for (const key of questionKeys) {
    const response = responses[key];
    if (response !== undefined && response !== null) {
      // Convertir respuesta a número (1-5 scale típica)
      const score =
        typeof response === "number"
          ? response
          : getScoreFromString(String(response));
      totalScore += score;
      validResponses++;
    }
  }

  // Retornar promedio o 1 como fallback
  return validResponses > 0 ? Math.round(totalScore / validResponses) : 1;
}

/**
 * Convertir respuesta string a score numérico
 */
function getScoreFromString(response: string): number {
  const scoreMap: Record<string, number> = {
    // Respuestas típicas
    muy_bajo: 1,
    bajo: 2,
    medio: 3,
    alto: 4,
    muy_alto: 5,
    nunca: 1,
    rara_vez: 2,
    a_veces: 3,
    frecuentemente: 4,
    siempre: 5,
    inicial: 1,
    intermedio: 3,
    avanzado: 5,
    pedidos: 1,
    cocina: 3,
    clientes: 5,
    recopilacion: 1,
    organizacion: 3,
    interpretacion: 5,
  };

  const normalized = response.toLowerCase().trim();
  return scoreMap[normalized] || 1;
}

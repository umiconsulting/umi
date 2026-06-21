// src/app/api/cron/email-sequence/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDiagnosticTrigger } from "@/lib/integration/diagnosticTrigger";

export async function POST(request: NextRequest) {
  try {
    // Verificar autenticación del cron job (opcional)
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const diagnosticTrigger = getDiagnosticTrigger();

    console.log("🔄 Iniciando procesamiento de emails programados...");

    // Usar el método nativo de processScheduledEmails
    const result = await diagnosticTrigger.processScheduledEmails();

    console.log("✅ Procesamiento completado:", {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed,
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results: {
        processed: result.processed,
        successful: result.sent,
        failed: result.failed,
      },
    });
  } catch (error) {
    console.error("❌ Error en cron job de emails:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        success: false,
        error: "Error procesando emails programados",
        timestamp: new Date().toISOString(),
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

// GET para verificar estado del cron job
export async function GET() {
  try {
    const diagnosticTrigger = getDiagnosticTrigger();

    // Obtener métricas usando la nueva API
    const metrics = diagnosticTrigger.getMetrics();

    // Ejecutar un procesamiento de prueba para obtener más info
    const testResult = await diagnosticTrigger.processScheduledEmails();

    return NextResponse.json({
      status: "active",
      timestamp: new Date().toISOString(),
      metrics: {
        totalLeads: metrics.totalLeads,
        activeSequences: metrics.activeSequences,
        emailsSent: metrics.emailsSent,
        lastProcessingResult: {
          processed: testResult.processed,
          sent: testResult.sent,
          failed: testResult.failed,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error obteniendo estado del cron:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

// GET endpoint adicional para testing manual
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    const diagnosticTrigger = getDiagnosticTrigger();

    switch (action) {
      case "test_sequence":
        console.log("🧪 Ejecutando test de secuencia de emails...");

        const testResult = await diagnosticTrigger.processScheduledEmails();

        return NextResponse.json({
          success: true,
          action: "test_sequence",
          timestamp: new Date().toISOString(),
          results: testResult,
        });

      case "get_metrics":
        const metrics = diagnosticTrigger.getMetrics();

        return NextResponse.json({
          success: true,
          action: "get_metrics",
          timestamp: new Date().toISOString(),
          metrics,
        });

      case "health_check":
        return NextResponse.json({
          success: true,
          action: "health_check",
          timestamp: new Date().toISOString(),
          status: "healthy",
          service: "email-sequence-cron",
        });

      default:
        return NextResponse.json(
          {
            error: "Acción no válida",
            validActions: ["test_sequence", "get_metrics", "health_check"],
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("❌ Error en PUT de cron:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        success: false,
        error: "Error procesando acción",
        timestamp: new Date().toISOString(),
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

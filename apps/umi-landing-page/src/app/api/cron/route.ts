// 📡 API ENDPOINT PARA CONTROL MANUAL
// src/app/api/cron/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getCronManager } from "@/app/api/cron/emailCron";
import { getSequenceManager } from "@/lib/email/sequenceManager";

export async function GET() {
  try {
    const cronManager = getCronManager();
    const status = cronManager.getJobStatus();
    const activeJobs = cronManager.getActiveJobs();

    return NextResponse.json({
      success: true,
      activeJobs,
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (cronError) {
    console.error("❌ Error obteniendo status de cron jobs:", cronError);
    const errorMessage =
      cronError instanceof Error ? cronError.message : "Error desconocido";

    return NextResponse.json(
      {
        error: "Error obteniendo status de cron jobs",
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, jobName } = await request.json();
    const cronManager = getCronManager();

    switch (action) {
      case "start_all":
        cronManager.startAllJobs();
        return NextResponse.json({
          success: true,
          message: "Todos los jobs iniciados",
          timestamp: new Date().toISOString(),
        });

      case "stop_all":
        cronManager.stopAllJobs();
        return NextResponse.json({
          success: true,
          message: "Todos los jobs detenidos",
          timestamp: new Date().toISOString(),
        });

      case "stop_job":
        if (!jobName) {
          return NextResponse.json(
            { error: "jobName requerido para detener job específico" },
            { status: 400 }
          );
        }
        const stopResult = cronManager.stopJob(jobName);
        return NextResponse.json({
          success: stopResult,
          message: stopResult
            ? `Job ${jobName} detenido`
            : `Job ${jobName} no encontrado`,
          timestamp: new Date().toISOString(),
        });

      case "force_sequence":
        // Ejecutar secuencias manualmente
        const sequenceManager = getSequenceManager();
        const results = await sequenceManager.processAllSequences();
        return NextResponse.json({
          success: true,
          results,
          message: "Secuencias ejecutadas manualmente",
          timestamp: new Date().toISOString(),
        });

      case "get_metrics":
        // Obtener métricas de cron jobs
        const metrics = cronManager.getMetrics();
        return NextResponse.json({
          success: true,
          metrics,
          timestamp: new Date().toISOString(),
        });

      case "reset_metrics":
        // Resetear métricas
        cronManager.resetMetrics();
        return NextResponse.json({
          success: true,
          message: "Métricas reiniciadas",
          timestamp: new Date().toISOString(),
        });

      default:
        return NextResponse.json(
          {
            error: "Acción no válida",
            validActions: [
              "start_all",
              "stop_all",
              "stop_job",
              "force_sequence",
              "get_metrics",
              "reset_metrics",
            ],
          },
          { status: 400 }
        );
    }
  } catch (actionError) {
    console.error("❌ Error ejecutando acción de cron:", actionError);
    const errorMessage =
      actionError instanceof Error ? actionError.message : "Error desconocido";

    return NextResponse.json(
      {
        error: "Error ejecutando acción de cron",
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

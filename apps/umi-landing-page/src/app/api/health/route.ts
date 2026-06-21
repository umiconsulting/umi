// src/app/api/health/route.ts - Health check del sistema
import { NextResponse } from "next/server";
import { getEmailService } from "@/lib/email/emailService";
import { getSequenceManager } from "@/lib/email/sequenceManager";
import { getCronManager } from "@/app/api/cron/emailCron";

// GET: Health check completo del sistema
export async function GET() {
  try {
    const emailService = getEmailService();
    const sequenceManager = getSequenceManager();
    const cronManager = getCronManager();

    // Test de conexión de email
    const connectionTest = await emailService.testConnection();

    // Métricas del sistema
    const emailMetrics = emailService.getMetrics();
    const sequenceMetrics = sequenceManager.getMetrics();
    const cronMetrics = cronManager.getMetrics();

    // Variables de entorno críticas
    const envCheck = {
      EMAIL_USER: !!process.env.EMAIL_USER,
      EMAIL_PASSWORD: !!process.env.EMAIL_PASSWORD,
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_BASE_URL: !!process.env.NEXT_PUBLIC_BASE_URL,
    };

    // Estado de cron jobs
    const cronJobs = {
      activeJobs: cronManager.getActiveJobs(),
      jobStatus: cronManager.getJobStatus(),
    };

    // Determinar salud general del sistema
    const isHealthy =
      connectionTest && envCheck.EMAIL_USER && envCheck.EMAIL_PASSWORD;

    const health = {
      status: isHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      services: {
        emailService: connectionTest ? "up" : "down",
        sequenceManager: "up", // Asumir que siempre está up si llegamos aquí
        cronManager: cronJobs.activeJobs.length > 0 ? "up" : "idle",
      },
      environment: envCheck,
      metrics: {
        email: emailMetrics,
        sequences: sequenceMetrics,
        cron: cronMetrics,
      },
      cronJobs,
      version: "1.0.0",
      uptime: process.uptime(),
    };

    return NextResponse.json(health, {
      status: isHealthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    console.error("❌ Error en health check:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        status: "unhealthy",
        error: "Health check failed",
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
        timestamp: new Date().toISOString(),
        services: {
          emailService: "unknown",
          sequenceManager: "unknown",
          cronManager: "unknown",
        },
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  }
}

// POST: Ejecutar tests específicos del sistema
export async function POST(request: Request) {
  try {
    const { testType } = await request.json();

    switch (testType) {
      case "email_connection":
        const emailService = getEmailService();
        const connectionResult = await emailService.testConnection();

        return NextResponse.json({
          success: connectionResult,
          test: "email_connection",
          message: connectionResult
            ? "✅ Conexión email OK"
            : "❌ Error conexión email",
          timestamp: new Date().toISOString(),
        });

      case "sequence_test":
        const sequenceManager = getSequenceManager();
        const testResult = await sequenceManager.testSequence(
          "test@example.com",
          "diagnostic_followup"
        );

        return NextResponse.json({
          success: testResult,
          test: "sequence_test",
          message: testResult
            ? "✅ Secuencia test OK"
            : "❌ Error en secuencia",
          timestamp: new Date().toISOString(),
        });

      case "cron_status":
        const cronManager = getCronManager();
        const cronStatus = cronManager.getJobStatus();
        const activeJobs = cronManager.getActiveJobs();

        return NextResponse.json({
          success: true,
          test: "cron_status",
          data: {
            activeJobs,
            status: cronStatus,
            metrics: cronManager.getMetrics(),
          },
          timestamp: new Date().toISOString(),
        });

      case "full_system":
        // Test completo del sistema
        const fullTest = await runFullSystemTest();

        return NextResponse.json({
          success: fullTest.allPassed,
          test: "full_system",
          results: fullTest.results,
          summary: fullTest.summary,
          timestamp: new Date().toISOString(),
        });

      default:
        return NextResponse.json(
          {
            error: "Tipo de test no válido",
            validTypes: [
              "email_connection",
              "sequence_test",
              "cron_status",
              "full_system",
            ],
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("❌ Error ejecutando test:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        error: "Error ejecutando test",
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// Función auxiliar para ejecutar test completo del sistema
async function runFullSystemTest() {
  const results = {
    emailConnection: false,
    environmentVars: false,
    cronJobs: false,
    sequenceManager: false,
  };

  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
  };

  try {
    // Test 1: Conexión de email
    const emailService = getEmailService();
    results.emailConnection = await emailService.testConnection();
    summary.total++;
    if (results.emailConnection) summary.passed++;
    else summary.failed++;

    // Test 2: Variables de entorno
    results.environmentVars = !!(
      process.env.EMAIL_USER && process.env.EMAIL_PASSWORD
    );
    summary.total++;
    if (results.environmentVars) summary.passed++;
    else summary.failed++;

    // Test 3: Cron jobs
    const cronManager = getCronManager();
    const activeJobs = cronManager.getActiveJobs();
    results.cronJobs = activeJobs.length > 0;
    summary.total++;
    if (results.cronJobs) summary.passed++;
    else summary.failed++;

    // Test 4: Sequence manager
    const sequenceManager = getSequenceManager();
    const metrics = sequenceManager.getMetrics();
    results.sequenceManager = metrics !== null && metrics !== undefined;
    summary.total++;
    if (results.sequenceManager) summary.passed++;
    else summary.failed++;
  } catch (error) {
    console.error("Error en full system test:", error);
    summary.failed++;
  }

  return {
    allPassed: summary.failed === 0,
    results,
    summary,
  };
}

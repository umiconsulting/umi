// 🆕 NUEVO ARCHIVO: src/app/api/email-metrics/route.ts
// Endpoint dedicado para métricas del sistema

import { NextResponse } from "next/server";
import { getEmailService } from "@/lib/email/email-service";
import { getSequenceManager } from "@/lib/email/sequence-manager";

export async function GET() {
  try {
    const emailService = getEmailService();
    const sequenceManager = getSequenceManager();

    const emailMetrics = emailService.getMetrics();
    const sequenceMetrics = sequenceManager.getMetrics();

    // Calcular tasas
    const deliveryRate =
      emailMetrics.sent > 0
        ? (
            ((emailMetrics.sent - emailMetrics.failed) / emailMetrics.sent) *
            100
          ).toFixed(1)
        : "0";

    const responseRate =
      sequenceMetrics.totalLeads > 0
        ? (
            (sequenceMetrics.responsesReceived / sequenceMetrics.totalLeads) *
            100
          ).toFixed(1)
        : "0";

    const conversionRate =
      sequenceMetrics.totalLeads > 0
        ? (
            (sequenceMetrics.conversions / sequenceMetrics.totalLeads) *
            100
          ).toFixed(1)
        : "0";

    return NextResponse.json({
      success: true,
      data: {
        email: {
          ...emailMetrics,
          deliveryRate: `${deliveryRate}%`,
        },
        sequences: {
          ...sequenceMetrics,
          responseRate: `${responseRate}%`,
          conversionRate: `${conversionRate}%`,
        },
        summary: {
          totalEmailsSent: emailMetrics.sent,
          totalLeadsProcessed: sequenceMetrics.totalLeads,
          overallHealth:
            emailMetrics.failed < emailMetrics.sent * 0.1
              ? "healthy"
              : "attention",
          lastUpdated: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("❌ Error obteniendo métricas:", error);
    return NextResponse.json(
      {
        error: "Error obteniendo métricas",
        details:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const emailService = getEmailService();
    const sequenceManager = getSequenceManager();

    emailService.resetMetrics();
    sequenceManager.resetMetrics();

    console.log("🧹 Métricas reseteadas");

    return NextResponse.json({
      success: true,
      message: "✅ Métricas reseteadas exitosamente",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error reseteando métricas:", error);
    return NextResponse.json(
      {
        error: "Error reseteando métricas",
        details:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

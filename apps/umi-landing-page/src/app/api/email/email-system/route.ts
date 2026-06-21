import { NextRequest, NextResponse } from "next/server";
import { getSequenceManager } from "@/lib/email/sequenceManager";

// GET: Ejecutar secuencias automáticas (para cron jobs)
export async function GET() {
  try {
    console.log("🔄 Ejecutando secuencias automáticas...");

    const sequenceManager = getSequenceManager();
    const metrics = await sequenceManager.processAllSequences();

    return NextResponse.json({
      success: true,
      message: "Secuencias procesadas exitosamente",
      metrics,
    });
  } catch (error) {
    console.error("❌ Error en endpoint de secuencias:", error);
    return NextResponse.json(
      {
        error: "Error procesando secuencias",
        details: process.env.NODE_ENV === "development" ? error : undefined,
      },
      { status: 500 }
    );
  }
}

// POST: Acciones de control de secuencias
export async function POST(request: NextRequest) {
  try {
    const { action, leadId, data } = await request.json();
    const sequenceManager = getSequenceManager();

    switch (action) {
      case "pause":
        const pauseResult = await sequenceManager.pauseSequenceForLead(
          leadId,
          data?.reason || "manual_pause"
        );
        return NextResponse.json({ success: pauseResult, action: "paused" });

      case "resume":
        const resumeResult =
          await sequenceManager.resumeSequenceForLead(leadId);
        return NextResponse.json({ success: resumeResult, action: "resumed" });

      case "mark_responded":
        const respondResult = await sequenceManager.markLeadAsResponded(
          leadId,
          data?.responseType || "email"
        );
        return NextResponse.json({
          success: respondResult,
          action: "marked_responded",
        });

      case "test_sequence":
        const testResult = await sequenceManager.testSequence(
          data?.email,
          data?.sequenceId
        );
        return NextResponse.json({
          success: testResult,
          action: "test_completed",
        });

      case "get_metrics":
        const metrics = sequenceManager.getMetrics();
        return NextResponse.json({ success: true, metrics });

      case "reset_metrics":
        sequenceManager.resetMetrics();
        return NextResponse.json({ success: true, action: "metrics_reset" });

      default:
        return NextResponse.json(
          {
            error: "Acción no válida",
            validActions: [
              "pause",
              "resume",
              "mark_responded",
              "test_sequence",
              "get_metrics",
              "reset_metrics",
            ],
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("❌ Error en webhook de secuencias:", error);
    return NextResponse.json(
      { error: "Error procesando acción" },
      { status: 500 }
    );
  }
}

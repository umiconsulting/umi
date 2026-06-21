import { NextRequest, NextResponse } from "next/server";
import { getSequenceManager } from "@/lib/email/sequenceManager";

// Interfaces para type safety
interface LeadData {
  email: string;
  name: string;
  company: string;
  diagnosticData: {
    score: number;
    level: string;
    primaryChallenge: string;
    quickWins: Array<{ action: string; description: string }>;
    estimatedROI: {
      timeToValue: number;
      expectedReturn: number;
    };
  };
  triggerSequence?: boolean;
  phone?: string;
}

interface LeadStats {
  totalLeads: number;
  activeSequences: number;
  completedSequences: number;
  respondedLeads: number;
  conversionRate: string;
}

interface SequenceMetrics {
  totalLeads: number;
  emailsSent: number;
  emailsFailed: number;
  responsesReceived: number;
  meetingsScheduled: number;
  conversions: number;
  sequenceCompletions: number;
}

// POST: Agregar nuevo lead a secuencias
export async function POST(request: NextRequest) {
  try {
    const leadData: LeadData = await request.json();

    // Validar datos requeridos
    const requiredFields: (keyof LeadData)[] = [
      "email",
      "name",
      "company",
      "diagnosticData",
    ];
    const missingFields = requiredFields.filter((field) => !leadData[field]);

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Campos requeridos faltantes: ${missingFields.join(", ")}` },
        { status: 400 }
      );
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(leadData.email)) {
      return NextResponse.json(
        { error: "Formato de email inválido" },
        { status: 400 }
      );
    }

    // En producción, guardar en base de datos
    console.log("💾 Nuevo lead agregado:", leadData.email);

    // Iniciar secuencia automáticamente si es nuevo diagnóstico
    if (leadData.triggerSequence) {
      const sequenceManager = getSequenceManager();

      // Crear el lead en formato esperado por el manager
      const leadForManager = {
        id: `lead_${Date.now()}`,
        email: leadData.email,
        name: leadData.name,
        company: leadData.company,
        diagnosticDate: new Date(),
        meetingScheduled: false,
        meetingAttended: false,
        emailsSent: [],
        sequencePaused: false,
        diagnosticData: leadData.diagnosticData,
      };

      try {
        await sequenceManager.processLeadSequences(leadForManager);
        console.log(`✅ Secuencia iniciada para ${leadData.email}`);
      } catch (sequenceError) {
        console.error("❌ Error iniciando secuencia:", sequenceError);
        // No fallar la creación del lead por error en secuencia
      }
    }

    const leadId = `lead_${Date.now()}`;

    return NextResponse.json({
      success: true,
      message: "Lead agregado exitosamente",
      leadId,
      sequenceStarted: leadData.triggerSequence || false,
    });
  } catch (error) {
    console.error("❌ Error agregando lead:", error);
    return NextResponse.json(
      {
        error: "Error agregando lead",
        details:
          process.env.NODE_ENV === "development" ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

// GET: Obtener estadísticas de leads
export async function GET() {
  try {
    const sequenceManager = getSequenceManager();
    const metrics = sequenceManager.getMetrics();

    // En producción, consultar base de datos real
    // Por ahora usamos datos del sequence manager + fallbacks seguros
    const stats: LeadStats = {
      totalLeads: metrics.totalLeads,
      activeSequences: calculateActiveSequences(metrics),
      completedSequences: metrics.sequenceCompletions,
      respondedLeads: metrics.responsesReceived,
      conversionRate: calculateConversionRate(metrics),
    };

    return NextResponse.json({
      success: true,
      stats,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error obteniendo estadísticas de leads:", error);
    return NextResponse.json(
      { error: "Error obteniendo estadísticas" },
      { status: 500 }
    );
  }
}

// PUT: Actualizar estado de lead
export async function PUT(request: NextRequest) {
  try {
    const { leadId, action, data } = await request.json();

    if (!leadId) {
      return NextResponse.json(
        { error: "leadId es requerido" },
        { status: 400 }
      );
    }

    const sequenceManager = getSequenceManager();

    switch (action) {
      case "pause_sequence":
        const pauseResult = await sequenceManager.pauseSequenceForLead(
          leadId,
          data?.reason || "manual_pause"
        );
        return NextResponse.json({
          success: pauseResult,
          message: "Secuencia pausada",
          leadId,
        });

      case "resume_sequence":
        const resumeResult =
          await sequenceManager.resumeSequenceForLead(leadId);
        return NextResponse.json({
          success: resumeResult,
          message: "Secuencia reanudada",
          leadId,
        });

      case "mark_responded":
        const respondResult = await sequenceManager.markLeadAsResponded(
          leadId,
          data?.responseType || "email"
        );
        return NextResponse.json({
          success: respondResult,
          message: "Lead marcado como respondido",
          leadId,
        });

      default:
        return NextResponse.json(
          {
            error: "Acción no válida",
            validActions: [
              "pause_sequence",
              "resume_sequence",
              "mark_responded",
            ],
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("❌ Error actualizando lead:", error);
    return NextResponse.json(
      { error: "Error actualizando lead" },
      { status: 500 }
    );
  }
}

// Funciones auxiliares
function calculateActiveSequences(metrics: SequenceMetrics): number {
  // En producción, calcular basado en base de datos
  // Por ahora, estimamos basado en leads totales menos completadas
  const estimated = metrics.totalLeads - metrics.sequenceCompletions;
  return Math.max(0, estimated);
}

function calculateConversionRate(metrics: SequenceMetrics): string {
  if (!metrics.totalLeads || metrics.totalLeads === 0) {
    return "0%";
  }

  const rate = (metrics.conversions / metrics.totalLeads) * 100;
  return `${rate.toFixed(1)}%`;
}

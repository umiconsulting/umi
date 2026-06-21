import { NextRequest, NextResponse } from "next/server";
import { getSequenceManager } from "@/lib/email/sequenceManager";

// Definir tipos para mejor type safety
interface WebhookData {
  type: "email_reply" | "meeting_scheduled" | "unsubscribe";
  leadId: string;
  email?: string;
  responseType?: "email" | "phone" | "meeting";
}

// POST: Webhook para detectar respuestas automáticamente
export async function POST(request: NextRequest) {
  try {
    const webhookData: WebhookData = await request.json();
    const { type, leadId } = webhookData;

    // Verificar webhook signature para seguridad
    const signature = request.headers.get("x-webhook-signature");
    if (!verifyWebhookSignature(signature, webhookData)) {
      return NextResponse.json(
        { error: "Webhook signature inválida" },
        { status: 401 }
      );
    }

    const sequenceManager = getSequenceManager();

    switch (type) {
      case "email_reply":
        await sequenceManager.markLeadAsResponded(leadId, "email");
        console.log(`✅ Lead ${leadId} respondió por email`);
        break;

      case "meeting_scheduled":
        // Marcar meeting como agendado y pausar secuencia de seguimiento
        await sequenceManager.pauseSequenceForLead(leadId, "meeting_scheduled");
        console.log(`📅 Lead ${leadId} agendó meeting`);
        break;

      case "unsubscribe":
        await sequenceManager.pauseSequenceForLead(leadId, "unsubscribed");
        console.log(`🚫 Lead ${leadId} se desuscribió`);
        break;

      default:
        console.log(`❓ Tipo de webhook desconocido: ${type}`);
        return NextResponse.json(
          { error: "Tipo de webhook no soportado", type },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      processed: type,
      leadId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error procesando webhook:", error);
    return NextResponse.json(
      {
        error: "Error procesando webhook",
        details:
          process.env.NODE_ENV === "development" ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

// GET: Endpoint de health check para el webhook
export async function GET() {
  return NextResponse.json({
    status: "active",
    service: "email-response-webhook",
    timestamp: new Date().toISOString(),
    endpoints: {
      webhook: "/api/webhook/email-response",
    },
  });
}

// Función auxiliar para verificar la firma del webhook
function verifyWebhookSignature(
  signature: string | null,
  webhookData: WebhookData
): boolean {
  // Por ahora retornamos true para desarrollo
  // En producción, implementar verificación real según tu proveedor
  if (process.env.NODE_ENV === "development") {
    console.log(
      `🔐 Webhook signature check (dev mode) for type: ${webhookData.type}`
    );
    return true;
  }

  // Ejemplo de implementación real:
  // const secret = process.env.WEBHOOK_SECRET;
  // const computedSignature = crypto
  //   .createHmac('sha256', secret)
  //   .update(JSON.stringify(webhookData))
  //   .digest('hex');
  // return signature === `sha256=${computedSignature}`;

  return signature !== null;
}

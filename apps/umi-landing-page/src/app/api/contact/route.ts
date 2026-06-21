import { NextRequest, NextResponse } from "next/server";
import { createEmailService, getInternalEmail } from "@/lib/email/emailService";

// Tipos para el formulario de contacto
interface ContactFormData {
  name: string;
  email: string;
  company: string;
  need: string;
  message: string;
}

// Función para generar el template del correo para Umi
const generateUmiEmailTemplate = (data: ContactFormData): string => {
  const needTranslations: Record<string, string> = {
    conversaflow: "Pedidos y atención por WhatsApp",
    kds: "Cocina / KDS",
    cash: "Lealtad / wallet",
    suite: "Suite completa",
    indeciso: "Aún no sabe por dónde empezar",
  };

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Source Sans Pro', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #223979; color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .logo { font-family: 'Domus', Arial, sans-serif; font-size: 28px; font-weight: bold; margin-bottom: 10px; }
        .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
        .section { margin-bottom: 25px; }
        .label { font-weight: 600; color: #223979; margin-bottom: 5px; display: block; }
        .value { background: #f9fafb; padding: 12px; border-radius: 6px; border-left: 3px solid #7692CB; }
        .priority-high { border-left-color: #ef4444; }
        .priority-medium { border-left-color: #f59e0b; }
        .priority-low { border-left-color: #10b981; }
        .footer { background: #f3f4f6; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; border-radius: 0 0 8px 8px; }
        .cta-button { background: #223979; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 15px 0; }
        .stats { display: flex; justify-content: space-around; margin: 20px 0; }
        .stat { text-align: center; }
        .stat-number { font-size: 24px; font-weight: bold; color: #223979; }
        .stat-label { font-size: 12px; color: #6b7280; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">umi</div>
          <p>Nueva consulta recibida</p>
        </div>
        
        <div class="content">
          <div class="section">
            <span class="label">Cliente Potencial:</span>
            <div class="value priority-high">
              <strong>${data.name}</strong><br>
              Email: ${data.email}<br>
              Empresa: ${data.company || "No especificada"}
            </div>
          </div>

          <div class="section">
            <span class="label">Producto o necesidad:</span>
            <div class="value priority-medium">
              ${needTranslations[data.need] || data.need}
            </div>
          </div>

          <div class="section">
            <span class="label">Mensaje:</span>
            <div class="value">
              ${data.message || "Sin mensaje adicional"}
            </div>
          </div>

          <div class="stats">
            <div class="stat">
              <div class="stat-number">48h</div>
              <div class="stat-label">Respuesta hábil</div>
            </div>
            <div class="stat">
              <div class="stat-number">Umi</div>
              <div class="stat-label">Ruta de producto</div>
            </div>
            <div class="stat">
              <div class="stat-number">Ops</div>
              <div class="stat-label">Contexto operativo</div>
            </div>
          </div>

          <div style="text-align: center;">
            <a href="mailto:${data.email}" class="cta-button">
              Responder Directamente
            </a>
          </div>
        </div>

        <div class="footer">
          <p><strong>Umi</strong> - Sistema operativo para restaurantes conectados</p>
          <p>Recibido: ${new Date().toLocaleString("es-ES", {
            timeZone: "America/Mexico_City",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

// Función para generar respuesta automática al cliente
const generateClientAutoReply = (data: ContactFormData): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Source Sans Pro', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #223979; color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .logo { font-family: 'Domus', Arial, sans-serif; font-size: 28px; font-weight: bold; margin-bottom: 10px; }
        .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
        .footer { background: #f3f4f6; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; border-radius: 0 0 8px 8px; }
        .cta-button { background: #7692CB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 15px 0; }
        .highlight { background: #f0f4ff; padding: 15px; border-radius: 6px; border-left: 3px solid #7692CB; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">umi</div>
          <p>Gracias por contactarnos</p>
        </div>
        
        <div class="content">
          <p>Hola <strong>${data.name}</strong>,</p>
          
          <p>Hemos recibido tu consulta y queremos agradecerte por considerar Umi para conectar tu operación.</p>

          <div class="highlight">
            <strong>¿Qué sigue ahora?</strong><br>
            • Revisaremos tu solicitud por producto y prioridad operativa<br>
            • Te contactaremos para entender tu flujo actual<br>
            • Prepararemos una ruta inicial sin inflar alcance
          </div>

          <p>Mientras tanto, si no lo has hecho, puedes completar el diagnóstico operativo para ubicar el primer producto a activar.</p>
          <ul>
            <li>Pedidos por WhatsApp y ConversaFlow</li>
            <li>Cocina con KDS</li>
            <li>Lealtad, wallet, dashboard y logs</li>
          </ul>

          <div style="text-align: center;">
            <a href="https://umiconsulting.co/#diagnostico" class="cta-button">
              Realizar diagnóstico
            </a>
          </div>

          <p>Esperamos poder ayudarte a convertir mensajes, cocina y clientes en una operación más clara.</p>
          
          <p>Saludos cordiales,<br>
          <strong>Equipo Umi</strong></p>
        </div>

        <div class="footer">
          <p><strong>Umi</strong></p>
          <p>hola@umiconsulting.co | +52 667 730 1913</p>
          <p>Sistema operativo para restaurantes conectados</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

export async function POST(request: NextRequest) {
  try {
    const data: ContactFormData = await request.json();

    // Validación básica
    if (!data.name || !data.email) {
      return NextResponse.json(
        { error: "Nombre y email son requeridos" },
        { status: 400 }
      );
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return NextResponse.json(
        { error: "Formato de email inválido" },
        { status: 400 }
      );
    }

    const emailService = createEmailService();
    const internalEmail = getInternalEmail();

    // Email para Umi (notificación interna)
    const umiMailOptions = {
      to: internalEmail,
      subject: `Nueva consulta Umi de ${data.name} - ${data.company || "Cliente potencial"}`,
      html: generateUmiEmailTemplate(data),
      replyTo: data.email,
      campaign: "contact_form",
      priority: "high" as const,
      // También incluir versión texto plano para mejor deliverability
      text: `
        Nueva consulta recibida:
        
        Cliente: ${data.name}
        Email: ${data.email}
        Empresa: ${data.company || "No especificada"}
        Necesidad: ${data.need}
        Mensaje: ${data.message || "Sin mensaje adicional"}
        
        Fecha: ${new Date().toLocaleString("es-ES")}
      `,
    };

    // Email de respuesta automática al cliente
    const clientMailOptions = {
      to: data.email,
      subject: "Hemos recibido tu consulta - Umi",
      html: generateClientAutoReply(data),
      campaign: "contact_auto_reply",
      priority: "normal" as const,
      text: `
        Hola ${data.name},
        
        Hemos recibido tu consulta y te contactaremos pronto.
        
        Mientras tanto, puedes completar el diagnóstico operativo en:
        https://umiconsulting.co/#diagnostico
        
        Saludos,
        Equipo Umi
      `,
    };

    // Enviar ambos emails usando el servicio centralizado del repo original.
    const result = await emailService.sendBulkEmails([
      umiMailOptions,
      clientMailOptions,
    ]);

    emailService.close();

    if (result.failed > 0) {
      return NextResponse.json(
        {
          error: "Error enviando email",
          details:
            process.env.NODE_ENV === "development"
              ? `${result.failed} de ${result.sent + result.failed} emails fallaron`
              : undefined,
        },
        { status: 500 }
      );
    }

    // Log para debugging (remover en producción)
    console.log("Emails enviados exitosamente:", {
      cliente: data.email,
      empresa: data.company,
      destinoInterno: internalEmail,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: "Consulta enviada exitosamente",
    });
  } catch (error) {
    console.error("Error al enviar email:", error);

    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: process.env.NODE_ENV === "development" ? error : undefined,
      },
      { status: 500 }
    );
  }
}

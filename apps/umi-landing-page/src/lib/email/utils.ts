// src/lib/email/utils.ts - Utilidades compartidas

// Interfaz para métricas del sistema de email
interface EmailMetrics {
  totalLeads: number;
  emailsSent: number;
  emailsFailed: number;
  responsesReceived: number;
  conversions?: number;
  meetingsScheduled?: number;
  sequenceCompletions?: number;
}

export class EmailUtils {
  static validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static sanitizeSubject(subject: string): string {
    // Remover caracteres que pueden causar problemas
    return subject
      .replace(/[\r\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 200); // Límite de longitud
  }

  static generateUnsubscribeLink(leadId: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    return `${baseUrl}/unsubscribe?lead=${leadId}`;
  }

  static formatMetricsForReport(metrics: EmailMetrics): string {
    // Cálculos seguros para evitar división por cero
    const deliveryRate =
      metrics.emailsSent > 0
        ? (
            ((metrics.emailsSent - metrics.emailsFailed) / metrics.emailsSent) *
            100
          ).toFixed(1)
        : "0";

    const responseRate =
      metrics.totalLeads > 0
        ? ((metrics.responsesReceived / metrics.totalLeads) * 100).toFixed(1)
        : "0";

    const conversionRate =
      metrics.totalLeads > 0 && metrics.conversions
        ? ((metrics.conversions / metrics.totalLeads) * 100).toFixed(1)
        : "0";

    return `
Métricas del Sistema de Email:
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Resumen General:
• Leads procesados: ${metrics.totalLeads}
• Emails enviados: ${metrics.emailsSent}
• Emails fallidos: ${metrics.emailsFailed}
• Respuestas recibidas: ${metrics.responsesReceived}

📈 Tasas de Conversión:
• Tasa de entrega: ${deliveryRate}%
• Tasa de respuesta: ${responseRate}%
• Tasa de conversión: ${conversionRate}%

⏰ Última actualización: ${new Date().toLocaleString("es-ES")}
    `.trim();
  }

  static createEmailTemplate(
    title: string,
    content: string,
    footer?: string
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Source Sans Pro', Arial, sans-serif; line-height: 1.6; color: #000000; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #223979 0%, #7692CB 100%); color: white; padding: 30px 20px; text-align: center; }
    .content { padding: 30px; }
    .footer { background: #f3f4f6; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 24px;">${title}</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      ${footer || "Umi - Sistema automatizado"}
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Escapar caracteres HTML para prevenir XSS
   */
  static escapeHtml(text: string): string {
    const htmlEscapes: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#x27;",
      "/": "&#x2F;",
    };

    return text.replace(/[&<>"'/]/g, (match) => htmlEscapes[match] || match);
  }

  /**
   * Truncar texto para previews de email
   */
  static truncateText(text: string, maxLength: number = 150): string {
    if (text.length <= maxLength) return text;

    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");

    return lastSpace > 0
      ? truncated.substring(0, lastSpace) + "..."
      : truncated + "...";
  }

  /**
   * Validar que un template ID sea válido
   */
  static isValidTemplateId(templateId: string): boolean {
    const validTemplates = [
      "diagnostic_welcome",
      "diagnostic_followup_1",
      "diagnostic_followup_2",
      "diagnostic_urgent",
      "diagnostic_final",
    ];

    return validTemplates.includes(templateId);
  }

  /**
   * Generar tracking pixel para emails
   */
  static generateTrackingPixel(leadId: string, emailId: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    return `<img src="${baseUrl}/api/email/track?lead=${leadId}&email=${emailId}" width="1" height="1" style="display:none;" alt="">`;
  }

  /**
   * Formatear fecha para mostrar en emails
   */
  static formatEmailDate(date: Date): string {
    return new Intl.DateTimeFormat("es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
}

// Email Templates Modulares
// src/lib/email/templates.ts

export interface EmailTemplateData {
  contactInfo: {
    name: string;
    email: string;
    company: string;
  };
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
}

export const createBaseTemplate = (content: string, title: string = "") => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Source Sans Pro', Arial, sans-serif; line-height: 1.6; color: #0A1430; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #223979 0%, #7692CB 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 12px 12px 0 0; }
    .logo { font-family: 'Domus', Arial, sans-serif; font-size: 28px; font-weight: bold; margin-bottom: 10px; }
    .header-title { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
    .content { padding: 30px; }
    .footer { background: #f3f4f6; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; border-radius: 0 0 12px 12px; }
    .cta-button { background: #223979; color: white; padding: 15px 25px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 15px 0; font-weight: 600; }
    .urgent-box { background: #fef3c7; border: 1px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .success-box { background: #ecfdf5; border: 1px solid #10b981; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .info-box { background: #f0f4ff; border: 1px solid #7692CB; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .warning-box { background: #fef2f2; border: 1px solid #ef4444; padding: 15px; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">umi</div>
      ${title ? `<div class="header-title">${title}</div>` : ""}
    </div>
    
    <div class="content">
      ${content}
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

const actionList = (data: EmailTemplateData) =>
  data.diagnosticData.quickWins.length
    ? data.diagnosticData.quickWins
        .map((win) => `<li><strong>${win.action}:</strong> ${win.description}</li>`)
        .join("")
    : "<li>Definir el primer producto Umi a activar según tu operación actual.</li>";

export const day0UrgencyTemplate = (data: EmailTemplateData): string => {
  const content = `
    <p>Hola <strong>${data.contactInfo.name}</strong>,</p>
    
    <p>Acabas de completar tu diagnóstico operativo para <strong>${data.contactInfo.company}</strong>.</p>

    <div class="urgent-box">
      <h4 style="margin-top: 0; color: #92400e;">Ruta inicial Umi</h4>
      <p>Tu nivel <strong>${data.diagnosticData.level}</strong> sugiere que el primer paso debe resolver el flujo donde hoy se pierde más contexto: pedidos, cocina, cliente, dashboard u observabilidad.</p>
    </div>

    <h4>Acciones sugeridas:</h4>
    <ul>${actionList(data)}</ul>

    <div class="success-box">
      <h4 style="margin-top: 0; color: #065f46;">Siguiente conversación</h4>
      <p>Podemos revisar el flujo actual, confirmar el cuello de botella y decidir si conviene empezar por ConversaFlow, KDS, Cash, Dashboard o Logs.</p>
    </div>

    <div style="text-align: center;">
      <a href="mailto:hola@umiconsulting.co?subject=Ruta Umi para ${encodeURIComponent(data.contactInfo.company)}" class="cta-button">
        Responder a Umi
      </a>
    </div>

    <p>Saludos,<br>
    <strong>Equipo Umi</strong></p>
  `;

  return createBaseTemplate(content, "Tu ruta Umi inicial");
};

export const day2PressureTemplate = (data: EmailTemplateData): string => {
  const content = `
    <p>Hola ${data.contactInfo.name},</p>
    
    <p>Hace 2 días completaste el diagnóstico de <strong>${data.contactInfo.company}</strong>.</p>

    <div class="warning-box">
      <p><strong>Punto a cuidar:</strong> cuando pedidos, cocina y cliente viven en herramientas separadas, cada día se acumulan excepciones que luego nadie puede auditar.</p>
    </div>

    <p>Si quieres avanzar, responde este correo con el producto que más te urge: ConversaFlow, KDS, Cash, Dashboard o Logs.</p>

    <p>Equipo Umi</p>
  `;

  return createBaseTemplate(content, "Seguimiento de tu diagnóstico Umi");
};

export const day5CaseStudyTemplate = (data: EmailTemplateData): string => {
  const content = `
    <p>Hola ${data.contactInfo.name},</p>
    
    <p>Un patrón común en restaurantes es empezar automatizando el canal equivocado. Si el pedido no está bien normalizado, KDS, wallet y dashboard terminan leyendo ruido.</p>

    <div class="info-box">
      <h4 style="margin-top: 0;">Secuencia recomendada</h4>
      <ol>
        <li>Ordenar la entrada del pedido.</li>
        <li>Mostrar cocina con estados claros.</li>
        <li>Regresar valor al cliente con Cash.</li>
        <li>Medir y auditar con Dashboard y Logs.</li>
      </ol>
    </div>

    <p>Para <strong>${data.contactInfo.company}</strong>, el diagnóstico marcó nivel ${data.diagnosticData.level}. Esa lectura nos ayuda a decidir dónde no conviene saltarnos pasos.</p>

    <p>Saludos,<br>Equipo Umi</p>
  `;

  return createBaseTemplate(content, "Cómo ordenar la activación");
};

export const day10FreeOfferTemplate = (data: EmailTemplateData): string => {
  const content = `
    <p>Hola ${data.contactInfo.name},</p>
    
    <p>Han pasado 10 días desde tu diagnóstico de ${data.contactInfo.company}.</p>

    <div class="urgent-box">
      <h4 style="color: #92400e; margin-top: 0;">Propuesta simple</h4>
      <p>Podemos revisar gratis el mapa actual de operación: cómo entra el pedido, quién lo toca, dónde se informa cocina, cómo vuelve el cliente y qué se puede auditar.</p>
    </div>

    <p>Con eso basta para elegir una ruta inicial sin venderte una suite completa antes de tiempo.</p>

    <p>Responde con "MAPA" y coordinamos.</p>

    <p>Equipo Umi</p>
  `;

  return createBaseTemplate(content, "Mapeo operativo inicial");
};

export const day30ReactivationTemplate = (data: EmailTemplateData): string => {
  const content = `
    <p>Hola ${data.contactInfo.name},</p>
    
    <p>Ha pasado un mes desde tu diagnóstico. Si ${data.contactInfo.company} sigue moviendo pedidos por canales manuales, este puede ser buen momento para revisar el flujo.</p>

    <div class="info-box">
      <h4 style="margin-top: 0;">Checklist rápido</h4>
      <ul style="margin: 10px 0;">
        <li>¿El pedido se recaptura después de WhatsApp?</li>
        <li>¿Cocina puede ver estado y tiempos sin preguntar?</li>
        <li>¿El cliente recibe actualizaciones claras?</li>
        <li>¿Gerencia puede auditar qué pasó?</li>
      </ul>
    </div>

    <p>Si alguna respuesta es no, Umi puede ayudarte a ordenar esa parte primero.</p>

    <p>Equipo Umi</p>
  `;

  return createBaseTemplate(content, "Checklist Umi de operación");
};

export const noShowTemplate = (data: EmailTemplateData): string => {
  const content = `
    <p>Hola ${data.contactInfo.name},</p>
    
    <p>No pudimos revisar hoy la ruta de ${data.contactInfo.company}. Sin problema.</p>

    <p>Tu diagnóstico sigue siendo útil para decidir por dónde empezar: pedidos, cocina, lealtad, dashboard u observabilidad.</p>

    <p>Responde con tu disponibilidad si quieres retomarlo.</p>

    <p>Equipo Umi</p>
  `;

  return createBaseTemplate(content, "Reagendemos tu ruta Umi");
};

export const EmailTemplates = {
  day0Urgency: day0UrgencyTemplate,
  day2Pressure: day2PressureTemplate,
  day5CaseStudy: day5CaseStudyTemplate,
  day10FreeOffer: day10FreeOfferTemplate,
  day30Reactivation: day30ReactivationTemplate,
  noShow: noShowTemplate,
};

export const getTemplateByDay = (
  day: number,
  trigger: string = "no_response"
) => {
  if (trigger === "no_response") {
    switch (day) {
      case 0:
        return EmailTemplates.day0Urgency;
      case 2:
        return EmailTemplates.day2Pressure;
      case 5:
        return EmailTemplates.day5CaseStudy;
      case 10:
        return EmailTemplates.day10FreeOffer;
      case 30:
        return EmailTemplates.day30Reactivation;
      default:
        return null;
    }
  } else if (trigger === "no_show") {
    return EmailTemplates.noShow;
  }

  return null;
};

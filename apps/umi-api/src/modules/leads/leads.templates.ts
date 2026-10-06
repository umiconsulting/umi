/**
 * Landing-page email templates (Phase 5) — ported verbatim from
 * `umi-landing-page/src/lib/email/templates.ts` and the inline contact-form
 * templates in `.../app/api/contact/route.ts`. Pure functions: data → HTML.
 * Kept in the leads module (spec §7.3: "…+ modules/leads templates"), not the
 * shared adapter, because the copy is landing-domain-specific.
 */

/**
 * HTML-entity escaper for user-controlled text interpolated into email markup.
 * The contact/diagnostic forms are PUBLIC, so name/company/email/message/need are
 * attacker-controlled — without this, a submitter could inject arbitrary HTML into
 * the internal notification and the customer-facing emails.
 */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The template view-model. `recommendations` drive the quick-win bullets. */
export interface LeadTemplateData {
  name: string;
  email: string;
  company: string;
  diagnostic: {
    score: number;
    level: string;
    recommendations: string[];
  };
}

const brandBase = (content: string, title = ''): string => `
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
      ${title ? `<div class="header-title">${title}</div>` : ''}
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

const actionList = (data: LeadTemplateData): string =>
  data.diagnostic.recommendations.length
    ? data.diagnostic.recommendations.map((r) => `<li><strong>${esc(r)}</strong></li>`).join('')
    : '<li>Definir el primer producto Umi a activar según tu operación actual.</li>';

// ── Diagnostic follow-up sequence (day 0/2/5/10/30) ──────────────────────────

export const day0UrgencyTemplate = (data: LeadTemplateData): string =>
  brandBase(
    `
    <p>Hola <strong>${esc(data.name)}</strong>,</p>
    <p>Acabas de completar tu diagnóstico operativo para <strong>${esc(data.company)}</strong>.</p>
    <div class="urgent-box">
      <h4 style="margin-top: 0; color: #92400e;">Ruta inicial Umi</h4>
      <p>Tu nivel <strong>${esc(data.diagnostic.level)}</strong> sugiere que el primer paso debe resolver el flujo donde hoy se pierde más contexto: pedidos, cocina, cliente, dashboard u observabilidad.</p>
    </div>
    <h4>Acciones sugeridas:</h4>
    <ul>${actionList(data)}</ul>
    <div class="success-box">
      <h4 style="margin-top: 0; color: #065f46;">Siguiente conversación</h4>
      <p>Podemos revisar el flujo actual, confirmar el cuello de botella y decidir si conviene empezar por ConversaFlow, KDS, Cash, Dashboard o Logs.</p>
    </div>
    <div style="text-align: center;">
      <a href="mailto:hola@umiconsulting.co?subject=Ruta Umi para ${encodeURIComponent(data.company)}" class="cta-button">Responder a Umi</a>
    </div>
    <p>Saludos,<br><strong>Equipo Umi</strong></p>
  `,
    'Tu ruta Umi inicial',
  );

export const day2PressureTemplate = (data: LeadTemplateData): string =>
  brandBase(
    `
    <p>Hola ${esc(data.name)},</p>
    <p>Hace 2 días completaste el diagnóstico de <strong>${esc(data.company)}</strong>.</p>
    <div class="warning-box">
      <p><strong>Punto a cuidar:</strong> cuando pedidos, cocina y cliente viven en herramientas separadas, cada día se acumulan excepciones que luego nadie puede auditar.</p>
    </div>
    <p>Si quieres avanzar, responde este correo con el producto que más te urge: ConversaFlow, KDS, Cash, Dashboard o Logs.</p>
    <p>Equipo Umi</p>
  `,
    'Seguimiento de tu diagnóstico Umi',
  );

export const day5CaseStudyTemplate = (data: LeadTemplateData): string =>
  brandBase(
    `
    <p>Hola ${esc(data.name)},</p>
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
    <p>Para <strong>${esc(data.company)}</strong>, el diagnóstico marcó nivel ${esc(data.diagnostic.level)}. Esa lectura nos ayuda a decidir dónde no conviene saltarnos pasos.</p>
    <p>Saludos,<br>Equipo Umi</p>
  `,
    'Cómo ordenar la activación',
  );

export const day10FreeOfferTemplate = (data: LeadTemplateData): string =>
  brandBase(
    `
    <p>Hola ${esc(data.name)},</p>
    <p>Han pasado 10 días desde tu diagnóstico de ${esc(data.company)}.</p>
    <div class="urgent-box">
      <h4 style="color: #92400e; margin-top: 0;">Propuesta simple</h4>
      <p>Podemos revisar gratis el mapa actual de operación: cómo entra el pedido, quién lo toca, dónde se informa cocina, cómo vuelve el cliente y qué se puede auditar.</p>
    </div>
    <p>Con eso basta para elegir una ruta inicial sin venderte una suite completa antes de tiempo.</p>
    <p>Responde con "MAPA" y coordinamos.</p>
    <p>Equipo Umi</p>
  `,
    'Mapeo operativo inicial',
  );

export const day30ReactivationTemplate = (data: LeadTemplateData): string =>
  brandBase(
    `
    <p>Hola ${esc(data.name)},</p>
    <p>Ha pasado un mes desde tu diagnóstico. Si ${esc(data.company)} sigue moviendo pedidos por canales manuales, este puede ser buen momento para revisar el flujo.</p>
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
  `,
    'Checklist Umi de operación',
  );

// ── Contact form (internal notification + client auto-reply) ─────────────────

const NEED_LABELS: Record<string, string> = {
  conversaflow: 'Pedidos y atención por WhatsApp',
  kds: 'Cocina / KDS',
  cash: 'Lealtad / wallet',
  suite: 'Suite completa',
  indeciso: 'Aún no sabe por dónde empezar',
};

export interface ContactTemplateData {
  name: string;
  email: string;
  company?: string;
  need?: string;
  message?: string;
}

export const contactInternalTemplate = (data: ContactTemplateData): string => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
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
  .footer { background: #f3f4f6; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; border-radius: 0 0 8px 8px; }
  .cta-button { background: #223979; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 15px 0; }
</style></head>
<body>
  <div class="container">
    <div class="header"><div class="logo">umi</div><p>Nueva consulta recibida</p></div>
    <div class="content">
      <div class="section">
        <span class="label">Cliente Potencial:</span>
        <div class="value priority-high">
          <strong>${esc(data.name)}</strong><br>
          Email: ${esc(data.email)}<br>
          Empresa: ${esc(data.company || 'No especificada')}
        </div>
      </div>
      <div class="section">
        <span class="label">Producto o necesidad:</span>
        <div class="value priority-medium">${esc((data.need && NEED_LABELS[data.need]) || data.need || 'No especificada')}</div>
      </div>
      <div class="section">
        <span class="label">Mensaje:</span>
        <div class="value">${esc(data.message || 'Sin mensaje adicional')}</div>
      </div>
      <div style="text-align: center;">
        <a href="mailto:${esc(data.email)}" class="cta-button">Responder Directamente</a>
      </div>
    </div>
    <div class="footer">
      <p><strong>Umi</strong> - Sistema operativo para restaurantes conectados</p>
    </div>
  </div>
</body>
</html>
`;

export const contactAutoReplyTemplate = (data: ContactTemplateData): string => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: 'Source Sans Pro', Arial, sans-serif; line-height: 1.6; color: #333; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: #223979; color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
  .logo { font-family: 'Domus', Arial, sans-serif; font-size: 28px; font-weight: bold; margin-bottom: 10px; }
  .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
  .footer { background: #f3f4f6; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; border-radius: 0 0 8px 8px; }
  .cta-button { background: #7692CB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 15px 0; }
  .highlight { background: #f0f4ff; padding: 15px; border-radius: 6px; border-left: 3px solid #7692CB; margin: 20px 0; }
</style></head>
<body>
  <div class="container">
    <div class="header"><div class="logo">umi</div><p>Gracias por contactarnos</p></div>
    <div class="content">
      <p>Hola <strong>${esc(data.name)}</strong>,</p>
      <p>Hemos recibido tu consulta y queremos agradecerte por considerar Umi para conectar tu operación.</p>
      <div class="highlight">
        <strong>¿Qué sigue ahora?</strong><br>
        • Revisaremos tu solicitud por producto y prioridad operativa<br>
        • Te contactaremos para entender tu flujo actual<br>
        • Prepararemos una ruta inicial sin inflar alcance
      </div>
      <p>Mientras tanto, si no lo has hecho, puedes completar el diagnóstico operativo para ubicar el primer producto a activar.</p>
      <div style="text-align: center;">
        <a href="https://umiconsulting.co/#diagnostico" class="cta-button">Realizar diagnóstico</a>
      </div>
      <p>Saludos cordiales,<br><strong>Equipo Umi</strong></p>
    </div>
    <div class="footer">
      <p><strong>Umi</strong></p>
      <p>hola@umiconsulting.co | +52 667 730 1913</p>
    </div>
  </div>
</body>
</html>
`;

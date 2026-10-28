import { NextRequest, NextResponse } from 'next/server';
import { createEmailService, getInternalEmail } from '@/lib/email/email-service';

interface DemoRequest {
  name: string;
  company: string;
  email: string;
  phone: string;
  message: string;
  privacyAccepted: boolean;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

function parseRequest(body: Record<string, unknown>): DemoRequest | null {
  const data = {
    name: clean(body.name, 100),
    company: clean(body.company, 120),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 24),
    message: clean(body.message, 1000),
    privacyAccepted: body.privacyAccepted === true,
  };
  if (!data.name || !data.company || !emailPattern.test(data.email) || !data.privacyAccepted)
    return null;
  if (data.phone && !/^[+\d\s().-]{7,24}$/.test(data.phone)) return null;
  return data;
}

function internalHtml(data: DemoRequest): string {
  return `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#142142">
    <h1>Nueva solicitud de demo</h1>
    <p><strong>Nombre:</strong> ${escapeHtml(data.name)}</p>
    <p><strong>Restaurante:</strong> ${escapeHtml(data.company)}</p>
    <p><strong>Correo:</strong> ${escapeHtml(data.email)}</p>
    <p><strong>WhatsApp:</strong> ${escapeHtml(data.phone || 'No indicado')}</p>
    <p><strong>Necesidad:</strong> ${escapeHtml(data.message || 'No indicada')}</p>
  </div>`;
}

function replyHtml(data: DemoRequest): string {
  return `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#142142">
    <h1>Recibimos tu solicitud</h1>
    <p>Hola, ${escapeHtml(data.name)}.</p>
    <p>Gracias por contarnos sobre ${escapeHtml(data.company)}. Te escribiremos para preparar una demo de Umi para tu restaurante.</p>
    <p>Equipo Umi<br><a href="mailto:hola@umiconsulting.co">hola@umiconsulting.co</a></p>
  </div>`;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const data = parseRequest(body);
  if (!data) {
    return NextResponse.json(
      { error: 'Revisa tus datos y acepta el aviso de privacidad.' },
      { status: 400 },
    );
  }

  const emailService = createEmailService();
  try {
    const internalSent = await emailService.sendEmail({
      to: getInternalEmail(),
      subject: 'Nueva solicitud de demo Umi',
      html: internalHtml(data),
      text: `Nueva solicitud de demo\nNombre: ${data.name}\nRestaurante: ${data.company}\nCorreo: ${data.email}\nWhatsApp: ${data.phone || 'No indicado'}\nNecesidad: ${data.message || 'No indicada'}`,
      replyTo: data.email,
      campaign: 'demo_request',
      priority: 'high',
    });
    if (!internalSent) {
      return NextResponse.json(
        { error: 'No pudimos enviar tu solicitud. Inténtalo de nuevo.' },
        { status: 502 },
      );
    }

    try {
      const replySent = await emailService.sendEmail({
        to: data.email,
        subject: 'Recibimos tu solicitud de demo — Umi',
        html: replyHtml(data),
        text: `Hola, ${data.name}. Recibimos tu solicitud para ${data.company}. Te escribiremos para preparar una demo de Umi. Equipo Umi.`,
        campaign: 'demo_reply',
      });
      if (!replySent) console.warn('Demo request accepted; the visitor auto-reply failed.');
    } catch (error) {
      console.warn('demo_auto_reply_failed', error instanceof Error ? error.name : 'unknown');
    }

    return NextResponse.json({ success: true, message: 'Recibimos tu solicitud.' });
  } catch (error) {
    console.error('demo_request_delivery_failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json(
      { error: 'No pudimos enviar tu solicitud. Inténtalo de nuevo.' },
      { status: 502 },
    );
  } finally {
    emailService.close();
  }
}

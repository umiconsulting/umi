import { Resend } from 'resend';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

const FROM = process.env.EMAIL_FROM ?? 'Umi Cash <noreply@umiconsulting.co>';

export async function sendWelcomeEmail(opts: {
  to: string;
  customerName: string;
  tenantName: string;
  cardNumber: string;
  slug: string;
  appUrl: string;
  brandColor?: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend || !opts.to.includes('@')) return;
  const color = opts.brandColor || '#B5605A';
  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `¡Bienvenido a ${opts.tenantName}! Tu tarjeta está lista.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:${color}">¡Hola, ${escapeHtml(opts.customerName)}!</h2>
        <p>Tu tarjeta de lealtad para <strong>${escapeHtml(opts.tenantName)}</strong> está lista.</p>
        <p style="font-family:monospace;background:#f5f0eb;padding:12px;border-radius:8px;text-align:center;font-size:18px;letter-spacing:2px">${escapeHtml(opts.cardNumber)}</p>
        <p style="color:#999;font-size:12px;margin-top:24px">Muestra el código QR de tu tarjeta en cada visita para acumular puntos.</p>
      </div>
    `,
  }).catch((err) => console.warn('[Email:welcome]', err));
}

export async function sendGiftCardEmail(opts: {
  to: string;
  recipientName: string | null;
  senderName: string | null;
  tenantName: string;
  amountMXN: string;
  message: string | null;
  redeemUrl: string;
  brandColor?: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend || !opts.to.includes('@')) return;
  const color = opts.brandColor || '#B5605A';
  const greeting = opts.recipientName ? `¡Hola, ${escapeHtml(opts.recipientName)}!` : '¡Hola!';
  const from = opts.senderName ? `<strong>${escapeHtml(opts.senderName)}</strong>` : 'alguien especial';
  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `🎁 ¡Tienes una tarjeta de regalo de ${opts.tenantName}!`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:${color}">${greeting}</h2>
        <p>${from} te ha enviado una tarjeta de regalo de <strong>${escapeHtml(opts.tenantName)}</strong> por <strong style="font-size:1.2em">${escapeHtml(opts.amountMXN)}</strong>.</p>
        ${opts.message ? `<blockquote style="border-left:4px solid ${color};margin:16px 0;padding:8px 16px;background:#fdf8f5;color:#555;font-style:italic">${escapeHtml(opts.message)}</blockquote>` : ''}
        <div style="margin:24px 0;text-align:center">
          <a href="${opts.redeemUrl}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:1rem">
            Canjear mi regalo
          </a>
        </div>
        <p style="color:#999;font-size:12px;margin-top:24px">El saldo se agregará directamente a tu tarjeta de lealtad. Si no esperabas este regalo, puedes ignorar este correo.</p>
      </div>
    `,
  }).catch((err) => console.warn('[Email:giftcard]', err));
}

export async function sendRewardEarnedEmail(opts: {
  to: string;
  customerName: string;
  tenantName: string;
  rewardName: string;
  slug: string;
  appUrl: string;
  brandColor?: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend || !opts.to.includes('@')) return;
  const color = opts.brandColor || '#B5605A';
  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `🎉 ¡Ganaste una recompensa en ${opts.tenantName}!`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:${color}">¡Felicidades, ${escapeHtml(opts.customerName)}!</h2>
        <p>Has ganado: <strong>${escapeHtml(opts.rewardName)}</strong> en <strong>${escapeHtml(opts.tenantName)}</strong>.</p>
        <p>Muestra tu tarjeta del wallet al barista para canjearla.</p>
        <p style="color:#999;font-size:12px;margin-top:24px">Si no solicitaste esto, ignora este mensaje.</p>
      </div>
    `,
  }).catch((err) => console.warn('[Email:reward]', err));
}

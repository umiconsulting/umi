import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { AppConfig } from '../config/config.schema';

// Canonical email adapter (Brevo/SMTP via nodemailer). Consolidates the
// dashboard password-reset and landing-page email-sequence senders. Pure I/O.
@Injectable()
export class EmailAdapter {
  private readonly logger = new Logger(EmailAdapter.name);
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private getTransporter(): Transporter | null {
    if (this.transporter) return this.transporter;

    const host = this.config.get('SMTP_HOST', { infer: true });
    const user = this.config.get('SMTP_USER', { infer: true });
    const pass = this.config.get('SMTP_PASSWORD', { infer: true });
    if (!host || !user || !pass) {
      this.logger.warn('email_adapter_missing_config');
      return null;
    }

    const port = this.config.get('SMTP_PORT', { infer: true }) ?? 587;
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465, // implicit TLS on 465; STARTTLS otherwise
      auth: { user, pass },
    });
    return this.transporter;
  }

  /** Send an email. Returns the provider message id, or null on failure. */
  async send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    from?: string;
  }): Promise<{ messageId: string } | null> {
    const transporter = this.getTransporter();
    if (!transporter) return null;

    // No hard-coded sender — a shared adapter must not send under a fixed tenant
    // identity. Require an explicit `from` or the configured EMAIL_FROM; skip
    // (best-effort null) when neither is set so a misconfig fails loud in logs
    // rather than mailing from the wrong domain.
    const from = params.from ?? this.config.get('EMAIL_FROM', { infer: true });
    if (!from) {
      this.logger.warn('email_adapter_missing_from');
      return null;
    }

    try {
      const info = await transporter.sendMail({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      return { messageId: info.messageId };
    } catch (err) {
      this.logger.error(`email_send_error: ${String(err)}`);
      return null;
    }
  }
}

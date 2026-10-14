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
    // A RELAY THAT NEEDS NO CREDENTIALS IS A RELAY WE STILL HAVE TO BE ABLE TO TALK TO.
    //
    // This demanded host AND user AND password, so the local stack's own mail sink
    // — Mailpit, which authenticates nobody, and is what makes the password-reset
    // email testable without sending real mail — could not be used at all: the
    // adapter answered `email_adapter_missing_config` and every reset request died
    // in silence. The password then has to be non-empty, and the pair has to be
    // complete: half a credential is a misconfiguration, and sending without the
    // other half fails in a way that reads like a provider fault.
    if (!host) {
      this.logger.warn('email_adapter_missing_config');
      return null;
    }
    if ((user && !pass) || (!user && pass)) {
      this.logger.warn('email_adapter_partial_credentials');
      return null;
    }

    const port = this.config.get('SMTP_PORT', { infer: true }) ?? 587;
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465, // implicit TLS on 465; STARTTLS otherwise
      auth: user && pass ? { user, pass } : undefined,
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
    /** Where replies go (e.g. the prospect's address on a contact notification). */
    replyTo?: string;
  }): Promise<{ messageId: string } | null> {
    const transporter = this.getTransporter();
    if (!transporter) return null;

    // No hard-coded sender — a shared adapter must not send under a fixed merchant
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
        replyTo: params.replyTo,
      });
      return { messageId: info.messageId };
    } catch (err) {
      this.logger.error(`email_send_error: ${String(err)}`);
      return null;
    }
  }
}

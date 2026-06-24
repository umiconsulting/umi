import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';

// Ported from umi-conversaflow `_shared/adapters/twilio.ts`. Pure I/O over the
// Twilio REST API. Node port: `btoa` → Buffer, `Deno.env` → ConfigService.
const TWILIO_API = 'https://api.twilio.com/2010-04-01/Accounts';

@Injectable()
export class TwilioAdapter {
  private readonly logger = new Logger(TwilioAdapter.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /** Send a plain WhatsApp text message. Returns the message SID, or null. */
  async sendWhatsAppMessage(params: {
    to: string;
    body: string;
    from?: string;
  }): Promise<{ sid: string } | null> {
    const accountSid = this.config.get('TWILIO_ACCOUNT_SID', { infer: true });
    const authToken = this.config.get('TWILIO_AUTH_TOKEN', { infer: true });
    const from =
      params.from ?? this.config.get('TWILIO_WHATSAPP_FROM', { infer: true });

    if (!accountSid || !authToken || !from) {
      this.logger.warn('twilio_adapter_missing_config');
      return null;
    }

    const body = new URLSearchParams({
      From: `whatsapp:${from}`,
      To: `whatsapp:${params.to}`,
      Body: params.body,
    });
    return this.post(accountSid, authToken, body, 'twilio_send');
  }

  /** Send a WhatsApp location pin via PersistentAction. Returns SID, or null. */
  async sendLocationPin(params: {
    to: string;
    from: string; // already has the whatsapp: prefix (from the inbound webhook)
    body: string;
    lat: number;
    lng: number;
    label: string;
  }): Promise<{ sid: string } | null> {
    const accountSid = this.config.get('TWILIO_ACCOUNT_SID', { infer: true });
    const authToken = this.config.get('TWILIO_AUTH_TOKEN', { infer: true });

    if (!accountSid || !authToken) {
      this.logger.warn('twilio_adapter_missing_config');
      return null;
    }

    const body = new URLSearchParams({
      From: params.from,
      To: `whatsapp:${params.to}`,
      Body: params.body,
      PersistentAction: `geo:${params.lat},${params.lng}|${params.label}`,
    });
    return this.post(accountSid, authToken, body, 'twilio_location_pin');
  }

  private async post(
    accountSid: string,
    authToken: string,
    body: URLSearchParams,
    label: string,
  ): Promise<{ sid: string } | null> {
    const url = `${TWILIO_API}/${accountSid}/Messages.json`;
    const auth =
      'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`${label}_failed status=${res.status} ${text}`);
        return null;
      }
      const data = (await res.json()) as { sid: string };
      return { sid: data.sid };
    } catch (err) {
      this.logger.error(`${label}_error: ${String(err)}`);
      return null;
    }
  }
}

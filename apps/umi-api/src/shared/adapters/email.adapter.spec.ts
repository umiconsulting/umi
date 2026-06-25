import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EmailAdapter } from './email.adapter';

function adapterWith(values: Record<string, unknown>): EmailAdapter {
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<
    Record<string, unknown>,
    true
  >;
  return new EmailAdapter(config);
}

/** Inject a fake transporter so getTransporter() short-circuits (no real SMTP). */
function withTransporter(
  adapter: EmailAdapter,
  sendMail: ReturnType<typeof vi.fn>,
) {
  (adapter as unknown as { transporter: unknown }).transporter = { sendMail };
}

const SMTP = {
  SMTP_HOST: 'smtp.brevo.com',
  SMTP_USER: 'u',
  SMTP_PASSWORD: 'p',
  EMAIL_FROM: 'noreply@umi.test',
};

describe('EmailAdapter', () => {
  it('returns null when SMTP is not configured', async () => {
    expect(
      await adapterWith({}).send({ to: 'a@b.co', subject: 's', html: '<p>x</p>' }),
    ).toBeNull();
  });

  it('sends and returns the provider message id', async () => {
    const adapter = adapterWith(SMTP);
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm-1' });
    withTransporter(adapter, sendMail);

    const result = await adapter.send({
      to: 'a@b.co',
      subject: 'hi',
      html: '<p>x</p>',
    });
    expect(result).toEqual({ messageId: 'm-1' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.co', subject: 'hi' }),
    );
  });

  it('uses EMAIL_FROM as the sender (no hard-coded fallback)', async () => {
    const adapter = adapterWith(SMTP);
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm-2' });
    withTransporter(adapter, sendMail);

    await adapter.send({ to: 'a@b.co', subject: 's', html: '<p>x</p>' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'noreply@umi.test' }),
    );
  });

  it('skips (returns null) when no from address is configured', async () => {
    const adapter = adapterWith({
      SMTP_HOST: 'smtp.brevo.com',
      SMTP_USER: 'u',
      SMTP_PASSWORD: 'p',
    }); // no EMAIL_FROM, no explicit from
    const sendMail = vi.fn();
    withTransporter(adapter, sendMail);

    const r = await adapter.send({ to: 'a@b.co', subject: 's', html: '<p>x</p>' });
    expect(r).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('returns null when sendMail throws', async () => {
    const adapter = adapterWith(SMTP);
    withTransporter(adapter, vi.fn().mockRejectedValue(new Error('smtp down')));
    expect(
      await adapter.send({ to: 'a@b.co', subject: 's', html: '<p>x</p>' }),
    ).toBeNull();
  });
});

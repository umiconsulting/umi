import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { LeadsService } from './leads.service';

function make(env: Record<string, unknown> = {}) {
  const sequences = {
    sendWelcome: vi.fn().mockResolvedValue(true),
    pauseSequence: vi.fn().mockResolvedValue(true),
    resumeSequence: vi.fn().mockResolvedValue(true),
    markResponded: vi.fn().mockResolvedValue(true),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  const email = { send: vi.fn().mockResolvedValue({ messageId: 'm1' }) };
  const config = { get: vi.fn((k: string) => env[k]) };
  return {
    svc: new LeadsService(sequences as never, email as never, config as never),
    sequences,
    email,
    config,
  };
}

describe('LeadsService.sendContact', () => {
  it('sends the internal notification (reply-to prospect) + the auto-reply', async () => {
    const h = make({ CONTACT_TO_EMAIL: 'hola@umiconsulting.co' });
    const r = await h.svc.sendContact({
      name: 'Ana',
      email: 'ana@cafe.mx',
      company: 'Café Luna',
    });
    expect(r).toEqual({ sent: 2, failed: 0 });
    expect(h.email.send).toHaveBeenCalledTimes(2);
    // internal notification replies to the prospect
    expect(h.email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'hola@umiconsulting.co', replyTo: 'ana@cafe.mx' }),
    );
  });

  it('throws when both sends fail', async () => {
    const h = make({ CONTACT_TO_EMAIL: 'hola@umiconsulting.co' });
    h.email.send.mockResolvedValue(null);
    await expect(h.svc.sendContact({ name: 'Ana', email: 'ana@cafe.mx' })).rejects.toThrow();
  });

  it('fails closed (no send) when no internal recipient is configured', async () => {
    const h = make({}); // neither CONTACT_TO_EMAIL nor EMAIL_FROM
    await expect(h.svc.sendContact({ name: 'Ana', email: 'ana@cafe.mx' })).rejects.toThrow(
      'contact_internal_email_missing',
    );
    expect(h.email.send).not.toHaveBeenCalled();
  });
});

describe('LeadsService.verifyWebhookSignature', () => {
  it('accepts a correct HMAC when a secret is configured', () => {
    const h = make({ LEADS_WEBHOOK_SECRET: 's3cret' });
    const body = JSON.stringify({ type: 'email_reply', leadId: 'l1' });
    const sig = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`;
    expect(h.svc.verifyWebhookSignature(sig, body)).toBe(true);
  });

  it('rejects a wrong HMAC when a secret is configured', () => {
    const h = make({ LEADS_WEBHOOK_SECRET: 's3cret' });
    expect(h.svc.verifyWebhookSignature('sha256=deadbeef', '{}')).toBe(false);
  });

  it('fails closed in production when no secret is set', () => {
    const h = make({ NODE_ENV: 'production' });
    expect(h.svc.verifyWebhookSignature(null, '{}')).toBe(false);
  });

  it('allows in non-production when no secret is set', () => {
    const h = make({ NODE_ENV: 'development' });
    expect(h.svc.verifyWebhookSignature(null, '{}')).toBe(true);
  });
});

describe('LeadsService.handleEmailResponse', () => {
  it('maps unsubscribe → unsubscribe()', async () => {
    const h = make();
    await h.svc.handleEmailResponse({ type: 'unsubscribe', leadId: 'l1' } as never);
    expect(h.sequences.unsubscribe).toHaveBeenCalledWith('l1');
  });

  it('maps meeting_scheduled → pauseSequence()', async () => {
    const h = make();
    await h.svc.handleEmailResponse({ type: 'meeting_scheduled', leadId: 'l1' } as never);
    expect(h.sequences.pauseSequence).toHaveBeenCalledWith('l1', 'meeting_scheduled');
  });
});

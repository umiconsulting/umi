import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SequencesService } from './sequences.service';
import type { LeadRecord } from './leads.repository';

function lead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    id: 'lead-1',
    email: 'ana@cafe.mx',
    name: 'Ana',
    company: 'Café Luna',
    phone: null,
    lifecycleStatus: 'new',
    diagnosticData: { score: 3, level: 'Inicial', recommendations: ['Activar ConversaFlow'] },
    diagnosticDate: new Date().toISOString(),
    sequencePaused: false,
    pauseReason: null,
    emailsSent: [],
    lastEmailSentAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function make(enabled = true) {
  const repo = {
    listActive: vi.fn().mockResolvedValue([]),
    reserveEmailStep: vi.fn().mockResolvedValue(true),
    finalizeEmailSent: vi.fn().mockResolvedValue(undefined),
    releaseEmailStep: vi.fn().mockResolvedValue(undefined),
    setPaused: vi.fn().mockResolvedValue(true),
  };
  const email = { send: vi.fn().mockResolvedValue({ messageId: 'm1' }) };
  const config = { get: vi.fn().mockReturnValue(enabled) };
  return {
    svc: new SequencesService(repo as never, email as never, config as never),
    repo,
    email,
    config,
  };
}

describe('SequencesService.sendDueEmails', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make(true)));

  it('is a no-op when LEADS_SEQUENCE_ENABLED is false', async () => {
    const off = make(false);
    const r = await off.svc.sendDueEmails();
    expect(r.skipped).toBe(true);
    expect(off.repo.listActive).not.toHaveBeenCalled();
    expect(off.email.send).not.toHaveBeenCalled();
  });

  it('sends every step whose day has elapsed and that is not already sent', async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString();
    h.repo.listActive.mockResolvedValue([lead({ diagnosticDate: sixDaysAgo })]);
    const r = await h.svc.sendDueEmails();
    // days 0, 2, 5 are due (≤6); 10 and 30 are not.
    expect(r.sent).toBe(3);
    expect(r.processed).toBe(1);
    expect(h.email.send).toHaveBeenCalledTimes(3);
    expect(h.repo.reserveEmailStep).toHaveBeenCalledTimes(3);
    expect(h.repo.finalizeEmailSent).toHaveBeenCalledTimes(3);
    const keys = h.repo.finalizeEmailSent.mock.calls.map((c) => c[0].emailKey);
    expect(keys).toEqual([
      'diagnostic_followup_day_0',
      'diagnostic_followup_day_2',
      'diagnostic_followup_day_5',
    ]);
  });

  it('skips a step already in emails_sent (idempotent)', async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString();
    h.repo.listActive.mockResolvedValue([
      lead({ diagnosticDate: sixDaysAgo, emailsSent: ['diagnostic_followup_day_0', 'diagnostic_followup_day_2'] }),
    ]);
    const r = await h.svc.sendDueEmails();
    expect(r.sent).toBe(1); // only day 5 remains
    expect(h.email.send).toHaveBeenCalledOnce();
  });

  it('releases the reservation on a failed send so it retries later', async () => {
    h.email.send.mockResolvedValue(null); // provider failure
    h.repo.listActive.mockResolvedValue([lead()]); // today → only day 0 due
    const r = await h.svc.sendDueEmails();
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(1);
    expect(h.repo.finalizeEmailSent).not.toHaveBeenCalled();
    expect(h.repo.releaseEmailStep).toHaveBeenCalledWith(
      expect.objectContaining({ emailKey: 'diagnostic_followup_day_0' }),
    );
  });

  it('does not send when the step is already reserved by a racing path', async () => {
    h.repo.reserveEmailStep.mockResolvedValue(false); // lost the reservation race
    h.repo.listActive.mockResolvedValue([lead()]);
    const r = await h.svc.sendDueEmails();
    expect(r.sent).toBe(0);
    expect(h.email.send).not.toHaveBeenCalled();
    expect(h.repo.finalizeEmailSent).not.toHaveBeenCalled();
  });

  it('personalizes the subject with the company name', async () => {
    h.repo.listActive.mockResolvedValue([lead()]);
    await h.svc.sendDueEmails();
    expect(h.email.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('Café Luna') }),
    );
  });
});

describe('SequencesService.sendWelcome', () => {
  it('sends the day-0 step when enabled', async () => {
    const h = make(true);
    const ok = await h.svc.sendWelcome(lead());
    expect(ok).toBe(true);
    expect(h.repo.reserveEmailStep).toHaveBeenCalledWith('lead-1', 'diagnostic_followup_day_0');
    expect(h.repo.finalizeEmailSent).toHaveBeenCalledWith(
      expect.objectContaining({ emailKey: 'diagnostic_followup_day_0' }),
    );
  });

  it('does nothing when disabled', async () => {
    const h = make(false);
    const ok = await h.svc.sendWelcome(lead());
    expect(ok).toBe(false);
    expect(h.email.send).not.toHaveBeenCalled();
  });
});

describe('SequencesService actions', () => {
  it('pauseSequence writes a paused row + event', async () => {
    const h = make();
    await h.svc.pauseSequence('lead-1', 'meeting_scheduled');
    expect(h.repo.setPaused).toHaveBeenCalledWith(
      'lead-1', true, 'meeting_scheduled', 'sequence_paused', { reason: 'meeting_scheduled' },
    );
  });

  it('markResponded pauses with a responded event', async () => {
    const h = make();
    await h.svc.markResponded('lead-1', 'phone');
    expect(h.repo.setPaused).toHaveBeenCalledWith(
      'lead-1', true, 'Lead responded via phone', 'responded', { response_type: 'phone' },
    );
  });

  it('resumeSequence clears the pause', async () => {
    const h = make();
    await h.svc.resumeSequence('lead-1');
    expect(h.repo.setPaused).toHaveBeenCalledWith('lead-1', false, null, 'sequence_resumed');
  });
});

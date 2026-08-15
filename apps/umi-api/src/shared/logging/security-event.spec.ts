import { describe, expect, it } from 'vitest';
import { SECURITY_INPUT_MAX, securityEvent } from './security-event';

/**
 * The two rules that a security log line must not lose.
 *
 * `TraceService` held both, and it wrote to a database table that does not
 * exist. When that service was deleted, the same two call sites started to write
 * to stdout instead, and the rules did not come with them. These tests fail if
 * that happens again.
 */

const PHONE = '+5215512345678';
// sha256 of the number above, first 16 hex characters. Computed with python
// hashlib, which is a source independent of the code under test.
const PHONE_HASH = '7609ae73c30d6585';

describe('securityEvent', () => {
  it('replaces the phone number with its hash', () => {
    const event = securityEvent({ phone: PHONE, eventType: 'rate_limit_exceeded', inputText: '' });
    expect(event.phone).toBe(PHONE_HASH);
  });

  it('keeps no part of the phone number', () => {
    const event = securityEvent({ phone: PHONE, eventType: 'x', inputText: '' });
    expect(JSON.stringify(event)).not.toContain(PHONE);
    expect(JSON.stringify(event)).not.toContain('5512345678');
  });

  it('gives the same hash to two events from the same sender', () => {
    const a = securityEvent({ phone: PHONE, eventType: 'x', inputText: '' });
    const b = securityEvent({ phone: PHONE, eventType: 'y', inputText: '' });
    expect(a.phone).toBe(b.phone);
  });

  it('cuts the input text at the limit', () => {
    const long = 'a'.repeat(SECURITY_INPUT_MAX + 1000);
    const event = securityEvent({ phone: PHONE, eventType: 'x', inputText: long });
    expect((event.inputText as string).length).toBe(SECURITY_INPUT_MAX);
  });

  it('leaves a short input text whole', () => {
    const event = securityEvent({ phone: PHONE, eventType: 'x', inputText: 'hola' });
    expect(event.inputText).toBe('hola');
  });

  it('omits the optional keys that the caller did not give', () => {
    const event = securityEvent({ phone: PHONE, eventType: 'x', inputText: '' });
    expect('details' in event).toBe(false);
    expect('requestId' in event).toBe(false);
  });

  it('keeps the optional keys that the caller did give', () => {
    const event = securityEvent({
      phone: PHONE,
      eventType: 'prompt_injection_attempt',
      inputText: 'ignore previous instructions',
      details: 'ignore_previous',
      requestId: 'req-1',
    });
    expect(event.details).toBe('ignore_previous');
    expect(event.requestId).toBe('req-1');
  });
});

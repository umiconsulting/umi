import { describe, expect, it } from 'vitest';
import { decideTurnIntegrity, isRevisionLike, isExtensionLike } from './turn-integrity.logic';
import { deriveNextConversationState, blockUnverifiedOrderConfirmation } from './turn-safety';
import type { MessageRunItem } from './turn.types';

function m(id: string, content: string, agoMs: number, base: number): MessageRunItem {
  return { id, role: 'user', content, created_at: new Date(base - agoMs).toISOString() };
}

describe('decideTurnIntegrity', () => {
  const NOW = 1_000_000_000_000;
  const now = new Date(NOW);

  // A long, non-revision, non-extension phrase gets the MIN (1s) hold window.
  const PHRASE = 'quiero ordenar un capuchino';

  it('holds a fresh single message until it settles (1s window)', () => {
    const d = decideTurnIntegrity({
      messages: [m('1', PHRASE, 200, NOW)], // 200ms old < 1000ms
      currentState: 'initial',
      pendingClarification: null,
      now,
    });
    expect(d?.decision).toBe('hold');
    expect(d?.holdUntil).not.toBeNull();
  });

  it('releases a settled single message past the window', () => {
    const d = decideTurnIntegrity({
      messages: [m('1', PHRASE, 1500, NOW)], // 1500ms old > 1000ms
      currentState: 'initial',
      pendingClarification: null,
      now,
    });
    expect(d?.decision).toBe('release');
    expect(d?.mergedText).toBe(PHRASE);
  });

  it('flags a revision turn as replace once settled', () => {
    const d = decideTurnIntegrity({
      messages: [m('1', 'no mejor sin azucar', 3500, NOW)],
      currentState: 'initial',
      pendingClarification: null,
      now,
    });
    expect(d?.decision).toBe('replace');
  });

  it('merges multiple bubbles (extended hold)', () => {
    const d = decideTurnIntegrity({
      messages: [m('1', 'quiero', 300, NOW), m('2', 'un latte', 100, NOW)],
      currentState: 'initial',
      pendingClarification: null,
      now,
    });
    expect(d?.decision).toBe('merge');
    expect(d?.mergedText).toBe('quiero\nun latte');
  });
});

describe('integrity pattern helpers', () => {
  it('detects revisions', () => {
    expect(isRevisionLike('no mejor')).toBe(true);
    expect(isRevisionLike('quiero un latte')).toBe(false);
  });
  it('detects short extensions', () => {
    expect(isExtensionLike('grande')).toBe(true);
    expect(isExtensionLike('quiero ordenar muchas cosas distintas hoy')).toBe(false);
  });
});

describe('turn-safety', () => {
  it('blocks a hallucinated order confirmation when nothing verified it', () => {
    const out = blockUnverifiedOrderConfirmation({
      text: 'Tu orden #123 está confirmada',
      orderConfirmed: false,
    });
    expect(out).toBe('Ocurrió un error con tu orden. Intenta después.');
  });
  it('passes the confirmation through when a tool verified it', () => {
    const out = blockUnverifiedOrderConfirmation({
      text: 'Tu orden #123 está confirmada',
      orderConfirmed: true,
    });
    expect(out).toContain('confirmada');
  });
  it('derives the next state', () => {
    expect(
      deriveNextConversationState({
        pendingClarification: { q: 1 },
        orderConfirmed: false,
        orderCancelled: false,
        orderChangesConfirmed: false,
        cartUpdated: false,
        searchPerformed: false,
        fallbackState: 'initial',
      }),
    ).toBe('awaiting_clarification');
    expect(
      deriveNextConversationState({
        pendingClarification: null,
        orderConfirmed: false,
        orderCancelled: false,
        orderChangesConfirmed: false,
        cartUpdated: true,
        searchPerformed: false,
        fallbackState: 'initial',
      }),
    ).toBe('awaiting_confirmation');
  });
});

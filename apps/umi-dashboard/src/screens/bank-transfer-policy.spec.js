import { describe, expect, it } from 'vitest';
import { bankTransferDraft, prepareBankTransfer } from './bank-transfer-policy.js';

describe('bank transfer policy form', () => {
  it('restores the saved state and never mutates the API value', () => {
    const details = { holderName: 'ONCA', bankName: 'Banco', clabe: '012345678901234567' };
    const draft = bankTransferDraft(details, true);
    draft.holderName = 'Otro';
    expect(details.holderName).toBe('ONCA');
    expect(draft.enabled).toBe(true);
  });

  it('requires a recipient and at least one destination before enabling', () => {
    expect(prepareBankTransfer(bankTransferDraft(null, true))).toEqual({ error: 'identity' });
    expect(
      prepareBankTransfer({
        ...bankTransferDraft(null, true),
        holderName: 'ONCA',
        bankName: 'Banco',
      }),
    ).toEqual({ error: 'destination' });
  });

  it('accepts a CLABE with paste separators and clears empty optional fields', () => {
    expect(
      prepareBankTransfer({
        enabled: true,
        holderName: ' ONCA ',
        bankName: ' Banco ',
        clabe: '012 345 678 901 234 567',
        accountNumber: '',
      }),
    ).toEqual({
      bankTransferEnabled: true,
      bankTransferDetails: {
        holderName: 'ONCA',
        bankName: 'Banco',
        clabe: '012345678901234567',
        accountNumber: null,
      },
    });
  });

  it('rejects malformed destinations and preserves saved details when disabled', () => {
    const draft = {
      enabled: true,
      holderName: 'ONCA',
      bankName: 'Banco',
      clabe: '123',
      accountNumber: '',
    };
    expect(prepareBankTransfer(draft)).toEqual({ error: 'clabe' });
    expect(prepareBankTransfer({ ...draft, clabe: '', accountNumber: 'abc' })).toEqual({
      error: 'account',
    });
    expect(prepareBankTransfer({ ...draft, enabled: false, clabe: '012345678901234567' })).toEqual({
      bankTransferEnabled: false,
      bankTransferDetails: {
        holderName: 'ONCA',
        bankName: 'Banco',
        clabe: '012345678901234567',
        accountNumber: null,
      },
    });
  });
});

import { describe, expect, it } from 'vitest';
import '@/test/i18n.jsx';
import { formatOperationDate, formatOperationMoney } from './operations-format.js';

describe('Operations presentation', () => {
  it('formats minor-unit money without recomputing a financial fact', () => {
    expect(formatOperationMoney(12345, 'MXN')).toContain('123.45');
    expect(formatOperationMoney(null, 'MXN')).toBe('—');
  });

  it('uses the authoritative timestamp', () => {
    expect(formatOperationDate('2026-08-09T12:00:00.000Z')).not.toBe('—');
    expect(formatOperationDate(null)).toBe('—');
  });
});

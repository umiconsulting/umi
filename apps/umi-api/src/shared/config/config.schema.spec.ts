import { describe, expect, it } from 'vitest';
import { validateConfig } from './config.schema';

const base = {
  DATABASE_URL_APP: 'postgresql://umi_app:pw@localhost:5432/postgres',
  DATABASE_URL_WORKER: 'postgresql://umi_worker:pw@localhost:5432/postgres',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateConfig', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const cfg = validateConfig({ ...base });
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.CASH_WRITE_ENABLED).toBe(false);
  });

  it('parses CASH_WRITE_ENABLED="false" as boolean false (not truthy string)', () => {
    const cfg = validateConfig({ ...base, CASH_WRITE_ENABLED: 'false' });
    expect(cfg.CASH_WRITE_ENABLED).toBe(false);
  });

  it('parses CASH_WRITE_ENABLED="true" as boolean true', () => {
    const cfg = validateConfig({ ...base, CASH_WRITE_ENABLED: 'true' });
    expect(cfg.CASH_WRITE_ENABLED).toBe(true);
  });

  it('throws when a required database url is missing', () => {
    expect(() =>
      validateConfig({ REDIS_URL: base.REDIS_URL }),
    ).toThrowError(/DATABASE_URL_APP/);
  });

  it('coerces PORT from string', () => {
    const cfg = validateConfig({ ...base, PORT: '8080' });
    expect(cfg.PORT).toBe(8080);
  });
});

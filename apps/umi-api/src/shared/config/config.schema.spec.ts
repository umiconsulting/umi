import { describe, expect, it } from 'vitest';
import { validateConfig } from './config.schema';

const base = {
  NODE_ENV: 'test',
  UMI_ENVIRONMENT: 'test',
  DATABASE_TLS_MODE: 'disable',
  DATABASE_URL_APP: 'postgresql://umi_app:pw@localhost:5432/postgres',
  DATABASE_URL_WORKER: 'postgresql://umi_worker:pw@localhost:5432/postgres',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateConfig', () => {
  it('rejects an unbounded startup retry count', () => {
    expect(() => validateConfig({ ...base, STARTUP_RETRY_ATTEMPTS: '100' })).toThrowError(
      /STARTUP_RETRY_ATTEMPTS/,
    );
  });
  it('accepts a minimal valid environment and applies defaults', () => {
    const cfg = validateConfig({ ...base });
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe('test');
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

  it("rejects a typo'd boolean flag instead of silently disabling it", () => {
    expect(() => validateConfig({ ...base, CASH_WRITE_ENABLED: 'ture' })).toThrowError(
      /CASH_WRITE_ENABLED/,
    );
    expect(() => validateConfig({ ...base, OUTBOX_RELAY_ENABLED: 'enabled' })).toThrowError(
      /OUTBOX_RELAY_ENABLED/,
    );
  });

  it('accepts on/off/yes/no boolean spellings', () => {
    expect(validateConfig({ ...base, CASH_WRITE_ENABLED: 'on' }).CASH_WRITE_ENABLED).toBe(true);
    expect(validateConfig({ ...base, CASH_WRITE_ENABLED: 'off' }).CASH_WRITE_ENABLED).toBe(false);
  });

  it('throws when a required database url is missing', () => {
    expect(() =>
      validateConfig({ NODE_ENV: 'test', UMI_ENVIRONMENT: 'test', REDIS_URL: base.REDIS_URL }),
    ).toThrowError(/DATABASE_URL_APP/);
  });

  it('coerces PORT from string', () => {
    const cfg = validateConfig({ ...base, PORT: '8080' });
    expect(cfg.PORT).toBe(8080);
  });

  it('requires an explicit UMI environment', () => {
    const { UMI_ENVIRONMENT: _environment, ...withoutEnvironment } = base;
    expect(() => validateConfig(withoutEnvironment)).toThrowError(/UMI_ENVIRONMENT/);
  });

  it('accepts a complete pilot runtime configuration', () => {
    const cfg = validateConfig({
      ...base,
      NODE_ENV: 'production',
      UMI_ENVIRONMENT: 'pilot',
      PUBLIC_API_URL: 'https://pilot.example.com',
      PUBLIC_DASHBOARD_URL: 'https://pilot.example.com',
      CORS_ORIGINS: 'https://pilot.example.com',
      TRUSTED_PROXY_CIDRS: '172.31.64.10/32',
      JWT_SECRET: 'j'.repeat(32),
      APP_QR_SECRET: 'q'.repeat(32),
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'r'.repeat(32),
      MFA_OTP_PEPPER: 'm'.repeat(32),
      CUSTOMER_VALUE_SECRET: 'c'.repeat(32),
      OPERATIONS_TOKEN: 'o'.repeat(32),
      PILOT_BOOTSTRAP_TOKEN: 'b'.repeat(32),
      PILOT_BOOTSTRAP_EXPIRES_AT: '2026-12-31T23:59:59.000Z',
      RELEASE_VERSION: '6.0.0-pilot.1',
      RELEASE_GIT_COMMIT: 'a'.repeat(40),
      RELEASE_BUILD_TIMESTAMP: '2026-08-11T12:00:00.000Z',
      CONTRACT_VERSION: '2.12.0',
      EXPECTED_SCHEMA_VERSION: 'build-v3-46',
      CONFIG_SCHEMA_VERSION: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318',
    });
    expect(cfg.UMI_ENVIRONMENT).toBe('pilot');
  });

  it('rejects unsafe pilot defaults', () => {
    expect(() =>
      validateConfig({
        ...base,
        NODE_ENV: 'production',
        UMI_ENVIRONMENT: 'pilot',
        PUBLIC_API_URL: 'http://localhost:3000',
        PUBLIC_DASHBOARD_URL: 'https://pilot.example.com',
        CORS_ORIGINS: '*',
        COOKIE_SECURE: 'false',
      }),
    ).toThrowError(/PUBLIC_API_URL|CORS_ORIGINS|COOKIE_SECURE|RELEASE_VERSION/);
  });

  it('requires object storage secrets only when object storage is enabled', () => {
    expect(() => validateConfig({ ...base, OBJECT_STORAGE_ENABLED: 'true' })).toThrowError(
      /OBJECT_STORAGE_ENDPOINT|OBJECT_STORAGE_ACCESS_KEY|OBJECT_STORAGE_SECRET_KEY/,
    );
  });
});

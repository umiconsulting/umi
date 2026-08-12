import { describe, expect, it } from 'vitest';
import { validateDashboardBuildConfig } from './build-config.js';

const pilot = {
  VITE_UMI_ENVIRONMENT: 'pilot',
  VITE_AUTH_MODE: 'cookie',
  VITE_API_BASE: '',
  VITE_PUBLIC_URL: 'https://pilot.example.com',
  VITE_RELEASE_VERSION: '6.0.0-pilot.1',
  VITE_RELEASE_GIT_COMMIT: 'a'.repeat(40),
  VITE_RELEASE_BUILD_TIMESTAMP: '2026-08-11T12:00:00.000Z',
  VITE_CONTRACT_VERSION: '2.12.0',
  VITE_CONFIG_SCHEMA_VERSION: '1',
};

describe('dashboard build configuration', () => {
  it('accepts same-origin cookie auth for pilot', () => {
    expect(validateDashboardBuildConfig(pilot)).toEqual([]);
  });

  it('rejects development auth and missing release identity in pilot', () => {
    const errors = validateDashboardBuildConfig({
      VITE_UMI_ENVIRONMENT: 'pilot',
      VITE_AUTH_MODE: 'local',
      VITE_PUBLIC_URL: 'http://localhost:4000',
    });
    expect(errors.join(' ')).toMatch(/VITE_AUTH_MODE/);
    expect(errors.join(' ')).toMatch(/VITE_RELEASE_VERSION/);
    expect(errors.join(' ')).toMatch(/VITE_PUBLIC_URL/);
  });
});

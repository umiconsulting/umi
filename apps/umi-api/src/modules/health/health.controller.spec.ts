import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { HealthController } from './health.controller';
import type { HealthService } from './health.service';

describe('HealthController diagnostics', () => {
  it('fails closed when the operations token is absent or wrong', () => {
    const health = { diagnostics: vi.fn() };
    const config = { get: vi.fn().mockReturnValue('a'.repeat(32)) };
    const controller = new HealthController(
      health as unknown as HealthService,
      config as unknown as ConfigService<AppConfig, true>,
    );

    expect(() => controller.diagnostics()).toThrow('operations_access_denied');
    expect(() => controller.diagnostics('b'.repeat(32))).toThrow('operations_access_denied');
    expect(health.diagnostics).not.toHaveBeenCalled();
  });

  it('returns bounded diagnostics for the configured operations credential', () => {
    const diagnostics = { status: 'ok', metrics: {} };
    const health = { diagnostics: vi.fn().mockReturnValue(diagnostics) };
    const config = { get: vi.fn().mockReturnValue('a'.repeat(32)) };
    const controller = new HealthController(
      health as unknown as HealthService,
      config as unknown as ConfigService<AppConfig, true>,
    );

    expect(controller.diagnostics('a'.repeat(32))).toBe(diagnostics);
  });
});

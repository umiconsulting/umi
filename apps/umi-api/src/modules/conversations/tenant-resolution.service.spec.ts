import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import {
  TenantResolutionService,
  normalizeAddress,
} from './tenant-resolution.service';
import type { ChannelRepository } from './channel.repository';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DEFAULT = '99999999-9999-9999-9999-999999999999';

function make(opts: {
  account?: Awaited<ReturnType<ChannelRepository['findWhatsappAccount']>>;
  defaultTenantId?: string;
}) {
  const findWhatsappAccount = vi.fn().mockResolvedValue(opts.account ?? null);
  const channels = { findWhatsappAccount } as unknown as ChannelRepository;
  const config = {
    get: () => opts.defaultTenantId,
  } as unknown as ConfigService<AppConfig, true>;
  const svc = new TenantResolutionService(config, channels);
  return { svc, findWhatsappAccount };
}

describe('normalizeAddress', () => {
  it('strips the whatsapp: prefix and trims', () => {
    expect(normalizeAddress('whatsapp:+14155238886')).toBe('+14155238886');
    expect(normalizeAddress('  whatsapp:+14155238886 ')).toBe('+14155238886');
    expect(normalizeAddress('WhatsApp:+52155')).toBe('+52155');
    expect(normalizeAddress('+14155238886')).toBe('+14155238886');
  });

  it('returns empty string for empty/nullish input', () => {
    expect(normalizeAddress('')).toBe('');
    expect(normalizeAddress(null)).toBe('');
    expect(normalizeAddress(undefined)).toBe('');
  });
});

describe('TenantResolutionService', () => {
  it('resolves via channel_account when a number matches', async () => {
    const { svc, findWhatsappAccount } = make({
      account: {
        tenantId: TENANT,
        locationId: 'loc-1',
        channelAccountId: 'ca-1',
      },
    });
    const res = await svc.resolveInboundTenant('whatsapp:+14155238886');
    expect(res).toEqual({
      tenantId: TENANT,
      locationId: 'loc-1',
      channelAccountId: 'ca-1',
      source: 'channel_account',
    });
    // queried with both bare + prefixed forms
    expect(findWhatsappAccount).toHaveBeenCalledWith(
      '+14155238886',
      'whatsapp:+14155238886',
    );
  });

  it('falls back to DEFAULT_TENANT_ID when no account matches', async () => {
    const { svc } = make({ account: null, defaultTenantId: DEFAULT });
    const res = await svc.resolveInboundTenant('whatsapp:+14155238886');
    expect(res).toEqual({
      tenantId: DEFAULT,
      locationId: null,
      channelAccountId: null,
      source: 'default',
    });
  });

  it('returns null when no account matches and no default is configured', async () => {
    const { svc } = make({ account: null });
    expect(await svc.resolveInboundTenant('whatsapp:+14155238886')).toBeNull();
  });

  it('drops an empty address WITHOUT querying the repo or falling back to default', async () => {
    // An empty `To` is never a valid business number — it must not be mis-routed
    // into the DEFAULT_TENANT_ID catch-all (CodeRabbit #16, fail-closed).
    const { svc, findWhatsappAccount } = make({ defaultTenantId: DEFAULT });
    const res = await svc.resolveInboundTenant('');
    expect(findWhatsappAccount).not.toHaveBeenCalled();
    expect(res).toBeNull();
  });
});

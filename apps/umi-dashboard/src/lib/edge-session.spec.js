import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../public/_worker.js';

const staging = { API_ORIGIN: 'https://api-staging.umiconsulting.co' };
describe('Staging session isolation', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    ),
  );
  it('passes only staging auth cookies to the staging API', async () => {
    await worker.fetch(
      new Request('https://staging-dashboard.umiconsulting.co/api/auth/me', {
        headers: {
          cookie:
            'umi_access=production; umi_refresh=old; umi_staging_access=staging; umi_staging_refresh=current',
        },
      }),
      staging,
    );
    expect(fetch.mock.calls[0][0].headers.get('cookie')).toBe(
      'umi_access=staging; umi_refresh=current',
    );
  });
  it('isolates issued cookies on the dashboard host and preserves cookie flags', async () => {
    fetch.mockResolvedValue(
      new Response('{}', {
        headers: {
          'Set-Cookie':
            'umi_access=new; Domain=.umiconsulting.co; Path=/; HttpOnly; Secure; SameSite=Lax',
        },
      }),
    );
    const response = await worker.fetch(
      new Request('https://staging-dashboard.umiconsulting.co/api/auth/local/login', {
        method: 'POST',
      }),
      staging,
    );
    expect(response.headers.get('set-cookie')).toBe(
      'umi_staging_access=new; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
  });
  it('leaves production cookie transport unchanged', async () => {
    await worker.fetch(
      new Request('https://dashboard.umiconsulting.co/api/auth/me', {
        headers: { cookie: 'umi_access=production' },
      }),
      { API_ORIGIN: 'https://api.umiconsulting.co' },
    );
    expect(fetch.mock.calls[0][0].headers.get('cookie')).toBe('umi_access=production');
  });
});

describe('Staging cookie lifecycle', () => {
  it('preserves multiple cookies and expiry when a session is cleared', async () => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'umi_access=; Max-Age=0; Path=/; HttpOnly; Secure');
    headers.append(
      'Set-Cookie',
      'umi_refresh=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=.umiconsulting.co; Path=/; HttpOnly; Secure',
    );
    headers.append('Set-Cookie', 'umi_csrf=; Max-Age=0; Path=/; Secure');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { headers })),
    );
    const response = await worker.fetch(
      new Request('https://staging-dashboard.umiconsulting.co/api/auth/local/logout', {
        method: 'POST',
      }),
      staging,
    );
    expect(response.headers.getSetCookie()).toEqual([
      'umi_staging_access=; Max-Age=0; Path=/; HttpOnly; Secure',
      'umi_staging_refresh=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure',
      'umi_staging_csrf=; Max-Age=0; Path=/; Secure',
    ]);
  });
});

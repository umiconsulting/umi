import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

describe('Cash browser mutation boundary', () => {
  it('rejects a cross-site mutation even when the Origin names an allowed host', () => {
    const request = new NextRequest('http://localhost:3000/api/umi/tenants', {
      method: 'POST', headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' },
    });
    expect(middleware(request).status).toBe(403);
  });

  it('rejects an unrelated browser origin before the proxy can add CSRF credentials', () => {
    const request = new NextRequest('http://localhost:3000/api/umi/tenants', {
      method: 'POST', headers: { origin: 'https://unrelated.example.test' },
    });
    expect(middleware(request).status).toBe(403);
  });
});

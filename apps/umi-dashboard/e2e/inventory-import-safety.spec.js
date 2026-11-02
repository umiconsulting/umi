import { describe, expect, it } from 'vitest';
import { loginImportOwner, verifyImportedRecipeCheckout } from './inventory-import-live.js';
import { assertImportFixtureOrigins } from './inventory-import-safety.js';

const base = 'http://127.0.0.1:4083';
const fixture = { apiBase: 'http://127.0.0.1:4082' };

describe('isolated HTTP destinations before authentication', () => {
  it.each([
    ['https://example.com', fixture.apiBase],
    ['http://127.0.0.1:4073', fixture.apiBase],
    ['http://127.0.0.1:4083/remote', fixture.apiBase],
    ['http://user:secret@127.0.0.1:4083', fixture.apiBase],
    ['http://127.0.0.1:4083?redirect=remote', fixture.apiBase],
    [base, 'https://example.com'],
    [base, 'http://127.0.0.1:4072'],
    [base, 'http://127.0.0.1:4083'],
    [base, 'http://127.0.0.1:4082/api'],
    [base, 'http://127.0.0.1.evil.test:4082'],
    [base, 'https://127.0.0.1:4082'],
  ])('rejects dashboard %s and API %s before login', async (dashboard, apiBase) => {
    const page = {
      addInitScript() {
        throw new Error('Login attempted before validation');
      },
    };
    await expect(loginImportOwner(page, { ...fixture, apiBase }, dashboard)).rejects.toThrow(
      /isolated import/,
    );
  });

  it('rejects a remote checkout API before it creates a request context', async () => {
    await expect(
      verifyImportedRecipeCheckout({
        fixture: { apiBase: 'https://example.com' },
        request: {
          newContext() {
            throw new Error('HTTP context created before validation');
          },
        },
      }),
    ).rejects.toThrow(/isolated import/);
  });
});

describe('matching disposable database', () => {
  it.each([
    'postgresql://user@example.com:55435/umi_inventory_import',
    'postgresql://user@127.0.0.1:5432/umi_inventory_import',
    'postgresql://user@127.0.0.1:55435/other',
    'https://127.0.0.1:55435/umi_inventory_import',
  ])('rejects a remote or mismatched database %s', (databaseUrl) => {
    expect(() => assertImportFixtureOrigins(fixture, base, databaseUrl)).toThrow(/isolated import/);
  });
  it.each(['127.0.0.1', 'localhost'])('accepts the expected local stack at %s', (host) => {
    expect(() =>
      assertImportFixtureOrigins(
        { apiBase: `http://${host}:4082` },
        `http://${host}:4083`,
        `postgresql://user@${host}:55435/umi_inventory_import`,
      ),
    ).not.toThrow();
  });
});

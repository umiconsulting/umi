import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { PgService } from '../../shared/database/pg.service';
import { MerchantBrandingLogoRepository } from './merchant-branding.repository';

const MERCHANT = '10000000-0000-4000-8000-000000000101';
const USER = '30000000-0000-4000-8000-000000000001';

/**
 * A client that records the SQL it was handed, and a PgService that runs the work
 * inside the scoped transaction EXACTLY as the request path would.
 */
function harness() {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      statements.push(text);
      return { rows: [], rowCount: 1 };
    }),
  } as unknown as PoolClient;
  const pg = {
    runWithMerchant: vi.fn(
      async (
        _merchantId: string,
        _userId: string | null,
        work: (c: PoolClient) => Promise<unknown>,
      ) => work(client),
    ),
    withMerchant: vi.fn(),
  };
  return {
    statements,
    client,
    pg,
    repository: new MerchantBrandingLogoRepository(pg as unknown as PgService),
  };
}

describe('MerchantBrandingLogoRepository', () => {
  it('writes the bytes and the URL they are reachable at, in one scoped transaction', async () => {
    const { statements, pg, repository } = harness();

    await repository.save(MERCHANT, USER, {
      contentType: 'image/png',
      bytes: Buffer.from('png'),
      sha256: Buffer.alloc(32, 1),
      width: 768,
      height: 256,
      url: 'https://api.example.test/logos/logo.png',
      assetName: `${MERCHANT}-0123456789abcdef.png`,
    });

    expect(pg.runWithMerchant).toHaveBeenCalledTimes(1);
    expect(pg.runWithMerchant.mock.calls[0][0]).toBe(MERCHANT);
    expect(statements[0]).toContain('INSERT INTO merchant.merchant_branding_logo');
    // A stored image nothing points at, or a URL pointing at nothing, is a state
    // the readers would trip over — so both statements share the transaction.
    expect(statements[1]).toContain('UPDATE merchant.merchant SET logo_url=$2');
  });

  it('empties logo_url when the logo is removed', async () => {
    const { statements, repository } = harness();

    await repository.clear(MERCHANT, USER);

    expect(statements[0]).toContain('DELETE FROM merchant.merchant_branding_logo');
    expect(statements[1]).toContain('UPDATE merchant.merchant SET logo_url=$2');
  });

  it('reads the row under the merchant the asset name names', async () => {
    const { pg, repository } = harness();
    pg.runWithMerchant.mockResolvedValue(null);

    await expect(repository.find(MERCHANT)).resolves.toBeNull();
    expect(pg.runWithMerchant.mock.calls[0][0]).toBe(MERCHANT);
  });
});

import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { CustomerTokenService } from './customer-token.service';

const SECRET = 'test-access-secret-thirty-two-plus-chars';

function customerTokenService(): CustomerTokenService {
  return new CustomerTokenService({ get: () => SECRET } as never);
}

async function staffToken(): Promise<string> {
  return new SignJWT({
    sub: '9f000000-0000-4000-8000-000000000001',
    role: 'STAFF',
    merchantId: '9f000000-0000-4000-8000-000000000002',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

describe('CustomerTokenService', () => {
  it('rejects a staff access token signed by the shared Cash key', async () => {
    expect(await customerTokenService().verify(await staffToken())).toBeNull();
  });
});

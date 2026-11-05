import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';

export function loadWalletEnv() {
  // Require an explicit file when the shell does not supply the credentials.
  const file = process.env.UMI_ENV_FILE;
  return { ...(file ? parseEnv(readFileSync(file, 'utf8')) : {}), ...process.env };
}

export async function walletAccessToken(env) {
  const endpoint = 'https://oauth2.googleapis.com/token';
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.GOOGLE_SERVICE_ACCOUNT_EMAIL)
    .setAudience(endpoint)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(createPrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')));
  const response = await fetch(endpoint, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Google authentication failed (${response.status}).`);
  const result = await response.json();
  if (!result.access_token) throw new Error('Google returned no access token.');
  return result.access_token;
}

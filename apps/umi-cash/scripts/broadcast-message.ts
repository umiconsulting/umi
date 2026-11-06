/** Send a wallet announcement through the canonical backend. */
import './_load-env';

async function main() {
  const [reference, message, ...flags] = process.argv.slice(2);
  if (!reference || !message || message.length > 200) {
    throw new Error('Usage: broadcast-message.ts <merchant-id-or-handle> "<message up to 200 characters>" [--dry]');
  }
  const origin = process.env.CASH_API_ORIGIN;
  const token = process.env.UMI_ACCESS_TOKEN;
  const cookie = process.env.UMI_SESSION_COOKIE;
  if (!origin || (!token && !cookie)) {
    throw new Error('Set CASH_API_ORIGIN and a super-admin UMI_ACCESS_TOKEN or UMI_SESSION_COOKIE.');
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else {
    headers.set('Cookie', cookie!);
    const csrf = cookie!.split(';').map((part) => part.trim()).find((part) => part.startsWith('umi_csrf='));
    if (csrf) headers.set('x-umi-csrf', csrf.slice('umi_csrf='.length));
  }
  const response = await fetch(new URL('/api/umi/broadcast', origin), {
    method: 'POST', headers,
    body: JSON.stringify({ reference, message, dryRun: flags.includes('--dry') || flags.includes('--dry-run') }),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Announcement request failed (HTTP ${response.status}).`);
  const result = await response.json();
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Announcement failed');
  process.exitCode = 1;
});

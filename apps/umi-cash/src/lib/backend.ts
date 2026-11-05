export function backendOrigin(): string {
  const value = process.env.CASH_API_ORIGIN;
  if (!value) throw new Error('CASH_API_ORIGIN is required');
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CASH_API_ORIGIN must be an origin without credentials');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('CASH_API_ORIGIN must use HTTPS');
  }
  return url.origin;
}

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, backendOrigin()), { ...init, cache: 'no-store', redirect: 'manual' });
}

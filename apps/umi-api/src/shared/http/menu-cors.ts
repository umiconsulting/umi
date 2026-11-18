/** Only public menu reads and token-scoped order intake accept arbitrary browser origins.
 * Cookie-authenticated API routes retain their configured origin allowlist. */
export function menuCorsOptions(url: string, privateOrigins: string[]) {
  const path = url.split('?')[0];
  const browse = /^\/api\/public\/menu\/[^/]+\/?$/.test(path);
  const table = /^\/api\/public\/table-order\/[^/]+(?:\/orders)?\/?$/.test(path);
  if (browse || table) {
    return {
      origin: '*',
      credentials: false,
      methods: table ? ['GET', 'HEAD', 'POST', 'OPTIONS'] : ['GET', 'HEAD', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
      exposedHeaders: ['Retry-After'],
    };
  }
  return {
    origin: privateOrigins.length ? privateOrigins : false,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  };
}

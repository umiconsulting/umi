/**
 * THE ROUTES THE REGISTER CALLS, forwarded to umi-api when `CASH_API_ORIGIN` is
 * set. Every listed route is ported and answers from umi-api.
 *
 * ⚠️ umi-api MUST ALREADY BE DEPLOYED with `@AcceptRegisterToken()` (PR #115)
 * before this variable is set anywhere. The till sends `Authorization: Bearer`
 * from localStorage — `src/lib/authed-fetch.ts`, and that client is frozen —
 * while every ported route was cookie-only until then. Set this against an older
 * umi-api and all thirteen staff routes answer `authentication_required`.
 *
 * EXPLICIT, ONE BY ONE, for the same reason the wallet list is: a prefix would
 * silently forward a route umi-api does not serve, and the answer would be a 404
 * from an origin the operator is not looking at.
 *
 * NOT FORWARDED, each for a reason:
 *
 *   `/admin/messages` — never ported. The lifecycle bodies live in
 *   `merchant.message` now and the screen is rebuilt from there (AB#107). The
 *   route is deleted, not moved.
 *
 * The `/umi/*` panel is absent for the same reason: AB#108 replaces it with a
 * form in umi-dashboard.
 */
const REGISTER_ROUTES = [
  // The till signs in. `login` and `refresh` set the `refreshToken` cookie, and
  // both apps write it under the same name at the same path — so a session
  // opened on one side is refreshable by the other.
  '/api/:handle/auth/login',
  '/api/:handle/auth/refresh',
  '/api/:handle/auth/logout',
  // The register's screens.
  '/api/:handle/admin/analytics',
  '/api/:handle/admin/client-error',
  '/api/:handle/admin/customers',
  '/api/:handle/admin/customers/:id',
  '/api/:handle/admin/export',
  '/api/:handle/admin/gift-cards',
  '/api/:handle/admin/purchase',
  '/api/:handle/admin/reward-config',
  '/api/:handle/admin/settings',
  '/api/:handle/admin/stats',
  '/api/:handle/admin/topup',
  // Scanning. The bare route and its two children are listed separately: Next
  // matches segment counts, so the parent never catches the children.
  '/api/:handle/admin/scan',
  '/api/:handle/admin/scan/preview',
  '/api/:handle/admin/scan/seals',
  // The customer's own side: registration, her card, and bearer gift-card use.
  '/api/:handle/customers',
  '/api/:handle/card',
  '/api/:handle/card/qr',
  '/api/:handle/gift/:code',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['passkit-generator'],
    outputFileTracingIncludes: {
      '/api/*/passes/apple': ['./passes/apple/**/*'],
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('passkit-generator');
      config.externals.push('apn');
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-inline/eval needed for Next.js
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
      // No caching for API routes
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },

  /**
   * The wallet surface is served by umi-api, not by this app.
   *
   * WHY THIS APP STILL ANSWERS. Every issued pass carries
   * `https://cash.umiconsulting.co/api/{handle}/passes/apple` as its
   * `webServiceURL`. The copy on a customer's phone cannot change. This host and
   * this path must answer for as long as an issued pass exists, so this app stays.
   * It no longer needs a database, a certificate or a pass library to do it.
   *
   * `beforeFiles` is necessary. It runs before the filesystem routes, so it takes
   * the request from the `src/app/api/[slug]/passes/apple/**` handlers on disk.
   *
   * EACH ROUTE IS LISTED ONE BY ONE, and not as one prefix. The reason used to be
   * that a prefix would also catch `{serial}` and `{serial}/push-token`, which
   * umi-api does not serve. Those two handlers are now DELETED — nothing in this
   * repository called either one, and both read `loyalty.passes` and `core.tenants`
   * through Prisma, so after the cutover they answered 500 rather than anything a
   * phone could use. Apple never asked for them: a pass carries this directory as
   * its `webServiceURL` and appends its own `v1/*` paths, which are listed below.
   *
   * The list stays explicit anyway. It is the record of which paths umi-api
   * actually implements, and a prefix would silently forward some later addition
   * here to an origin that has no route for it.
   *
   * ⚠️ ROLLBACK IS ONLY AVAILABLE BEFORE THE build-v3 CUTOVER. With
   * `WALLET_API_ORIGIN` unset this returns no rewrites and the local handlers
   * serve the pass again. Those handlers use Prisma against `core.tenants` and
   * `loyalty.passes`. build-v3 does not have those schemas, so AFTER the cutover
   * the same rollback gives a 500, not the old behaviour. Before the cutover it is
   * a true rollback; after it, the only way back is a database rollback.
   * Next.js reads this at build time, so any change needs a new deployment.
   */
  async rewrites() {
    const origin = process.env.WALLET_API_ORIGIN?.replace(/\/$/, '');
    // THE REGISTER, flipped separately from the wallet and revertible separately.
    //
    // Two variables, not one, because the two surfaces carry different stakes.
    // The wallet must answer for every issued pass and has been forwarding for
    // weeks. The register is the till: if it breaks, a café cannot take a stamp.
    // One switch would mean no way to retreat from one without dropping the other.
    const cash = process.env.CASH_API_ORIGIN?.replace(/\/$/, '');
    if (!origin && !cash) return [];
    const passthrough = (source) => ({ source, destination: `${origin}${source}` });
    const toCash = (source) => ({ source, destination: `${cash}${source}` });
    return {
      beforeFiles: [
        // Apple calls these five. The path shape is frozen inside every pass.
        passthrough('/api/:handle/passes/apple/v1/log'),
        passthrough('/api/:handle/passes/apple/v1/passes/:passTypeId/:serial'),
        passthrough('/api/:handle/passes/apple/v1/devices/:deviceId/registrations/:passTypeId'),
        passthrough(
          '/api/:handle/passes/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial',
        ),
        // The customer taps these two from the card page.
        passthrough('/api/:handle/passes/apple'),
        passthrough('/api/:handle/passes/google'),
        // Google keeps this url on the loyalty object and reads it from its own
        // servers, so this host must answer it too. The url holds the stamp
        // state, so a new stamp gives a new url and Google reads the new image.
        passthrough('/api/:handle/stamp-strip/:state'),
      ]
        .filter(() => origin)
        .concat(cash ? REGISTER_ROUTES.map(toCash) : []),
    };
  },
};

export default nextConfig;

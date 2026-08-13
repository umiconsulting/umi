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
   * EACH ROUTE IS LISTED ONE BY ONE, and not as one prefix. A prefix also catches
   * `{serial}/push-token` and `{serial}`, which umi-api does not serve. Those two
   * handlers have no caller today, but a prefix would change them from a reply
   * into a 404 in this app, which is a change nobody asked for.
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
    if (!origin) return [];
    const passthrough = (source) => ({ source, destination: `${origin}${source}` });
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
      ],
    };
  },
};

export default nextConfig;

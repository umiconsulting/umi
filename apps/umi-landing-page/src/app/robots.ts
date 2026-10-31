import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: 'OAI-SearchBot', allow: '/' },
      { userAgent: '*', allow: '/' },
    ],
    sitemap: 'https://www.umiconsulting.co/sitemap.xml',
  };
}

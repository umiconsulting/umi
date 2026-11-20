import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://www.umiconsulting.co/descargas',
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: 'https://www.umiconsulting.co/',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}

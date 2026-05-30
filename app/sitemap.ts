import type { MetadataRoute } from 'next';
import { PILLAR_SLUGS } from '@/lib/pillars';

const SITE_URL = 'https://www.darkoautoedit.com';

/**
 * /sitemap.xml — páginas públicas indexáveis. Submeta no Google Search Console.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/planos`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/recursos`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    ...PILLAR_SLUGS.map((slug) => ({
      url: `${SITE_URL}/recursos/${slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/termos`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/politica`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}

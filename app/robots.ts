import type { MetadataRoute } from 'next';

const SITE_URL = 'https://www.darkoautoedit.com';

/**
 * /robots.txt — libera as páginas públicas (marketing) pra indexação e
 * bloqueia o app/admin/auth/api (não devem aparecer na busca). Aponta o sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/tools',
        '/admin',
        '/configuracoes',
        '/api',
        '/login',
        '/register',
        '/verify',
        '/verify-phone',
        '/trocar-senha',
        '/reset-password',
        '/forgot-password',
        '/access-revoked',
        '/auth',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

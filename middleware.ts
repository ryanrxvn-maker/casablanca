import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     * - _next/static (build assets)
     * - _next/image
     * - favicon.ico
     * - robots.txt / sitemap.xml / opengraph-image (arquivos de SEO — precisam
     *   ser servidos pra crawlers ANÔNIMOS; sem isso o middleware redireciona
     *   o Googlebot pra /login e mata a indexação)
     * - arquivos estaticos (imagens + audio + video — public/ assets nao precisam de auth)
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|mov|webm|mp3|wav|m4a|ogg)$).*)',
  ],
};

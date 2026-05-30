import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const CANONICAL_HOST = 'www.darkoautoedit.com';

export async function middleware(request: NextRequest) {
  // ─── Host canônico ────────────────────────────────────────────────
  // Em PRODUÇÃO, qualquer host diferente de www.darkoautoedit.com (ex.: a URL
  // crua da Vercel casablanca-ashen.vercel.app, ou o apex sem www) é
  // redirecionado pro domínio oficial. Garante que o app SEMPRE roda no
  // domínio certo — a extensão (escopada nesse domínio) sempre reconhece, e
  // evita conteúdo duplicado no SEO. Previews (VERCEL_ENV=preview) e dev
  // (localhost) NÃO são afetados.
  if (process.env.VERCEL_ENV === 'production') {
    const host = request.headers.get('host') || '';
    if (
      host &&
      host !== CANONICAL_HOST &&
      !host.startsWith('localhost') &&
      !host.startsWith('127.0.0.1')
    ) {
      const url = request.nextUrl.clone();
      url.protocol = 'https:';
      url.host = CANONICAL_HOST;
      url.port = '';
      return NextResponse.redirect(url, 308);
    }
  }

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
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|llms.txt|opengraph-image|.*\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|mov|webm|mp3|wav|m4a|ogg)$).*)',
  ],
};

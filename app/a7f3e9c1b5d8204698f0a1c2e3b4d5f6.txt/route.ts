/**
 * Chave do IndexNow (Bing / Yandex / Seznam).
 *
 * O IndexNow permite "avisar" os buscadores na hora que há páginas novas/
 * atualizadas, em vez de esperar o rastreamento natural. O protocolo exige
 * hospedar este arquivo-chave no domínio; o conteúdo é exatamente a chave.
 *
 * Submissão: POST https://api.indexnow.org/indexnow
 *   { host, key, keyLocation, urlList }
 */
export const dynamic = 'force-static';

export function GET() {
  return new Response('a7f3e9c1b5d8204698f0a1c2e3b4d5f6', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

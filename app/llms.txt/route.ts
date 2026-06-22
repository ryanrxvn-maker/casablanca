/**
 * /llms.txt — guia estruturado pra crawlers de IA (padrão emergente).
 *
 * Não é um fator de ranking comprovado, mas é barato e dá um mapa limpo do
 * site pra ChatGPT/Perplexity/Claude. Servido como text/plain.
 */
export const dynamic = 'force-static';

const SITE = 'https://www.darkoautoedit.com';

const BODY = `# Auto Edit
> Plataforma de automação de edição de vídeo. Decupagem automática, geração de B-roll, automação de vários lipsync ao mesmo tempo e legendas em lote — você liga a fila e o estúdio entrega pronto.

## Páginas principais
- [Início](${SITE}/): O que o Auto Edit automatiza e como funciona a fila.
- [Planos e preços](${SITE}/planos): Plano grátis, Basic (R$ 57/mês) e Pro (R$ 116/mês). Mensal recorrente ou anual parcelável em até 12×.
- [Termos de uso](${SITE}/termos): Termos de uso do serviço.
- [Política de privacidade](${SITE}/politica): Como os dados são tratados.

## O que o Auto Edit faz
- Decupagem automática: remove silêncios e cortes mortos; ~1 hora de trabalho vira segundos.
- Remover legenda gravada e marca d'água em lote.
- Lipsync em lote (vários avatares de uma vez) — escala de UGC.
- Geração automática de B-roll a partir de um JSON.
- Legendas automáticas.

## Fatos
- Público: editores de vídeo, criadores e agências no Brasil.
- Diferencial: processamento em FILA e em LOTE — feito pra volume, não pra um vídeo por vez.
- Idioma: português do Brasil.
- Plano grátis disponível sem cartão.
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}

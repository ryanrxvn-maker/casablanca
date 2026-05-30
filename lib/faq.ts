/**
 * FAQ canônico do Auto Edit.
 *
 * Fonte única usada em DOIS lugares:
 *   • <FaqSection> na landing (acordeão visível, renderizado no HTML via
 *     <details> — crawlers de IA NÃO executam JS, então o conteúdo precisa
 *     estar no SSR).
 *   • FAQPage JSON-LD em app/page.tsx (server component) — ajuda citação em
 *     ChatGPT / Perplexity / AI Overviews.
 *
 * Respostas escritas pra "citabilidade": resposta direta nas primeiras
 * frases, fatos específicos, blocos auto-contidos, palavras-chave de cauda
 * longa (decupagem automática, remover legenda, lipsync em lote, b-roll).
 */
export type FaqItem = { q: string; a: string };

export const FAQ: FaqItem[] = [
  {
    q: 'O que é o Auto Edit?',
    a: 'O Auto Edit é uma plataforma de automação de edição de vídeo. Ele faz decupagem, gera B-roll, dispara vários lipsync ao mesmo tempo e cria legendas em lote — você liga a fila e o estúdio entrega pronto, sem ficar no monitor.',
  },
  {
    q: 'Como funciona a decupagem automática?',
    a: 'Você sobe o vídeo e a decupagem automática remove os silêncios e cortes mortos sozinha. O que levava cerca de uma hora no manual fica pronto em segundos. Dá pra processar vários vídeos na mesma fila — ideal pra editores e agências com volume alto.',
  },
  {
    q: 'Dá pra remover legenda gravada ("queimada") do vídeo?',
    a: 'Sim. O Auto Edit remove legenda gravada e marca d’água em massa, sem custo. Essa ferramenta roda no seu próprio PC: você instala o motor local (precisa de uma GPU) e a IA limpa o lote de uma vez. Serve pra reaproveitar criativos de UGC e anúncios sem precisar regravar.',
  },
  {
    q: 'Consigo fazer lipsync de vários avatares de uma vez (HeyGen em lote)?',
    a: 'Consegue. O lipsync em lote dispara todos os avatares de uma vez — você manda a fila à noite e acorda com os vídeos prontos. É a forma mais rápida de escalar produção de UGC e avatares falantes sem clicar um por um.',
  },
  {
    q: 'Dá pra gerar B-roll automaticamente?',
    a: 'Sim. Cola o JSON, liga a fila e o Auto Edit gera o B-roll do dia inteiro. Você volta com a pasta cheia de takes e B-rolls personalizados, sem garimpar banco de imagens manualmente.',
  },
  {
    q: 'Tem plano grátis? Quanto custa?',
    a: 'Tem plano grátis pra começar sem cartão. Os planos pagos são Basic (R$ 57/mês) e Pro (R$ 116/mês), com mais ferramentas e volume. A assinatura mensal é recorrente no cartão e o plano anual pode ser parcelado em até 12×.',
  },
  {
    q: 'Serve pra agência e produção em escala?',
    a: 'Serve. O Auto Edit foi feito pra volume: fila de processamento, lote em todas as ferramentas e um pipeline que puxa o briefing e entrega sem clique manual. É pensado pra editores e agências que produzem muito vídeo por dia.',
  },
];

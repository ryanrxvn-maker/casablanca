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
 * longa (decupagem automática, lipsync em lote, b-roll, legenda SRT).
 *
 * ⚠ Só prometer o que o cliente consegue usar HOJE — ferramentas admin-only
 *   ou em manutenção não entram aqui.
 */
export type FaqItem = { q: string; a: string };

export const FAQ: FaqItem[] = [
  {
    q: 'O que é o Auto Edit?',
    a: 'O Auto Edit é uma plataforma de automação de edição de vídeo. Ele faz decupagem automática, gera B-roll com IA, dispara lipsyncs em fila e cria legendas alinhadas à copy — você liga a fila e recebe tudo pronto, sem ficar no monitor.',
  },
  {
    q: 'Como funciona a decupagem automática?',
    a: 'Você sobe o vídeo e a decupagem automática remove os silêncios e cortes mortos sozinha, com o volume da voz nivelado. O que tomava uma tarde no manual sai em minutos, e dá pra processar vários vídeos na mesma fila — ideal pra editores e agências com volume alto.',
  },
  {
    q: 'Como o Auto Edit gera legendas (SRT) alinhadas à copy?',
    a: 'Você cola a copy e sobe o áudio ou vídeo. O Gerador de SRT alinha o texto palavra por palavra com a fala e devolve o arquivo .srt pronto pra importar no CapCut — com os modelos e animações de legenda funcionando normalmente em cima dele.',
  },
  {
    q: 'Consigo fazer lipsync de vários avatares de uma vez (HeyGen em lote)?',
    a: 'Consegue. O Hey Auto monta a fila e dispara todos os avatares de uma vez na sua própria conta do HeyGen — você deixa a fila rodando e volta com os vídeos prontos. É a forma mais rápida de escalar produção de UGC e avatares falantes sem clicar um por um.',
  },
  {
    q: 'Dá pra gerar B-roll automaticamente?',
    a: 'Dá. Você cola a lista de prompts, liga a fila e o Auto B-roll gera take por take na sua conta Magnific (Freepik Premium+), sem crédito extra por vídeo. No final sai um ZIP organizado, com todos os MP4s nomeados e prontos pra timeline.',
  },
  {
    q: 'Tem plano grátis? Quanto custa?',
    a: 'Tem plano grátis pra começar sem cartão. O plano pago disponível é o Basic (R$ 57/mês), com mais ferramentas e volume; o Pro, com as automações completas, está em fase final e abre em breve. A assinatura mensal é recorrente no cartão e o plano anual pode ser parcelado em até 12×.',
  },
  {
    q: 'Serve pra agência e produção em escala?',
    a: 'Serve. O Auto Edit foi feito pra volume: fila de processamento, lote nas ferramentas e um pipeline que puxa o briefing no ClickUp e entrega sem clique manual. É pensado pra editores e agências que produzem muito vídeo por dia.',
  },
];

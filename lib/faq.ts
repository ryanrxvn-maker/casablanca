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
 * longa (decupagem automática, lipsync, legenda SRT).
 *
 * ⚠ Só prometer o que o cliente consegue usar HOJE — ferramentas admin-only
 *   ou em manutenção não entram aqui.
 */
export type FaqItem = { q: string; a: string };

export const FAQ: FaqItem[] = [
  {
    q: 'O que é o Auto Edit?',
    a: 'O Auto Edit é uma plataforma de automação de edição de vídeo. Ele faz decupagem automática, lipsync de avatar, legendas alinhadas à copy e ajustes de arquivo em lote — você liga a fila e recebe tudo pronto, sem ficar no monitor.',
  },
  {
    q: 'Como funciona a decupagem automática?',
    a: 'Você sobe o vídeo e a decupagem automática remove os silêncios e cortes mortos sozinha, com o volume da voz nivelado. O que tomava uma tarde no manual sai em minutos, e dá pra processar vários vídeos na mesma fila — ideal pra editores e agências com volume alto.',
  },
  {
    q: 'O que é a Camuflagem de áudio?',
    a: 'A Camuflagem junta duas trilhas num arquivo só: o áudio original, que o público ouve normalmente, e um áudio escondido, que é o que a transcrição automática das plataformas lê no lugar. Existe também o modo mudo, em que a IA escuta silêncio. Depois de processar, a ferramenta escuta o arquivo pronto do mesmo jeito que a plataforma escuta e mostra um selo por plataforma (TikTok, Kwai, YouTube e Meta) — a recomendação é só publicar com o selo verde. O Descamuflar devolve qualquer uma das camadas depois.',
  },
  {
    q: 'O que dá pra criar no FakePrint?',
    a: 'O FakePrint tem 41 modelos de print para criativos: telejornais (14 emissoras), sites de notícia (11 layouts), conversa de WhatsApp e Instagram DM, chamada de vídeo, post do Instagram, tweet, comentários, stories, notificação de celular e lives. A prévia atualiza a cada tecla e o download sai em PNG de alta resolução. Telejornais e lives também exportam vídeo .webm animado, e o fundo pode sair em tela verde (chroma key) pra encaixar atrás no editor.',
  },
  {
    q: 'Como o Auto Edit gera legendas (SRT) alinhadas à copy?',
    a: 'Você cola a copy e sobe o áudio ou vídeo. O Gerador de SRT alinha o texto palavra por palavra com a fala e devolve o arquivo .srt pronto pra importar no CapCut — com os modelos e animações de legenda funcionando normalmente em cima dele.',
  },
  {
    q: 'Dá pra fazer lipsync de avatar (video to video)?',
    a: 'Dá. No Lipsync Video to Video você sobe o vídeo com o rosto e o áudio novo, e a boca sai encaixada fala por fala — o avatar dizendo exatamente a copy que você quiser. Disponível no plano Premium.',
  },
  {
    q: 'Tem plano grátis? Quanto custa?',
    a: 'Tem plano grátis pra começar sem cartão. O plano pago é o Premium (R$ 57/mês), que libera todas as ferramentas — incluindo Lipsync Video to Video, Decupagem Inteligente e Gerador de SRT. A assinatura mensal é recorrente no cartão e o plano anual pode ser parcelado em até 12×.',
  },
  {
    q: 'Serve pra agência e produção em escala?',
    a: 'Serve. O Auto Edit foi feito pra volume: fila de processamento e lote em todas as ferramentas — vários arquivos de uma vez, rodando em segundo plano. É pensado pra editores e agências que produzem muito vídeo por dia.',
  },
];

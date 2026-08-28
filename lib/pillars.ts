import type { FaqItem } from './faq';

/**
 * Páginas-pilar de SEO (`/recursos/[slug]`).
 *
 * Cada pilar mira UMA keyword de cauda longa que os gigantes (CapCut, VEED,
 * Submagic, HeyGen) NÃO têm página dedicada em PT-BR. Conteúdo escrito pra:
 *   • intent comercial/transacional (quem busca já quer resolver)
 *   • citabilidade em IA: resposta direta nas primeiras frases, blocos
 *     auto-contidos, H2 em forma de pergunta, listas e fatos específicos
 *   • keyword no <title>, H1, slug, meta, primeiras 100 palavras
 *
 * Tudo renderizado no servidor (SSR) → crawler de IA (que não roda JS) lê.
 * Sem stats/depoimentos inventados — só o que o produto realmente faz.
 */
export type PillarBlock = {
  h2: string;
  body: string[];
  list?: string[];
};

export type Pillar = {
  slug: string;
  keyword: string;
  title: string; // <title> 50-60 chars
  description: string; // meta description 130-150
  kicker: string;
  h1: string;
  intro: string[];
  blocks: PillarBlock[];
  faq: FaqItem[];
  related: { slug: string; label: string }[];
};

export const PILLARS: Pillar[] = [
  {
    slug: 'decupagem-automatica',
    keyword: 'decupagem automática',
    title: 'Decupagem automática de vídeo: corte silêncios em segundos',
    description:
      'Decupagem automática que remove silêncios e cortes mortos sozinha. O que levava 1 hora vira segundos, em lote e no navegador. Comece grátis.',
    kicker: 'Decupagem',
    h1: 'Decupagem automática de vídeo',
    intro: [
      'Decupagem automática é o processo de cortar os silêncios, pausas e trechos mortos de um vídeo sem fazer isso na mão. Você sobe o arquivo, a ferramenta detecta onde não tem fala e remove tudo sozinha — o que levava cerca de uma hora na timeline fica pronto em segundos.',
      'No Auto Edit a decupagem automática roda direto no navegador e em lote: você joga vários vídeos na fila e volta com todos já apertados, no ritmo, prontos pra finalizar.',
    ],
    blocks: [
      {
        h2: 'Como funciona a decupagem automática?',
        body: [
          'A ferramenta analisa o áudio do vídeo e identifica os intervalos de silêncio entre as falas. Esses intervalos são removidos automaticamente, e os cortes são unidos pra que o resultado fique fluido — sem aquele tempo morto que cansa quem assiste.',
          'Você define o vídeo, liga a fila e faz outra coisa. Não precisa marcar corte por corte nem arrastar clipe na timeline.',
        ],
      },
      {
        h2: 'Quanto tempo a decupagem automática economiza?',
        body: [
          'Decupar um vídeo de fala na mão costuma levar de 40 minutos a mais de uma hora, dependendo da duração. A decupagem automática faz o mesmo trabalho em segundos por vídeo.',
          'Pra quem edita em volume — editores freelancer e agências — o ganho é multiplicado: em vez de uma tarde inteira cortando silêncio, a fila entrega o dia todo enquanto você cuida do que importa.',
        ],
      },
      {
        h2: 'Decupagem em lote para editores e agências',
        body: [
          'O diferencial do Auto Edit é o processamento em lote. Em vez de um vídeo por vez, você empilha vários na fila e o estúdio processa todos em sequência.',
        ],
        list: [
          'Sobe vários vídeos de uma vez',
          'A fila processa em sequência, sem você no monitor',
          'Cada vídeo volta com os silêncios já removidos',
          'Funciona pra cortes de podcast, UGC, aulas e anúncios',
        ],
      },
      {
        h2: 'Precisa instalar algo para fazer decupagem automática?',
        body: [
          'Não. O Auto Edit roda 100% no navegador. Você faz login, sobe o vídeo e usa a decupagem direto pela web — sem baixar programa, sem plugin, em qualquer computador. Dá pra começar no plano grátis, sem cartão.',
        ],
      },
    ],
    faq: [
      {
        q: 'A decupagem automática funciona em qualquer idioma?',
        a: 'A decupagem trabalha em cima do silêncio do áudio, não da transcrição, então funciona com fala em qualquer idioma — inclusive português. Ela corta onde não há voz, independentemente da língua.',
      },
      {
        q: 'Dá pra ajustar quanto silêncio é removido?',
        a: 'Sim. Você controla a sensibilidade do corte pra deixar o ritmo mais apertado ou mais respirado, conforme o estilo do vídeo.',
      },
      {
        q: 'A decupagem automática é gratuita?',
        a: 'Você pode começar no plano grátis do Auto Edit, sem cartão. O plano Premium (R$ 57/mês) libera todas as ferramentas e mais volume.',
      },
    ],
    related: [
      { slug: 'gerar-legenda-automatica', label: 'Gerar legenda automática' },
      { slug: 'automacao-de-edicao-de-video', label: 'Automação de edição de vídeo' },
    ],
  },
  {
    slug: 'automacao-de-edicao-de-video',
    keyword: 'automação de edição de vídeo',
    title: 'Automação de edição de vídeo: edite no automático e em lote',
    description:
      'Automação de edição de vídeo: decupagem, lipsync e legendas em lote, no navegador. Você liga a fila e o estúdio entrega. Comece grátis.',
    kicker: 'Automação',
    h1: 'Automação de edição de vídeo',
    intro: [
      'Automação de edição de vídeo é usar software pra fazer as tarefas repetitivas da edição — cortar silêncio, sincronizar avatar, gerar legenda — sem você executar cada passo na mão. Em vez de operar a timeline clipe por clipe, você liga uma fila e o resultado vem pronto.',
      'O Auto Edit junta essas automações num só lugar, rodando em lote e no navegador: você empilha o trabalho do dia e o estúdio entrega enquanto você cuida do que é criativo.',
    ],
    blocks: [
      {
        h2: 'O que dá pra automatizar na edição de vídeo?',
        body: [
          'As partes mais lentas e repetitivas são exatamente as que mais ganham com automação. No Auto Edit, cada uma tem sua ferramenta dedicada:',
        ],
        list: [
          'Decupagem automática — remove silêncios e cortes mortos',
          'Lipsync Video to Video — o avatar falando exatamente a sua copy',
          'Compressão e ajuste de velocidade em lote',
          'Legendas automáticas alinhadas à copy',
        ],
      },
      {
        h2: 'Por que automatizar a edição em vez de editar na mão?',
        body: [
          'Edição manual não escala: cada vídeo consome horas em tarefas mecânicas que não exigem criatividade. Automatizar essas etapas devolve tempo, padroniza a entrega e permite produzir muito mais vídeo por dia com a mesma equipe.',
          'O ponto não é tirar o editor do processo — é tirar o trabalho braçal dele e deixar a parte criativa.',
        ],
      },
      {
        h2: 'Automação de edição para agências e canais dark',
        body: [
          'Quem produz em volume — agências de UGC e canais dark que postam vários vídeos por dia — vive ou morre pela velocidade da operação. A fila em lote do Auto Edit foi feita pra esse cenário: prepara o material, dispara e colhe tudo pronto.',
        ],
      },
      {
        h2: 'Precisa instalar algo para automatizar a edição?',
        body: [
          'Não. Toda a automação roda no navegador, sem download nem plugin. Você começa no plano grátis e libera todas as ferramentas no plano Premium (R$ 57/mês).',
        ],
      },
    ],
    faq: [
      {
        q: 'A automação substitui o editor de vídeo?',
        a: 'Não. Ela automatiza o trabalho repetitivo (decupagem, legenda, lipsync) pra o editor focar na parte criativa e produzir muito mais por dia.',
      },
      {
        q: 'Automação de edição de vídeo funciona pra canais dark?',
        a: 'Funciona. O processamento em lote é ideal pra quem posta vários vídeos por dia, padronizando a entrega e acelerando a operação.',
      },
      {
        q: 'Dá pra testar de graça?',
        a: 'Dá. O Auto Edit tem plano grátis sem cartão pra você experimentar a automação antes de assinar.',
      },
    ],
    related: [
      { slug: 'decupagem-automatica', label: 'Decupagem automática' },
      { slug: 'editar-video-mais-rapido', label: 'Editar vídeo mais rápido' },
    ],
  },
  {
    slug: 'editar-video-mais-rapido',
    keyword: 'editar vídeo mais rápido',
    title: 'Como editar vídeo mais rápido: automatize o trabalho repetitivo',
    description:
      'O jeito de editar vídeo mais rápido é automatizar decupagem e legendas e processar em lote. Menos timeline, mais entrega. Comece grátis.',
    kicker: 'Velocidade',
    h1: 'Como editar vídeo mais rápido',
    intro: [
      'A forma real de editar vídeo mais rápido não é apertar atalho na timeline — é tirar de você o trabalho repetitivo. Decupagem e legenda consomem a maior parte do tempo e não exigem criatividade. Quando essas etapas viram automáticas, o vídeo fica pronto em uma fração do tempo.',
      'No Auto Edit você joga essas tarefas numa fila em lote e elas acontecem sozinhas, no navegador, enquanto você avança no resto.',
    ],
    blocks: [
      {
        h2: 'O que mais trava a velocidade da edição?',
        body: [
          'Duas tarefas dominam o tempo de uma edição de fala: cortar os silêncios e legendar. Juntas, elas costumam ser mais da metade do trabalho — e são justamente as mais mecânicas.',
        ],
      },
      {
        h2: 'Automatize a decupagem para ganhar tempo',
        body: [
          'Cortar silêncio na mão leva de 40 minutos a mais de uma hora por vídeo. A decupagem automática faz isso em segundos, removendo as pausas e unindo os cortes sozinha. É o maior ganho de velocidade isolado.',
        ],
      },
      {
        h2: 'Legenda no automático',
        body: [
          'Em vez de digitar e sincronizar linha por linha, a legenda sai direto da fala — e, se você tem a copy, o Gerador de SRT alinha o texto exato palavra por palavra. Uma etapa lenta resolvida sem você no monitor.',
        ],
      },
      {
        h2: 'Edite em lote, não um por um',
        body: [
          'O ganho final vem do lote: empilhe os vídeos do dia numa fila e deixe processar. Em vez de uma tarde por vídeo, a fila entrega o dia inteiro. Tudo no navegador, começando no plano grátis.',
        ],
      },
    ],
    faq: [
      {
        q: 'Qual a forma mais rápida de editar um vídeo de fala?',
        a: 'Automatizar a decupagem (corte de silêncios) e a legenda, e processar em lote. Essas etapas são as mais lentas e as que mais ganham com automação.',
      },
      {
        q: 'Editar mais rápido piora a qualidade?',
        a: 'Não, porque a automação cuida do trabalho mecânico (cortar silêncio, legendar). A parte criativa continua com você.',
      },
      {
        q: 'Funciona pra muitos vídeos por dia?',
        a: 'Sim. O processamento é em fila e em lote, feito justamente pra quem precisa entregar volume.',
      },
    ],
    related: [
      { slug: 'decupagem-automatica', label: 'Decupagem automática' },
      { slug: 'automacao-de-edicao-de-video', label: 'Automação de edição de vídeo' },
    ],
  },
  {
    slug: 'gerar-legenda-automatica',
    keyword: 'legenda automática',
    title: 'Gerar legenda automática em vídeo (e exportar SRT) no automático',
    description:
      'Gere legenda automática a partir da fala do vídeo e exporte em SRT, sem digitar. Em lote e no navegador. Comece grátis no Auto Edit.',
    kicker: 'Legendas',
    h1: 'Gerar legenda automática',
    intro: [
      'Legenda automática é transformar a fala do vídeo em legendas sincronizadas sem digitar nada. A ferramenta transcreve o áudio, marca o tempo de cada trecho e gera a legenda pronta — você só revisa e exporta.',
      'No Auto Edit isso roda no navegador e em lote, então dá pra legendar vários vídeos de uma vez em vez de um por um.',
    ],
    blocks: [
      {
        h2: 'Como funciona a legenda automática?',
        body: [
          'A ferramenta ouve o áudio do vídeo, converte a fala em texto e sincroniza cada linha com o momento certo. O resultado é uma legenda já encaixada no tempo, pronta pra ajustar estilo ou exportar.',
        ],
      },
      {
        h2: 'Dá para exportar a legenda em SRT?',
        body: [
          'Sim. Além de queimar a legenda no vídeo, dá pra exportar o arquivo de legenda em formato SRT pra usar no YouTube, em outro editor ou pra traduzir. O SRT é o padrão universal de legenda.',
        ],
      },
      {
        h2: 'Legendar vários vídeos de uma vez',
        body: [
          'Como o resto do Auto Edit, a legenda roda em lote: você sobe vários vídeos e a fila processa todos. Ideal pra quem precisa legendar uma série de cortes ou criativos no mesmo dia.',
        ],
      },
      {
        h2: 'Precisa instalar algo para legendar?',
        body: [
          'Não. A legenda automática funciona 100% no navegador, sem download. Você começa no plano grátis e amplia o volume no plano Premium (R$ 57/mês).',
        ],
      },
    ],
    faq: [
      {
        q: 'A legenda automática reconhece português?',
        a: 'Sim. A transcrição funciona com fala em português e gera as legendas sincronizadas a partir do áudio do vídeo.',
      },
      {
        q: 'Posso editar a legenda depois de gerada?',
        a: 'Pode. A legenda automática é um ponto de partida: você revisa o texto e ajusta o que precisar antes de exportar ou queimar no vídeo.',
      },
      {
        q: 'Consigo o arquivo SRT separado?',
        a: 'Sim, dá pra exportar a legenda em SRT pra usar no YouTube, em outro editor ou pra traduzir.',
      },
    ],
    related: [
      { slug: 'decupagem-automatica', label: 'Decupagem automática' },
      { slug: 'editar-video-mais-rapido', label: 'Editar vídeo mais rápido' },
    ],
  },
  {
    slug: 'editar-videos-para-canais-dark',
    keyword: 'editar vídeos para canais dark',
    title: 'Editar vídeos para canais dark no automático e em lote',
    description:
      'Editar vídeos para canais dark em escala: decupagem, lipsync e legendas no automático e em lote. Poste vários por dia sem travar. Comece grátis.',
    kicker: 'Canais dark',
    h1: 'Editar vídeos para canais dark',
    intro: [
      'Editar vídeos para canais dark em escala é um problema de volume: pra monetizar, você precisa postar muito, e a edição manual não acompanha. A saída é automatizar as etapas repetitivas — decupagem, lipsync e legenda — e processar tudo em lote.',
      'O Auto Edit foi feito pra esse ritmo: você empilha os vídeos do dia numa fila e o estúdio entrega, no navegador, sem você ficar na timeline.',
    ],
    blocks: [
      {
        h2: 'Por que automatizar a edição de canais dark?',
        body: [
          'Canal dark vive de frequência. Quanto mais vídeos no ar, mais visualização e mais receita — mas cada vídeo editado na mão custa horas. Automatizar a edição quebra esse teto: a mesma pessoa passa a entregar muito mais por dia.',
        ],
      },
      {
        h2: 'O fluxo de um canal dark no automático',
        body: [
          'Em vez de abrir um editor pesado pra cada vídeo, você usa cada automação na fila:',
        ],
        list: [
          'Decupagem automática corta os silêncios da narração',
          'Lipsync Video to Video gera o avatar falando, se o canal usar avatar',
          'Legenda automática fecha o vídeo',
        ],
      },
      {
        h2: 'Dá para editar vários vídeos por dia?',
        body: [
          'Esse é o ponto principal. O processamento em lote permite preparar o material do dia inteiro de uma vez e deixar a fila entregar, em vez de editar um por um. É o que torna viável manter a frequência alta de um canal dark.',
        ],
      },
      {
        h2: 'Precisa instalar programa pesado?',
        body: [
          'Não. Tudo roda no navegador, sem download nem máquina parruda. Você começa no plano grátis e libera todas as ferramentas no plano Premium (R$ 57/mês).',
        ],
      },
    ],
    faq: [
      {
        q: 'O Auto Edit serve para qualquer nicho de canal dark?',
        a: 'Serve, porque automatiza etapas que todo canal de narração usa: corte de silêncio, legenda e, quando há avatar, o lipsync. O fluxo é o mesmo independentemente do tema.',
      },
      {
        q: 'Consigo manter uma frequência alta de postagem?',
        a: 'Sim. O processamento em lote é justamente pra volume: você prepara vários vídeos de uma vez e a fila entrega, sustentando a frequência que um canal dark precisa.',
      },
      {
        q: 'Preciso de um PC potente?',
        a: 'Não. Como roda no navegador, o processamento não depende da sua máquina. Funciona em qualquer computador.',
      },
    ],
    related: [
      { slug: 'automacao-de-edicao-de-video', label: 'Automação de edição de vídeo' },
      { slug: 'decupagem-automatica', label: 'Decupagem automática' },
    ],
  },
  {
    slug: 'automacao-de-ugc',
    keyword: 'automação de UGC',
    title: 'Automação de UGC: produza criativos em lote sem regravar',
    description:
      'Automação de UGC pra agências: lipsync, decupagem e legendas pra multiplicar criativos em escala. Comece grátis no Auto Edit.',
    kicker: 'UGC',
    h1: 'Automação de UGC',
    intro: [
      'Automação de UGC é produzir e adaptar criativos de usuário (user-generated content) em escala, sem regravar e sem montar cada variação na mão. Pra agência, o gargalo nunca é gravar — é multiplicar o mesmo criativo em dezenas de versões.',
      'O Auto Edit resolve isso com ferramentas em lote: lipsync de avatar, decupagem automática e legenda alinhada pra cada variação.',
    ],
    blocks: [
      {
        h2: 'O que dá para automatizar na produção de UGC?',
        body: [
          'As tarefas que mais consomem tempo numa operação de UGC são justamente as repetitivas — e todas têm automação no Auto Edit:',
        ],
        list: [
          'Lipsync Video to Video — o avatar falando cada variação da copy',
          'Decupagem automática pra limpar cada take sem editar na mão',
          'Legenda automática pra cada variação',
        ],
      },
      {
        h2: 'Por que isso importa para uma agência?',
        body: [
          'Quem entrega UGC pra clientes precisa de volume e padronização. Automatizar a produção transforma um criativo aprovado em uma fila de variações prontas, libera o time pro trabalho criativo e aumenta quantos vídeos a agência consegue entregar por dia.',
        ],
      },
      {
        h2: 'Automação de UGC em lote, no navegador',
        body: [
          'Em vez de operar uma ferramenta por vez, você empilha o trabalho do dia numa fila única. Tudo roda no navegador, sem download — você prepara, dispara e colhe os criativos prontos.',
        ],
      },
      {
        h2: 'Dá para começar de graça?',
        body: [
          'Dá. O Auto Edit tem plano grátis sem cartão. O plano Premium (R$ 57/mês) libera todas as ferramentas e mais volume.',
        ],
      },
    ],
    faq: [
      {
        q: 'A automação de UGC substitui o criador?',
        a: 'Não. Ela automatiza a multiplicação e adaptação dos criativos (lipsync, legenda), não a gravação original. O criador continua sendo a fonte do conteúdo.',
      },
      {
        q: 'Dá para adaptar um criativo para vários clientes?',
        a: 'Sim. Com o lipsync e a legenda automática, dá pra transformar o mesmo criativo aprovado em variações pra campanhas e marcas diferentes.',
      },
      {
        q: 'Funciona para volume de agência?',
        a: 'Sim. Todas as ferramentas rodam em lote, justamente pra suportar o volume de uma operação de UGC.',
      },
    ],
    related: [
      { slug: 'automacao-de-edicao-de-video', label: 'Automação de edição de vídeo' },
      { slug: 'decupagem-automatica', label: 'Decupagem automática' },
    ],
  },
  {
    slug: 'comprimir-video-online',
    keyword: 'comprimir vídeo online',
    title: 'Comprimir vídeo online: reduza o tamanho sem perder qualidade',
    description:
      'Comprima vídeo online e reduza o tamanho do arquivo mantendo a qualidade, direto no navegador e sem instalar nada. Comece grátis no Auto Edit.',
    kicker: 'Compressor',
    h1: 'Comprimir vídeo online',
    intro: [
      'Comprimir vídeo online é reduzir o tamanho do arquivo pra ele subir mais rápido, caber no limite de upload ou ocupar menos espaço — sem jogar a qualidade no lixo. O Auto Edit faz isso direto no navegador, sem você instalar programa.',
      'A ideia é diminuir os megabytes mantendo a imagem aceitável pra publicar, enviar ou armazenar.',
    ],
    blocks: [
      {
        h2: 'Como comprimir um vídeo online?',
        body: [
          'Você sobe o vídeo e a ferramenta reprocessa o arquivo com uma compressão mais eficiente, reduzindo o tamanho final. Em poucos passos o vídeo fica mais leve, pronto pra baixar.',
        ],
      },
      {
        h2: 'Comprimir sem perder qualidade é possível?',
        body: [
          'Dá pra reduzir bastante o tamanho com perda mínima de qualidade visual, porque boa parte dos arquivos vem com bitrate maior do que precisa. O equilíbrio entre tamanho e qualidade depende do uso — publicar nas redes aceita mais compressão que um arquivo-mestre.',
        ],
      },
      {
        h2: 'Para que serve comprimir vídeo?',
        body: ['Os casos mais comuns:'],
        list: [
          'Subir mais rápido pra YouTube, Instagram ou WhatsApp',
          'Caber no limite de tamanho de uma plataforma ou e-mail',
          'Economizar espaço de armazenamento',
          'Enviar para o cliente sem travar o upload',
        ],
      },
      {
        h2: 'Precisa instalar algo para comprimir?',
        body: [
          'Não. O compressor roda 100% no navegador, sem download. Você pode usar no plano grátis e ampliar o volume no plano Premium (R$ 57/mês).',
        ],
      },
    ],
    faq: [
      {
        q: 'Comprimir o vídeo diminui muito a qualidade?',
        a: 'Não precisa. Dá pra reduzir o tamanho com perda mínima ajustando o nível de compressão ao uso — redes sociais aceitam mais compressão que um arquivo-mestre.',
      },
      {
        q: 'Qual formato de vídeo posso comprimir?',
        a: 'Os formatos de vídeo mais comuns são aceitos. Você sobe o arquivo e baixa a versão comprimida.',
      },
      {
        q: 'Preciso instalar um programa?',
        a: 'Não. A compressão é online, direto no navegador, sem download nem instalação.',
      },
    ],
    related: [
      { slug: 'decupagem-automatica', label: 'Decupagem automática' },
      { slug: 'editar-video-mais-rapido', label: 'Editar vídeo mais rápido' },
    ],
  },
];

export const PILLAR_SLUGS = PILLARS.map((p) => p.slug);

export function getPillar(slug: string): Pillar | undefined {
  return PILLARS.find((p) => p.slug === slug);
}

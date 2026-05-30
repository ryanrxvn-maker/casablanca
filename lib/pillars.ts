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
        a: 'Você pode começar no plano grátis do Auto Edit, sem cartão. Os planos Basic (R$ 57/mês) e Pro (R$ 116/mês) liberam mais volume e ferramentas.',
      },
    ],
    related: [
      { slug: 'remover-legenda-de-video', label: 'Remover legenda de vídeo' },
      { slug: 'b-roll-automatico', label: 'Gerar B-roll automático' },
    ],
  },
  {
    slug: 'remover-legenda-de-video',
    keyword: 'remover legenda de vídeo',
    title: 'Remover legenda de vídeo gravada (queimada) em lote com IA',
    description:
      'Remova legenda gravada e marca d’água de vídeos em lote com IA, sem regravar. Ideal pra reaproveitar criativos de UGC e anúncios. Comece grátis.',
    kicker: 'Remover legenda',
    h1: 'Remover legenda de vídeo gravada',
    intro: [
      'Remover legenda de vídeo gravada (a famosa legenda "queimada", que faz parte da imagem) sempre foi um problema: como ela não é uma faixa separada, não dá pra simplesmente desligar. O Auto Edit usa IA pra apagar a legenda gravada e a marca d’água direto da imagem, sem você precisar regravar nada.',
      'E faz isso em lote: você passa um monte de vídeos de uma vez e a IA limpa todos, deixando a imagem pronta pra reaproveitar.',
    ],
    blocks: [
      {
        h2: 'Como remover legenda gravada de um vídeo?',
        body: [
          'Você sobe o vídeo com a legenda queimada e a IA detecta a região da legenda (e da marca d’água) na imagem, reconstruindo o fundo por baixo. O resultado é um vídeo limpo, sem o texto que estava por cima.',
          'Como o processo é automático e em massa, dá pra limpar dezenas de criativos no mesmo lote.',
        ],
      },
      {
        h2: 'Para que serve remover a legenda de um vídeo?',
        body: [
          'O caso mais comum é reaproveitamento de criativo. Quem trabalha com UGC e anúncios recebe vídeos prontos com legenda e marca d’água — e precisa da imagem limpa pra colocar a própria legenda, traduzir ou adaptar pra outra campanha.',
        ],
        list: [
          'Reaproveitar criativos de UGC sem regravar',
          'Tirar marca d’água de vídeos de banco',
          'Limpar a imagem antes de colocar a sua própria legenda',
          'Adaptar o mesmo vídeo pra várias campanhas',
        ],
      },
      {
        h2: 'Dá pra remover a marca d’água junto?',
        body: [
          'Dá. A mesma ferramenta que apaga a legenda gravada remove marca d’água e outros elementos sobrepostos. Você marca o que precisa sair e a IA reconstrói a imagem por baixo.',
        ],
      },
      {
        h2: 'Remover legenda de vários vídeos de uma vez',
        body: [
          'Em vez de tratar um vídeo por vez, você joga o lote inteiro na fila e a IA limpa todos. É o jeito mais rápido de processar volume — sem download de programa, tudo no navegador.',
        ],
      },
    ],
    faq: [
      {
        q: 'Remover legenda gravada estraga a qualidade do vídeo?',
        a: 'A IA reconstrói a área por baixo da legenda pra manter a imagem natural. O resultado preserva a qualidade do vídeo na maior parte dos casos; em fundos muito complexos pode haver pequena variação na região tratada.',
      },
      {
        q: 'Funciona com legenda em qualquer posição?',
        a: 'Sim. Você indica a região onde está a legenda ou marca d’água — embaixo, no topo ou no canto — e a ferramenta trata aquela área.',
      },
      {
        q: 'Consigo remover legenda de vários vídeos no mesmo lote?',
        a: 'Sim. O Auto Edit é feito pra lote: você sobe vários vídeos e a IA processa todos na fila, sem precisar repetir o passo a passo.',
      },
    ],
    related: [
      { slug: 'decupagem-automatica', label: 'Decupagem automática' },
      { slug: 'lipsync-em-lote', label: 'Lipsync em lote' },
    ],
  },
  {
    slug: 'lipsync-em-lote',
    keyword: 'lipsync em lote',
    title: 'Lipsync em lote: vários avatares de uma vez (estilo HeyGen)',
    description:
      'Faça lipsync em lote e dispare todos os avatares de uma vez. Mande a fila à noite e acorde com os vídeos prontos. Escale UGC sem clicar um por um.',
    kicker: 'Lipsync',
    h1: 'Lipsync em lote',
    intro: [
      'Lipsync em lote é gerar vários vídeos de avatar falante de uma vez, em vez de um por um. Você prepara os áudios e os avatares, liga a fila e o Auto Edit dispara todos juntos — manda à noite e acorda com os vídeos prontos.',
      'É a forma mais rápida de escalar produção de UGC e avatares falantes sem ficar clicando vídeo por vídeo dentro de uma ferramenta como o HeyGen.',
    ],
    blocks: [
      {
        h2: 'O que é lipsync em lote?',
        body: [
          'Lipsync é a sincronização da boca do avatar com um áudio. Fazer "em lote" significa rodar essa sincronização pra muitos avatares e áudios ao mesmo tempo, numa fila única, sem repetir o processo manualmente pra cada um.',
          'Você define os pares de avatar + áudio, liga a fila e o estúdio entrega todos os vídeos.',
        ],
      },
      {
        h2: 'Por que fazer lipsync em lote em vez de um por um?',
        body: [
          'Quem produz UGC em escala precisa de dezenas de variações por dia. Fazer cada vídeo na mão, esperando renderizar antes de começar o próximo, trava a operação. O lote resolve isso processando tudo em sequência enquanto você faz outra coisa.',
        ],
        list: [
          'Dispara todos os avatares de uma vez',
          'Manda a fila à noite, acorda com tudo pronto',
          'Escala variações de UGC sem operador no monitor',
          'Menos clique manual, mais vídeo por dia',
        ],
      },
      {
        h2: 'Lipsync em lote para agências de UGC',
        body: [
          'Pra agência, o gargalo não é gravar — é montar a variação de cada criativo. Com o lipsync em lote você transforma um avatar e vários áudios em uma fila de vídeos prontos, padronizando a entrega e liberando o time pro trabalho criativo.',
        ],
      },
      {
        h2: 'Precisa instalar algo para fazer lipsync em lote?',
        body: [
          'Não. Tudo roda no navegador. Você sobe os áudios, escolhe os avatares, liga a fila e baixa os vídeos prontos. Dá pra testar antes nos planos pagos do Auto Edit (Basic R$ 57/mês e Pro R$ 116/mês).',
        ],
      },
    ],
    faq: [
      {
        q: 'O lipsync em lote substitui o HeyGen?',
        a: 'Ele resolve a parte que o fluxo manual de um avatar por vez não dá conta: rodar muitos avatares de uma só vez numa fila. O foco é escala e automação da produção em lote.',
      },
      {
        q: 'Quantos avatares dá pra processar de uma vez?',
        a: 'Você empilha vários avatares e áudios na mesma fila; a quantidade depende do seu plano e do volume contratado. O objetivo é justamente não ter que disparar um por um.',
      },
      {
        q: 'Os vídeos ficam prontos para baixar?',
        a: 'Sim. Quando a fila termina, os vídeos com lipsync ficam disponíveis pra download, prontos pra finalizar ou publicar.',
      },
    ],
    related: [
      { slug: 'b-roll-automatico', label: 'Gerar B-roll automático' },
      { slug: 'remover-legenda-de-video', label: 'Remover legenda de vídeo' },
    ],
  },
  {
    slug: 'b-roll-automatico',
    keyword: 'B-roll automático',
    title: 'B-roll automático: gere cortes de cobertura com IA em lote',
    description:
      'Gere B-roll automático com IA em lote: cola o JSON, liga a fila e volta com a pasta cheia de cortes congruentes. Sem garimpar banco de imagens. Comece grátis.',
    kicker: 'B-roll',
    h1: 'B-roll automático com IA',
    intro: [
      'B-roll automático é gerar os cortes de cobertura (as imagens que entram por cima da fala) sem garimpar banco de imagem na mão. No Auto Edit você cola o JSON com o roteiro, liga a fila e volta com a pasta cheia de B-roll congruente com o que está sendo dito.',
      'Em vez de pausar a edição pra procurar cada clipe, o B-roll automático entrega o conjunto pronto, em lote, direto no navegador.',
    ],
    blocks: [
      {
        h2: 'Como gerar B-roll automático?',
        body: [
          'Você fornece o roteiro estruturado (o JSON) e o Auto Edit interpreta cada trecho pra trazer um corte de cobertura coerente com o contexto. A fila processa tudo e organiza o resultado numa pasta, pronto pra encaixar na timeline.',
          'O foco é congruência: o B-roll precisa combinar com a fala, não ser imagem genérica.',
        ],
      },
      {
        h2: 'Por que automatizar o B-roll?',
        body: [
          'Procurar B-roll manualmente é um dos trabalhos mais lentos da edição. Você interrompe o ritmo, abre banco de imagem, baixa, testa, descarta. Automatizar isso devolve o tempo pro que realmente faz diferença no vídeo.',
        ],
        list: [
          'Cola o JSON e liga a fila',
          'Volta com a pasta cheia de cortes',
          'B-roll congruente com a fala, não genérico',
          'Processa o dia inteiro em lote',
        ],
      },
      {
        h2: 'B-roll automático em lote para volume',
        body: [
          'Como o resto do Auto Edit, o B-roll roda em fila. Dá pra preparar o material do dia inteiro de uma vez e deixar o estúdio entregar enquanto você cuida da decupagem, do lipsync ou da finalização.',
        ],
      },
      {
        h2: 'Precisa instalar algo?',
        body: [
          'Não. O B-roll automático roda no navegador, sem download. Você começa no plano grátis e libera mais volume nos planos Basic (R$ 57/mês) e Pro (R$ 116/mês).',
        ],
      },
    ],
    faq: [
      {
        q: 'O B-roll automático combina com o que estou falando?',
        a: 'Sim, esse é o ponto. A ferramenta lê o roteiro e busca cobertura congruente com cada trecho, em vez de devolver imagem genérica solta.',
      },
      {
        q: 'Em que formato eu entrego o roteiro?',
        a: 'Você cola um JSON estruturado com o roteiro. O Auto Edit interpreta cada trecho e gera o B-roll correspondente na fila.',
      },
      {
        q: 'Dá pra gerar B-roll de vários vídeos de uma vez?',
        a: 'Dá. O processamento é em lote: você prepara o material do dia e a fila entrega tudo, sem operar um por um.',
      },
    ],
    related: [
      { slug: 'lipsync-em-lote', label: 'Lipsync em lote' },
      { slug: 'decupagem-automatica', label: 'Decupagem automática' },
    ],
  },
  {
    slug: 'automacao-de-edicao-de-video',
    keyword: 'automação de edição de vídeo',
    title: 'Automação de edição de vídeo: edite no automático e em lote',
    description:
      'Automação de edição de vídeo: decupagem, B-roll, lipsync e legendas em lote, no navegador. Você liga a fila e o estúdio entrega. Comece grátis.',
    kicker: 'Automação',
    h1: 'Automação de edição de vídeo',
    intro: [
      'Automação de edição de vídeo é usar software pra fazer as tarefas repetitivas da edição — cortar silêncio, buscar B-roll, sincronizar avatar, gerar legenda — sem você executar cada passo na mão. Em vez de operar a timeline clipe por clipe, você liga uma fila e o resultado vem pronto.',
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
          'B-roll automático — gera cobertura congruente a partir do roteiro',
          'Lipsync em lote — dispara vários avatares de uma vez',
          'Remover legenda gravada e marca d’água em massa',
          'Legendas automáticas a partir da fala',
          'Troca de produto no áudio sem regravar a voz',
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
          'Não. Toda a automação roda no navegador, sem download nem plugin. Você começa no plano grátis e libera mais volume nos planos Basic (R$ 57/mês) e Pro (R$ 116/mês).',
        ],
      },
    ],
    faq: [
      {
        q: 'A automação substitui o editor de vídeo?',
        a: 'Não. Ela automatiza o trabalho repetitivo (decupagem, B-roll, legenda, lipsync) pra o editor focar na parte criativa e produzir muito mais por dia.',
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
      'O jeito de editar vídeo mais rápido é automatizar decupagem, B-roll e legendas e processar em lote. Menos timeline, mais entrega. Comece grátis.',
    kicker: 'Velocidade',
    h1: 'Como editar vídeo mais rápido',
    intro: [
      'A forma real de editar vídeo mais rápido não é apertar atalho na timeline — é tirar de você o trabalho repetitivo. Decupagem, busca de B-roll e legenda consomem a maior parte do tempo e não exigem criatividade. Quando essas etapas viram automáticas, o vídeo fica pronto em uma fração do tempo.',
      'No Auto Edit você joga essas tarefas numa fila em lote e elas acontecem sozinhas, no navegador, enquanto você avança no resto.',
    ],
    blocks: [
      {
        h2: 'O que mais trava a velocidade da edição?',
        body: [
          'Três tarefas dominam o tempo de uma edição de fala: cortar os silêncios, achar o B-roll certo e legendar. Juntas, elas costumam ser mais da metade do trabalho — e são justamente as mais mecânicas.',
        ],
      },
      {
        h2: 'Automatize a decupagem para ganhar tempo',
        body: [
          'Cortar silêncio na mão leva de 40 minutos a mais de uma hora por vídeo. A decupagem automática faz isso em segundos, removendo as pausas e unindo os cortes sozinha. É o maior ganho de velocidade isolado.',
        ],
      },
      {
        h2: 'B-roll e legenda no automático',
        body: [
          'Em vez de pausar pra garimpar banco de imagem, o B-roll automático entrega a cobertura a partir do roteiro. E as legendas saem direto da fala. Duas etapas lentas resolvidas sem você no monitor.',
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
        a: 'Automatizar a decupagem (corte de silêncios), o B-roll e a legenda, e processar em lote. Essas três etapas são as mais lentas e as que mais ganham com automação.',
      },
      {
        q: 'Editar mais rápido piora a qualidade?',
        a: 'Não, porque a automação cuida do trabalho mecânico (cortar silêncio, achar cobertura, legendar). A parte criativa continua com você.',
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
          'Não. A legenda automática funciona 100% no navegador, sem download. Você começa no plano grátis e amplia o volume nos planos Basic (R$ 57/mês) e Pro (R$ 116/mês).',
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
    slug: 'trocar-produto-no-video',
    keyword: 'trocar produto no vídeo',
    title: 'Trocar produto no vídeo sem regravar a voz (no automático)',
    description:
      'Trocar o produto ou a marca no vídeo sem regravar: a IA substitui no áudio e a voz original continua intacta. Em segundos. Comece grátis.',
    kicker: 'Troca de produto',
    h1: 'Trocar produto no vídeo sem regravar',
    intro: [
      'Trocar produto no vídeo é substituir a marca ou o produto citado sem precisar gravar tudo de novo. Mudou o anunciante? A IA troca a menção no áudio e a voz original do criador continua intacta — mesmo timbre, mesma entonação.',
      'É o que permite reaproveitar um mesmo criativo pra vários produtos sem chamar a pessoa pra regravar.',
    ],
    blocks: [
      {
        h2: 'Como trocar o produto no áudio sem regravar?',
        body: [
          'Você indica o que precisa ser substituído e a IA gera o novo trecho de fala com a mesma voz, encaixando no lugar da menção antiga. O resto do áudio permanece igual, então a transição fica natural.',
        ],
      },
      {
        h2: 'Por que isso economiza tanto tempo?',
        body: [
          'Regravar um vídeo só por causa do nome do produto significa reagendar o criador, regravar e reeditar tudo. Trocar só a menção no áudio resolve em segundos e mantém o criativo que já estava aprovado.',
        ],
      },
      {
        h2: 'Para quem serve trocar o produto no vídeo?',
        body: [
          'Serve pra quem revende criativos e pra agências que rodam o mesmo formato com anunciantes diferentes.',
        ],
        list: [
          'Adaptar um criativo de UGC pra outra marca',
          'Atualizar o nome do produto sem regravar',
          'Reusar um vídeo aprovado em outra campanha',
        ],
      },
      {
        h2: 'Precisa instalar algo?',
        body: [
          'Não. A troca de produto roda no navegador. Você começa no plano grátis e libera mais volume nos planos Basic (R$ 57/mês) e Pro (R$ 116/mês).',
        ],
      },
    ],
    faq: [
      {
        q: 'A voz fica diferente depois da troca?',
        a: 'O objetivo é manter a voz original do criador — mesmo timbre e entonação — substituindo apenas a menção do produto, pra a transição soar natural.',
      },
      {
        q: 'Dá pra trocar o produto em vários vídeos?',
        a: 'Sim. Como o resto do Auto Edit, dá pra processar em lote em vez de tratar um vídeo por vez.',
      },
      {
        q: 'Preciso do criador para regravar?',
        a: 'Não. A ideia é justamente não precisar regravar: a IA substitui a menção no áudio existente.',
      },
    ],
    related: [
      { slug: 'lipsync-em-lote', label: 'Lipsync em lote' },
      { slug: 'remover-legenda-de-video', label: 'Remover legenda de vídeo' },
    ],
  },
];

export const PILLAR_SLUGS = PILLARS.map((p) => p.slug);

export function getPillar(slug: string): Pillar | undefined {
  return PILLARS.find((p) => p.slug === slug);
}

import type { ReactNode } from 'react';

import {
  Mark,
  MBtn,
  MChip,
  MDrop,
  MField,
  MQueueItem,
  MRow,
  MSlider,
  MStack,
  MToggle,
  Shot,
} from './mock';

/**
 * Conteúdo dos guias de ferramenta.
 *
 * Regras da copy:
 * - passo a passo curto, imperativo, sem jargão desnecessário;
 * - nomes de botões/campos IDÊNTICOS aos da UI real;
 * - nunca prometer o que a ferramenta não faz.
 *
 * ⚠ Toda chave nova aqui precisa entrar também em GUIDE_PATHS (routes.ts).
 */

export type GuideStep = {
  title: string;
  text: ReactNode;
  visual?: ReactNode;
};

export type ToolGuide = {
  title: string;
  tagline: string;
  size?: 'large';
  steps: GuideStep[];
  tips?: string[];
};

export const GUIDES: Record<string, ToolGuide> = {
  /* ── Trabalho rápido ─────────────────────────────────────────────── */

  '/tools/decupagem': {
    title: 'Decupagem',
    tagline: 'Remove os silêncios do vídeo ou do áudio e devolve o corte limpo.',
    steps: [
      {
        title: 'Solte os arquivos',
        text: 'Arraste até 10 vídeos ou áudios pra fila. Pode misturar formatos — cada um é processado na ordem.',
        visual: (
          <Shot label="Decupagem · fila">
            <Mark n={1} x="50%" y="38%" />
            <MStack>
              <MDrop label="Solta os arquivos aqui" sub="até 10 por vez · vídeo ou áudio" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha como quer receber',
        text: 'Se a fila tiver vídeo, escolha entre receber o vídeo cortado ou só o áudio. Depois, o formato do arquivo final.',
      },
      {
        title: 'Ajuste o respiro',
        text: 'O controle "Quanto de silêncio manter?" define o ritmo: mais à esquerda fica seco e acelerado, mais à direita preserva pausas naturais.',
        visual: (
          <Shot label="Decupagem · ajuste">
            <Mark n={1} x="86%" y="40%" />
            <MSlider label="Quanto de silêncio manter?" pct={35} val="curto" />
          </Shot>
        ),
      },
      {
        title: 'Processe e compare',
        text: 'Clique no botão de processar e acompanhe cada card. No final, cada arquivo mostra quanto encolheu (% menor) e libera o download.',
        visual: (
          <Shot label="Decupagem · resultado">
            <MStack>
              <MQueueItem name="ad-hook-03.mp4" status="pronto · 31% menor" pct={100} tone="lime" />
              <MQueueItem name="body-parte2.mp4" status="processando" pct={64} />
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'O volume da voz é nivelado automaticamente antes do corte — dois locutores saem no mesmo patamar.',
      'Nenhuma palavra é comida: o corte protege o ataque da fala.',
    ],
  },

  '/tools/camuflagem': {
    title: 'Camuflagem',
    tagline:
      'Entrega um áudio pra quem assiste e outro pra transcrição automática das plataformas.',
    steps: [
      {
        title: 'Defina a intensidade',
        text: 'Comece no valor sugerido. Intensidade maior engana melhor a transcrição, mas pode deixar rastros audíveis em fones — valide sempre no passo 4.',
        visual: (
          <Shot label="Camuflagem · intensidade">
            <Mark n={1} x="86%" y="40%" />
            <MSlider label="Intensidade" pct={55} val="média" />
          </Shot>
        ),
      },
      {
        title: 'Escolha o formato de saída',
        text: 'MP4 pra subir direto na plataforma, ou apenas o áudio se você mesmo vai montar o vídeo.',
      },
      {
        title: 'Envie os dois áudios',
        text: 'No card "Original + escondido": o ORIGINAL é o que a pessoa ouve; o ESCONDIDO é o que a transcrição da plataforma vai ler no lugar.',
        visual: (
          <Shot label="Camuflagem · arquivos">
            <Mark n={1} x="28%" y="46%" />
            <Mark n={2} x="78%" y="46%" />
            <MRow>
              <div className="flex-1">
                <MDrop label="Original" sub="o que toca no vídeo" />
              </div>
              <div className="flex-1">
                <MDrop label="Escondido" sub="o que a IA vai transcrever" />
              </div>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Processe e valide com o selo',
        text: 'Depois de processar, clique em "Transcrever": a ferramenta escuta o resultado como uma IA de plataforma escutaria. O selo só fica verde quando a transcrição devolve o áudio escondido — se ficar vermelho, ajuste a intensidade e rode de novo.',
        visual: (
          <Shot label="Camuflagem · validação">
            <Mark n={1} x="24%" y="50%" />
            <MRow>
              <MBtn tone="primary">Transcrever</MBtn>
              <MChip tone="lime">SELO · CAMUFLADO ✓</MChip>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'O botão de MUDO no card dos áudios silencia o preview sem afetar o arquivo final.',
      'Precisa desfazer? O modo Descamuflar recupera o áudio escondido de um arquivo já camuflado — ou troca por outro.',
      'A camuflagem mira a transcrição automática das plataformas. Não existe garantia universal: valide sempre pelo selo.',
    ],
  },

  '/tools/downloader': {
    title: 'Downloader',
    tagline: 'Baixa vídeo, áudio e imagem do YouTube, TikTok, Instagram e Pinterest.',
    steps: [
      {
        title: 'Instale extensão + motor (uma vez só)',
        text: 'O primeiro card instala a extensão do Chrome e o motor local. Siga as "Instruções detalhadas" — o Windows pode pedir confirmação pra rodar o instalador. Quando os dois indicadores ficam verdes, nunca mais repete isso.',
        visual: (
          <Shot label="Downloader · setup">
            <Mark n={1} x="30%" y="48%" />
            <MRow>
              <MChip tone="lime">EXTENSÃO ✓</MChip>
              <MChip tone="lime">MOTOR ✓</MChip>
              <MBtn tone="ghost">Instruções detalhadas</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Cole os links',
        text: 'Um link por linha. Pode misturar plataformas — YouTube, Instagram, TikTok e Pinterest na mesma fila.',
        visual: (
          <Shot label="Downloader · links">
            <Mark n={1} x="88%" y="42%" />
            <MStack>
              <MField value="https://youtube.com/watch?v=..." />
              <MField value="https://www.instagram.com/reel/..." />
              <MField value="https://pin.it/..." />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha o formato',
        text: 'Vídeo, só áudio ou imagem — a fila inteira sai no formato escolhido.',
      },
      {
        title: 'Baixe',
        text: 'Os arquivos caem direto na sua pasta de Downloads, com o progresso de cada link visível na fila.',
      },
    ],
    tips: [
      'Conteúdo sensível tem um modo próprio: ligue o toggle +18 antes de colar o link.',
      'Se o status travar em "conectando", abra o motor de novo (ícone na bandeja do Windows) e tente outra vez.',
    ],
  },

  '/tools/compressor': {
    title: 'Compressor',
    tagline: 'Reduz o peso do vídeo sem perda visível de qualidade.',
    steps: [
      {
        title: 'Solte os vídeos',
        text: 'Até 5 comprimem em paralelo. Os demais aguardam na fila.',
        visual: (
          <Shot label="Compressor · fila">
            <Mark n={1} x="50%" y="40%" />
            <MDrop label="Solta os vídeos" sub="até 5 em paralelo" />
          </Shot>
        ),
      },
      {
        title: 'Ajuste a qualidade',
        text: 'O controle mostra uma estimativa do tamanho final antes de você processar — dá pra calibrar sem tentativa e erro.',
        visual: (
          <Shot label="Compressor · qualidade">
            <Mark n={1} x="86%" y="40%" />
            <MSlider label="Qualidade" pct={70} val="~24 MB" />
          </Shot>
        ),
      },
      {
        title: 'Escolha a resolução',
        text: 'Mantenha a original ou reduza (1080p, 720p) pra ganhar ainda mais espaço.',
      },
      {
        title: 'Comprima e confira',
        text: 'Clique em "Comprimir". Cada card compara o previsto com o real e mostra a redução final.',
        visual: (
          <Shot label="Compressor · resultado">
            <MQueueItem name="criativo-final.mp4" status="pronto · 62% menor" pct={100} tone="lime" />
          </Shot>
        ),
      },
    ],
    tips: ['Tudo roda no seu navegador — os vídeos não sobem pra nenhum servidor.'],
  },

  '/tools/audio-split': {
    title: 'Dividir áudios',
    tagline: 'Quebra um áudio longo em partes, cortando apenas nas pausas.',
    steps: [
      {
        title: 'Envie o arquivo',
        text: 'Aceita áudio ou vídeo — de vídeo, aproveitamos só a trilha de áudio.',
        visual: (
          <Shot label="Dividir áudios">
            <Mark n={1} x="50%" y="40%" />
            <MDrop label="Áudio ou vídeo" />
          </Shot>
        ),
      },
      {
        title: 'Entenda o corte',
        text: 'A divisão acontece nas pausas mais longas da fala. Nenhuma frase é cortada no meio — por isso as partes podem ter durações diferentes.',
      },
      {
        title: 'Processe e baixe',
        text: 'Clique em "Processar". Cada parte aparece com player próprio — baixe uma a uma ou o ZIP com todas.',
        visual: (
          <Shot label="Resultado">
            <MStack>
              <MQueueItem name="parte-01.mp3 · 0:19" status="pronta" pct={100} tone="lime" />
              <MQueueItem name="parte-02.mp3 · 0:22" status="pronta" pct={100} tone="lime" />
              <MRow>
                <MBtn tone="lime">Baixar ZIP</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
    ],
  },

  '/tools/acelerador': {
    title: 'Mixer de Velocidade',
    tagline: 'Acelera ou desacelera vídeo e áudio sem distorcer a voz.',
    steps: [
      {
        title: 'Solte os arquivos',
        text: 'Até 20 vídeos ou áudios na mesma fila.',
      },
      {
        title: 'Defina a velocidade',
        text: 'Arraste o controle (0.5× a 3×) ou toque num dos atalhos prontos — 0.75, 1.25, 1.5, 2.0. O tom da voz é corrigido automaticamente: nada de efeito robô.',
        visual: (
          <Shot label="Mixer · velocidade">
            <Mark n={1} x="86%" y="34%" />
            <Mark n={2} x="30%" y="76%" />
            <MStack>
              <MSlider label="Velocidade" pct={50} val="1.5×" />
              <MRow>
                <MChip tone="dim">0.75×</MChip>
                <MChip tone="violet">1.25×</MChip>
                <MChip tone="dim">1.5×</MChip>
                <MChip tone="dim">2.0×</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha o formato de saída',
        text: 'MP4 pra vídeo, MP3 ou WAV pra áudio. Se a fila só tiver áudio, a opção MP4 some sozinha.',
      },
      {
        title: 'Processe e baixe',
        text: 'O botão principal muda conforme o ajuste — "Acelerar" ou "Desacelerar". Baixe cada arquivo pronto ou tudo de uma vez com "Baixar ZIP".',
      },
    ],
  },

  '/tools/fakepass': {
    title: 'FakePrint',
    tagline: 'Prints e stickers de redes sociais fiéis ao original, prontos pra criativo.',
    steps: [
      {
        title: 'Escolha o modelo',
        text: 'Navegue pelas seções — Redes sociais e Notícias & TV — e toque no modelo que quer recriar (story, DM, post, tweet, comentário, notificação, telejornal).',
        visual: (
          <Shot label="FakePrint · modelos">
            <Mark n={1} x="22%" y="46%" />
            <MRow>
              <MChip tone="violet">STORY</MChip>
              <MChip tone="dim">DM</MChip>
              <MChip tone="dim">POST</MChip>
              <MChip tone="dim">TWEET</MChip>
              <MChip tone="dim">TELEJORNAL</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Preencha os campos',
        text: 'Nomes, textos, fotos, horários — cada modelo mostra só o que ele usa. A prévia ao lado atualiza em tempo real.',
      },
      {
        title: 'Ajuste a barra de status',
        text: 'iPhone ou Android, hora, operadora, Wi-Fi e bateria — os detalhes que fazem o print parecer real.',
        visual: (
          <Shot label="FakePrint · barra de status">
            <Mark n={1} x="14%" y="46%" />
            <MRow>
              <MChip tone="violet">IPHONE</MChip>
              <MField label="Hora" value="21:47" />
              <MField label="Bateria" value="63%" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Baixe o PNG',
        text: 'Confira a prévia e clique em "Baixar PNG" — o export sai em alta resolução, nítido pra usar em qualquer criativo.',
        visual: (
          <Shot label="FakePrint · export">
            <Mark n={1} x="26%" y="50%" />
            <MRow>
              <MBtn tone="lime">Baixar PNG</MBtn>
              <MChip tone="dim">1080px · nítido</MChip>
            </MRow>
          </Shot>
        ),
      },
    ],
  },

  '/tools/caixinha-pergunta': {
    title: 'Caixinha de Pergunta',
    tagline: 'Recria o sticker de perguntas do Instagram em PNG, fiel ao nativo.',
    steps: [
      {
        title: 'Escreva os textos',
        text: 'A pergunta do topo e a resposta/mensagem do corpo. O tamanho da fonte se ajusta sozinho pra caber como no Instagram.',
        visual: (
          <Shot label="Caixinha · textos">
            <Mark n={1} x="88%" y="30%" />
            <MStack>
              <MField label="Pergunta" value="me pergunta qualquer coisa 👀" />
              <MField label="Mensagem" value="pode mandar, respondo tudo" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha o fundo',
        text: 'Use a paleta pronta ou o seletor de cor pra combinar com o seu story.',
      },
      {
        title: 'Escolha o formato',
        text: 'Story 9:16, Quadrado ou Feed 4:5 — a prévia ao lado mostra exatamente como vai sair.',
      },
      {
        title: 'Baixe o PNG',
        text: 'Clique em "Baixar PNG": sai em 1080px, idêntico ao sticker nativo, pronto pra sobrepor no criativo.',
      },
    ],
  },

  '/tools/calculadora': {
    title: 'Calculadora',
    tagline: 'Monta o orçamento de edição por duração de AD e gera o PDF pro cliente.',
    steps: [
      {
        title: 'Defina sua tabela de preço',
        text: 'Informe quanto você cobra por minuto de edição.',
      },
      {
        title: 'Adicione os ADs',
        text: 'Uma linha por AD, com a duração em mm:ss. Use + e − pra incluir ou remover linhas.',
        visual: (
          <Shot label="Calculadora · ADs">
            <Mark n={1} x="88%" y="38%" />
            <MStack>
              <MRow>
                <MField label="AD 01" value="01:30" />
                <MField label="AD 02" value="00:45" />
                <MField label="AD 03" value="02:10" />
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Aplique desconto e PIX',
        text: 'Desconto opcional em % e, se quiser, a chave PIX — ela fica salva pros próximos orçamentos.',
      },
      {
        title: 'Gere o relatório',
        text: 'Revise subtotal, desconto e total, preencha o nome do cliente e gere o PDF pronto pra enviar.',
        visual: (
          <Shot label="Calculadora · orçamento">
            <MRow>
              <MChip tone="lime">TOTAL · R$ 870,00</MChip>
              <MBtn tone="primary">Gerar relatório</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
  },

  /* ── Com a IA ─────────────────────────────────────────────────────── */

  '/tools/copy-srt': {
    title: 'Gerador de SRT',
    tagline: 'Alinha a sua copy ao áudio palavra por palavra e devolve o .srt pronto.',
    steps: [
      {
        title: 'Envie o áudio ou vídeo',
        text: 'Até 800MB ou 60 minutos. A página mostra duração e tamanho assim que o upload termina.',
        visual: (
          <Shot label="Gerador de SRT · arquivo">
            <Mark n={1} x="50%" y="40%" />
            <MDrop label="Áudio ou vídeo" sub="até 800MB · 60min" />
          </Shot>
        ),
      },
      {
        title: 'Cole a copy',
        text: 'O texto exatamente como foi narrado. Quanto mais fiel a copy, mais preciso o alinhamento.',
      },
      {
        title: 'Gere o SRT',
        text: 'Clique em "Gerar SRT". O alinhamento é palavra por palavra — cada bloco de legenda nasce no tempo certo da fala.',
        visual: (
          <Shot label="Gerador de SRT · resultado">
            <Mark n={1} x="24%" y="50%" />
            <MRow>
              <MBtn tone="primary">Gerar SRT</MBtn>
              <MChip tone="lime">ALINHADO · PALAVRA A PALAVRA</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Importe no CapCut do jeito certo',
        text: 'Baixe o .SRT e siga o guia "Importar no CapCut" no final da página — importando como legenda, os modelos e animações do CapCut funcionam em cima dela.',
      },
    ],
  },

  '/tools/decupagem-copy': {
    title: 'Decupagem Inteligente',
    tagline: 'A IA lê a sua copy, escolhe o melhor take de cada frase e audita o resultado.',
    steps: [
      {
        title: 'Envie o vídeo bruto',
        text: 'A gravação inteira, com erros e repetições — até 800MB ou 40 minutos.',
      },
      {
        title: 'Cole a copy frase por frase',
        text: 'Cada linha vira uma frase que a IA vai procurar no vídeo. Se o locutor gravou a mesma frase 3 vezes, ela escolhe a melhor tomada.',
        visual: (
          <Shot label="Decupagem Inteligente · copy">
            <Mark n={1} x="88%" y="34%" />
            <MStack>
              <MField value="Você já tentou de tudo pra dormir melhor?" />
              <MField value="Então presta atenção nos próximos 30 segundos." />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha se corta os silêncios',
        text: 'Com o corte ligado, as pausas mortas entre as frases também somem.',
      },
      {
        title: 'Decupe e confira o laudo',
        text: 'Clique em "Decupar pela copy". No final, a auditoria re-transcreve o resultado e compara com a copy: você vê a confiança por frase antes de usar o corte.',
        visual: (
          <Shot label="Decupagem Inteligente · laudo">
            <MStack>
              <MQueueItem name="Frase 1 · take limpo" status="98% de confiança" pct={98} tone="lime" />
              <MQueueItem name="Frase 2 · take costurado" status="91% de confiança" pct={91} tone="lime" />
            </MStack>
          </Shot>
        ),
      },
    ],
  },

  '/tools/lipsync': {
    title: 'Lipsync Video to Video',
    tagline: 'Sincroniza a boca de um vídeo com qualquer áudio novo.',
    steps: [
      {
        title: 'Envie o vídeo do rosto',
        text: 'Um take com o rosto visível e estável funciona melhor — evite cortes bruscos e mãos na frente da boca.',
        visual: (
          <Shot label="Lipsync · entrada">
            <Mark n={1} x="28%" y="46%" />
            <Mark n={2} x="78%" y="46%" />
            <MRow>
              <div className="flex-1">
                <MDrop label="Vídeo" sub="rosto visível" />
              </div>
              <div className="flex-1">
                <MDrop label="Áudio" sub="a nova fala" />
              </div>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Envie o áudio novo',
        text: 'É essa fala que o rosto vai passar a dizer. Áudios longos são divididos automaticamente em blocos pra renderizar com estabilidade.',
      },
      {
        title: 'Dispare e acompanhe',
        text: 'O job entra na fila e o card mostra cada fase — enviando, renderizando, baixando. Você pode continuar usando o app enquanto isso.',
        visual: (
          <Shot label="Lipsync · fila">
            <MQueueItem name="depoimento-v2.mp4" status="renderizando" pct={58} />
          </Shot>
        ),
      },
      {
        title: 'Baixe o resultado',
        text: 'Quando ficar pronto, o download libera no próprio card. Seus jobs anteriores ficam no Histórico.',
      },
    ],
  },

  '/tools/ltx-video': {
    title: 'Vídeo do zero',
    tagline: 'Gera vídeo com áudio a partir de um prompt de texto ou de uma imagem.',
    steps: [
      {
        title: 'Descreva a cena',
        text: 'Escreva o prompt do que acontece no vídeo. Prompts em inglês tendem a render melhor.',
        visual: (
          <Shot label="Vídeo do zero · prompt">
            <Mark n={1} x="88%" y="40%" />
            <MField value="cinematic shot of rain falling on a neon city street..." />
          </Shot>
        ),
      },
      {
        title: 'Escolha resolução e duração',
        text: '6 segundos direto, ou 12 segundos gerados em dois blocos emendados.',
      },
      {
        title: 'Opcional: comece de uma imagem',
        text: 'Envie uma imagem pra ser o primeiro frame — o vídeo nasce dela.',
      },
      {
        title: 'Gere e acompanhe',
        text: 'A fila mostra o status da GPU. Cada resultado cai na galeria abaixo, pronto pra baixar.',
      },
    ],
    tips: ['A cota de GPU é compartilhada — se a fila estiver cheia, o job espera a vez sem travar.'],
  },

  '/tools/separador-audio': {
    title: 'Separador de Áudio',
    tagline: 'Separa voz, trilha sonora e efeitos em três faixas independentes.',
    steps: [
      {
        title: 'Envie o arquivo',
        text: 'Áudio ou vídeo — o upload vai direto pro processamento, sem limite apertado de tamanho.',
      },
      {
        title: 'Separe',
        text: 'Clique em "Separar voz, trilha sonora e SFX" e aguarde — a separação roda em nuvem.',
        visual: (
          <Shot label="Separador · ação">
            <Mark n={1} x="34%" y="50%" />
            <MBtn tone="primary">Separar voz, trilha sonora e SFX</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Baixe as faixas',
        text: 'Cada faixa sai num card com player próprio — baixe só a que precisa ou todas de uma vez.',
        visual: (
          <Shot label="Separador · faixas">
            <MStack>
              <MQueueItem name="voz.wav" status="pronta" pct={100} tone="lime" />
              <MQueueItem name="trilha.wav" status="pronta" pct={100} tone="lime" />
              <MQueueItem name="sfx.wav" status="pronta" pct={100} tone="lime" />
            </MStack>
          </Shot>
        ),
      },
    ],
  },

  '/tools/voice-test': {
    title: 'Isolar voz',
    tagline: 'Remove a música e deixa só a voz — ideal pra preparar áudio de referência.',
    steps: [
      {
        title: 'Envie o áudio',
        text: 'O arquivo com voz + música misturadas.',
      },
      {
        title: 'Escolha o modo de isolação',
        text: 'O modo AUTO resolve a maioria dos casos. Os demais (center, bandpass, aggressive) são variações pra áudios difíceis.',
        visual: (
          <Shot label="Isolar voz · modo">
            <Mark n={1} x="14%" y="46%" />
            <MRow>
              <MChip tone="violet">AUTO</MChip>
              <MChip tone="dim">CENTER</MChip>
              <MChip tone="dim">BANDPASS</MChip>
              <MChip tone="dim">AGGRESSIVE</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Isole e compare',
        text: 'Clique em "Isolar voz" e use os players antes/depois pra avaliar. Ficou bom? Baixe o vocals.wav.',
      },
    ],
  },

  '/tools/normalizador': {
    title: 'Normalizador',
    tagline: 'Iguala o volume de vários arquivos e limpa o chiado de fundo.',
    steps: [
      {
        title: 'Solte os arquivos',
        text: 'Até 10 por fila — útil quando dois locutores gravaram em volumes diferentes.',
      },
      {
        title: 'Escolha o formato de saída',
        text: 'MP4, MP3 ou WAV.',
      },
      {
        title: 'Normalize',
        text: 'Clique em "Normalizar": todas as vozes saem no mesmo patamar, sem estouro e sem chiado. Baixe individualmente ou o ZIP.',
        visual: (
          <Shot label="Normalizador · fila">
            <MStack>
              <MQueueItem name="locutor-a.mp3" status="pronto" pct={100} tone="lime" />
              <MQueueItem name="locutor-b.mp3" status="normalizando" pct={44} />
            </MStack>
          </Shot>
        ),
      },
    ],
  },

  '/tools/points': {
    title: 'Seus pontos',
    tagline: 'Transforma as entregas concluídas no ClickUp em pontos e medalhas.',
    steps: [
      {
        title: 'Conecte o ClickUp',
        text: 'Use o mesmo token do ClickUp Pilot — se já conectou lá, aqui entra sozinho.',
      },
      {
        title: 'Escolha o escopo',
        text: 'Aponte pra pasta de tasks do seu time. Só as entregas dessa pasta contam pontos.',
      },
      {
        title: 'Acompanhe pontos e medalhas',
        text: 'Cada task concluída soma pontos pelo peso da entrega. As medalhas (Rookie, Elite, Champion, Legend) destravam por meta.',
        visual: (
          <Shot label="Pontos · medalhas">
            <MRow>
              <MChip tone="lime">ELITE ✓</MChip>
              <MChip tone="violet">CHAMPION · 78%</MChip>
              <MChip tone="dim">LEGEND</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Ajuste o que conta',
        text: 'Nas opções, defina quais status fecham uma entrega (closed, done) — subtasks também contam.',
      },
    ],
  },

  '/tools/lipsync-history': {
    title: 'Histórico de avatares',
    tagline: 'Todos os seus disparos de avatar, com os ZIPs salvos no navegador.',
    steps: [
      {
        title: 'Encontre o disparo',
        text: 'Cada lote aparece com data, nome e status. Os arquivos ficam guardados no próprio navegador.',
      },
      {
        title: 'Baixe de novo quando precisar',
        text: 'Os ZIPs de takes, montado e camuflado continuam disponíveis mesmo depois de fechar a página.',
        visual: (
          <Shot label="Histórico · lote">
            <Mark n={1} x="80%" y="52%" />
            <MStack>
              <MQueueItem name="AD22 · 6 partes" status="concluído" pct={100} tone="lime" />
              <MRow>
                <MBtn tone="ghost">Baixar ZIP</MBtn>
                <MBtn tone="dark">Retomar</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Retome o que ficou pela metade',
        text: '"Retomar" continua um lote interrompido de onde parou, sem regenerar o que já ficou pronto.',
      },
    ],
    tips: [
      'O espaço é gerenciado sozinho: lotes muito antigos são limpos pra não pesar o navegador — baixe e guarde o que for definitivo.',
    ],
  },

  '/tools/background': {
    title: 'Tarefas em segundo plano',
    tagline: 'Acompanha tudo que o Pilot e o Auto B-roll estão processando agora.',
    steps: [
      {
        title: 'Veja o panorama',
        text: 'Os contadores mostram o que está em processo, na fila, concluído e com falha — atualizando ao vivo.',
        visual: (
          <Shot label="Segundo plano · panorama">
            <MRow>
              <MChip tone="violet">EM PROCESSO · 2</MChip>
              <MChip tone="dim">NA FILA · 4</MChip>
              <MChip tone="lime">CONCLUÍDOS · 12</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Filtre por tipo',
        text: 'Tudo, Lipsync (HeyGen) ou B-rolls (Magnific) — cada aba mostra só aquela fila.',
      },
      {
        title: 'Baixe ou intervenha',
        text: 'Cada task tem barra de progresso e partes. Nos concluídos, baixe os ZIPs (takes, montado, camuflado); nos demais, dá pra cancelar ou remover.',
        visual: (
          <Shot label="Segundo plano · task">
            <MStack>
              <MQueueItem name="AD31 · lipsync" status="renderizando 3/6" pct={52} />
              <MRow>
                <MBtn tone="ghost">Baixar ZIP</MBtn>
                <MBtn tone="dark">Cancelar</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'Esta tela só observa — o processamento roda na aba da ferramenta de origem. Mantenha aquela aba aberta.',
    ],
  },

  /* ── Automação (guias grandes) ────────────────────────────────────── */

  '/tools/heygen-auto': {
    title: 'Hey Auto',
    tagline:
      'Monta uma fila de avatares e dispara tudo no HeyGen de uma vez — sem abrir o HeyGen.',
    size: 'large',
    steps: [
      {
        title: 'Prepare o ambiente (uma vez só)',
        text: 'Instale a extensão DARKO LAB no Chrome — o bloco "Como instalar (passo a passo)" na página mostra cada clique. Depois, deixe uma aba logada no HeyGen. O disparo usa a sua assinatura normal do HeyGen, não a API.',
        visual: (
          <Shot label="Hey Auto · setup">
            <Mark n={1} x="26%" y="48%" />
            <MRow>
              <MChip tone="lime">EXTENSÃO CONECTADA ✓</MChip>
              <MChip tone="dim">HEYGEN LOGADO</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Nomeie o AD',
        text: 'O nome organiza a fila e vira o nome dos ZIPs no final.',
      },
      {
        title: 'Escolha avatar, voz e motor',
        text: 'O seletor busca na sua biblioteca do HeyGen com preview. A voz pode seguir o padrão do avatar ou ser trocada; o motor define o estilo de render.',
        visual: (
          <Shot label="Hey Auto · avatar e voz">
            <Mark n={1} x="16%" y="46%" />
            <Mark n={2} x="52%" y="46%" />
            <Mark n={3} x="84%" y="46%" />
            <MRow>
              <MField label="Avatar" value="Ana — Studio" grow />
              <MField label="Voz" value="padrão do avatar" grow />
              <MField label="Motor" value="V" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Escolha o modo: Copy ou Áudio',
        text: 'Copy: cole o texto e o avatar narra. Áudio: suba os arquivos e o avatar sincroniza a boca com eles.',
      },
      {
        title: 'Estruture hooks e body',
        text: 'Cada HOOK vira um take separado; o BODY é opcional e pode ter vários blocos — o app divide em partes de ~20 segundos automaticamente, do jeito que o HeyGen rende melhor.',
        visual: (
          <Shot label="Hey Auto · estrutura">
            <Mark n={1} x="88%" y="26%" />
            <Mark n={2} x="88%" y="66%" />
            <MStack>
              <MField label="Hook 1" value="Você já tentou de tudo pra..." />
              <MField label="Hook 2" value="O que ninguém te contou sobre..." />
              <MField label="Body" value="A verdade é que existe um jeito..." />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Adicione à fila',
        text: '"Adicionar à fila" captura o AD inteiro (avatar + estrutura) como um item. Repita pra quantos ADs quiser — dá pra reordenar, editar cada parte e remover antes de disparar.',
      },
      {
        title: 'Processe a fila',
        text: 'Clique em "▶ Processar fila". Cada item dispara no HeyGen, renderiza, baixa e — se você marcou — passa por decupagem e camuflagem sozinho.',
        visual: (
          <Shot label="Hey Auto · fila rodando">
            <Mark n={1} x="30%" y="24%" />
            <MStack>
              <MBtn tone="primary">▶ Processar fila (3)</MBtn>
              <MQueueItem name="AD07 · 4 partes" status="renderizando 2/4" pct={45} />
              <MQueueItem name="AD08 · 3 partes" status="na fila" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe os 3 ZIPs',
        text: 'Cada AD entrega três pacotes: os takes na ordem (parte1, parte2...), o montado (hook + body já emendado e decupado) e o camuflado.',
        visual: (
          <Shot label="Hey Auto · entrega">
            <MRow>
              <MBtn tone="lime">ZIP · Takes</MBtn>
              <MBtn tone="lime">ZIP · Montado</MBtn>
              <MBtn tone="lime">ZIP · Camuflado</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Avatar não existe ainda? O Avatar First cria um novo a partir de foto + áudio, direto na fila.',
      'Tem um Google Docs com as copys? O botão de importar doc pré-preenche hooks e bodies sozinho.',
      'Fila "travada" quase sempre é o limite diário do HeyGen — use Retomar mais tarde que ela continua de onde parou.',
      'F5 não perde nada: o progresso fica salvo no navegador.',
    ],
  },

  '/tools/clickup-pilot': {
    title: 'ClickUp Pilot',
    tagline:
      'Lê os briefings das suas tasks no ClickUp e dispara os avatares de cada uma, em fila, sozinho.',
    size: 'large',
    steps: [
      {
        title: 'Conecte o ClickUp',
        text: 'Cole seu token pessoal do ClickUp — ele fica salvo só no seu navegador. Depois escolha o Time e o Editor que você quer operar.',
        visual: (
          <Shot label="Pilot · conexão">
            <Mark n={1} x="88%" y="30%" />
            <Mark n={2} x="30%" y="72%" />
            <MStack>
              <MField label="Token ClickUp" value="pk_••••••••••••" />
              <MRow>
                <MField label="Time" value="Estúdio" grow />
                <MField label="Editor" value="João" grow />
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Busque as tasks do dia',
        text: 'O Pilot lista as tasks da data escolhida. Marque as que entram no disparo — uma, algumas ou todas.',
        visual: (
          <Shot label="Pilot · seleção">
            <Mark n={1} x="10%" y="34%" />
            <MStack>
              <MQueueItem name="☑ AD15VN_PRPB06" status="selecionada" pct={100} tone="violet" />
              <MQueueItem name="☑ AD16VN_PRPB07" status="selecionada" pct={100} tone="violet" />
              <MQueueItem name="☐ AD17VN_PRPB08" status="—" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Puxe o briefing de cada task',
        text: '"⬇ Buscar automático" lê o Google Docs linkado na descrição da task. Se o doc for privado, abra-o e cole o conteúdo manualmente (Ctrl+A, Ctrl+C, Ctrl+V) — funciona igual.',
      },
      {
        title: 'Analise',
        text: 'O Pilot interpreta o briefing: identifica o avatar, a voz, separa hook e body e divide a copy em partes. Task com status "pronto" pode disparar; "parcial" pede um ajuste — geralmente escolher o avatar à mão.',
        visual: (
          <Shot label="Pilot · análise">
            <Mark n={1} x="82%" y="30%" />
            <MStack>
              <MRow>
                <MField label="Avatar" value="identificado ✓" grow />
                <MField label="Voz" value="memorizada ✓" grow />
                <MChip tone="lime">PRONTO</MChip>
              </MRow>
              <MRow>
                <MField label="Copy" value="1 hook + 3 partes de body" grow />
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Refine o que quiser',
        text: 'Troque avatar ou voz pelo seletor, escolha o motor (por lote, por percentual ou task a task) e ligue decupagem/camuflagem individualmente.',
        visual: (
          <Shot label="Pilot · opções por task">
            <MRow>
              <MToggle on label="Decupagem" />
              <MToggle on label="Camuflagem" />
              <MToggle on={false} label="B-rolls (Magnific)" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Inicie em background',
        text: 'Clique em "▶ Iniciar N tasks em background". O Pilot dispara parte por parte no HeyGen, renderiza, baixa e monta — respeitando a fila e se auto-recuperando de partes travadas.',
        visual: (
          <Shot label="Pilot · disparo">
            <Mark n={1} x="34%" y="26%" />
            <MStack>
              <MBtn tone="primary">▶ Iniciar 2 tasks em background</MBtn>
              <MQueueItem name="AD15VN · parte 2/4" status="renderizando" pct={38} />
              <MQueueItem name="AD16VN" status="na fila" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Acompanhe de onde preferir',
        text: 'Pelos cards da própria página ou pela tela "Tarefas em segundo plano". Pausar, Retomar e Cancelar funcionam por task, a qualquer momento.',
      },
      {
        title: 'Receba os 3 ZIPs por task',
        text: 'Takes na ordem, montado (decupado) e camuflado — prontos pra edição final. Tudo nomeado pelo nome da task.',
        visual: (
          <Shot label="Pilot · entrega">
            <MRow>
              <MBtn tone="lime">ZIP · Takes</MBtn>
              <MBtn tone="lime">ZIP · Montado</MBtn>
              <MBtn tone="lime">ZIP · Camuflado</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Pré-requisitos: extensão DARKO LAB instalada e uma aba logada no HeyGen.',
      'O briefing precisa seguir o formato do manual — é ele que permite ao Pilot identificar avatar e copy sem erro.',
      'F5 no meio do disparo não perde nada: o plano fica salvo e a task retoma sozinha.',
      '"Travou" no meio do dia? Normalmente é o limite diário do HeyGen — Retomar continua depois, sem regenerar o que já ficou pronto.',
      'Avatar de outro workspace do HeyGen aparece como "not accessible" — troque o workspace na aba do HeyGen e retome.',
    ],
  },

  '/tools/auto-broll': {
    title: 'Auto B-roll',
    tagline:
      'Transforma uma lista de prompts em dezenas de b-rolls prontos, rodando na sua conta Magnific.',
    size: 'large',
    steps: [
      {
        title: 'Instale a extensão Magnific (uma vez só)',
        text: 'Clique em "⬇ Baixar Extensão" e siga o passo a passo. O indicador do primeiro card precisa ficar verde. Se aparecer "reinstalar", baixe a versão nova — leva menos de um minuto.',
        visual: (
          <Shot label="Auto B-roll · extensão">
            <Mark n={1} x="24%" y="48%" />
            <MRow>
              <MBtn tone="primary">⬇ Baixar Extensão</MBtn>
              <MChip tone="lime">PRONTO ✓</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Conecte sua conta Freepik Premium+',
        text: 'Faça login no magnific.com com a conta que tem Premium+ ativa — é o único pré-requisito. Cada take roda no modo Unlimited da sua conta, sem gastar crédito por vídeo. Trocou de conta? Use "Trocar conta" pra re-sincronizar.',
      },
      {
        title: 'Confira a configuração',
        text: 'O perfil de qualidade já vem travado no ponto certo (frame em Nano Banana 1K + vídeo em Kling 720p, 10s, 9:16). Não precisa configurar nada no Magnific.',
        visual: (
          <Shot label="Auto B-roll · configuração">
            <MRow>
              <MChip tone="violet">NANO BANANA 1K</MChip>
              <MChip tone="violet">KLING 720P</MChip>
              <MChip tone="dim">10S · 9:16</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Crie um job com a lista de prompts',
        text: 'Cole a lista (texto ou JSON) — o app conta na hora quantos takes vai gerar. Dá pra colar direto da área de transferência ou puxar o JSON pronto.',
        visual: (
          <Shot label="Auto B-roll · job">
            <Mark n={1} x="88%" y="36%" />
            <MStack>
              <MField value='[{"take": 1, "imagePrompt": "...", "videoPrompt": "..."}]' />
              <MRow>
                <MChip tone="lime">12 TAKES DETECTADOS</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Aperte o play',
        text: 'Cada take gera primeiro o frame (imagem) e depois o movimento (vídeo). O card mostra a porcentagem ao vivo e marca qual take está gerando agora.',
        visual: (
          <Shot label="Auto B-roll · gerando">
            <MStack>
              <MQueueItem name="TAKE 01" status="pronto" pct={100} tone="lime" />
              <MQueueItem name="TAKE 02" status="vídeo · 68%" pct={68} />
              <MQueueItem name="TAKE 03" status="frame · 30%" pct={30} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe sem esperar o lote',
        text: 'Assim que um take fica pronto, o MP4 individual já pode ser baixado — expanda pra tela cheia pra conferir antes.',
      },
      {
        title: 'Pegue o ZIP organizado',
        text: 'Quando o último take termina, sai um ZIP nomeado com todos os MP4s na ordem — direto pra timeline, sem renomear nada. O histórico guarda os lotes anteriores pra re-baixar.',
        visual: (
          <Shot label="Auto B-roll · entrega">
            <Mark n={1} x="22%" y="50%" />
            <MRow>
              <MBtn tone="lime">Baixar ZIP (12)</MBtn>
              <MChip tone="dim">HISTÓRICO · 4 LOTES</MChip>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Os takes ficam salvos offline no navegador — F5 não apaga um lote no meio.',
      '"Retomar" continua um lote interrompido sem regenerar o que já ficou pronto.',
      'A fila é serial de propósito: um take por vez rende mais estável no Magnific.',
    ],
  },
};

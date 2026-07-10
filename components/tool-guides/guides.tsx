import type { ReactNode } from 'react';

import {
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
 * - cada passo ensina de verdade: o que fazer, o que a tela responde e o que
 *   conferir antes de seguir — quem lê termina sabendo usar;
 * - nomes de botões/campos IDÊNTICOS aos da UI real;
 * - nunca prometer o que a ferramenta não faz;
 * - sem marcadores sobre os prints (pedido do dono, 10.07.26).
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
        title: 'Solte os arquivos na área de upload',
        text: 'Arraste até 10 vídeos ou áudios de uma vez — ou clique na área pra abrir o seletor. Pode misturar formatos (MP4 com MP3, por exemplo): cada arquivo vira um card na fila e é processado um por vez, na ordem em que entrou. Se soltar mais de 10, os excedentes ficam de fora e você adiciona depois.',
        visual: (
          <Shot label="Decupagem · fila">
            <MStack>
              <MDrop label="Solta os arquivos aqui" sub="até 10 por vez · vídeo ou áudio" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha o que quer receber de volta',
        text: 'Com vídeo na fila, aparece a pergunta "Como receber os vídeos?": escolha o vídeo cortado ou apenas o áudio (útil quando você só precisa da voz limpa pra outra etapa). Em seguida escolha o formato do arquivo final — MP4 pra vídeo, MP3 ou WAV pra áudio. A escolha vale pra fila inteira.',
      },
      {
        title: 'Calibre quanto de silêncio manter',
        text: 'O controle "Quanto de silêncio manter?" decide o ritmo do corte. Puxando pra esquerda, as pausas somem quase por completo e o vídeo fica acelerado, estilo corte seco de anúncio. Puxando pra direita, a fala respira mais natural. Na dúvida, deixe onde está: o padrão preserva uma pausa curta e confortável entre as frases.',
        visual: (
          <Shot label="Decupagem · ajuste">
            <MSlider label="Quanto de silêncio manter?" pct={35} val="curto" />
          </Shot>
        ),
      },
      {
        title: 'Processe e confira o resultado',
        text: 'Clique no botão de processar e acompanhe: cada card mostra a fase (analisando → cortando → pronto) com barra de progresso. Ao terminar, o card exibe quanto o arquivo encolheu ("31% menor", por exemplo) e libera o botão de download. Dá pra baixar cada arquivo na hora, sem esperar o resto da fila terminar.',
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
      'O volume da voz é nivelado automaticamente antes do corte — dois locutores em volumes diferentes saem no mesmo patamar.',
      'O corte protege o ataque das palavras: nenhuma sílaba é comida no início ou no fim das frases.',
      'Tudo roda no seu navegador — os arquivos não sobem pra nenhum servidor.',
    ],
  },

  '/tools/camuflagem': {
    title: 'Camuflagem',
    tagline:
      'Entrega um áudio pra quem assiste e outro pra transcrição automática das plataformas.',
    steps: [
      {
        title: 'Entenda o que a ferramenta faz',
        text: 'A Camuflagem trabalha com dois áudios ao mesmo tempo: o ORIGINAL (o que o público realmente ouve no vídeo) e o ESCONDIDO (o que a transcrição automática da plataforma vai ler no lugar). O resultado é um arquivo só, que soa normal pra pessoas e "lê" diferente pra máquinas.',
      },
      {
        title: 'Defina a intensidade',
        text: 'Comece no valor sugerido pelo controle. Intensidade maior engana melhor a transcrição, mas pode deixar rastros audíveis em fones de ouvido; intensidade menor é imperceptível, mas pode não segurar a transcrição em todos os trechos. O passo 5 existe exatamente pra você validar isso antes de publicar.',
        visual: (
          <Shot label="Camuflagem · intensidade">
            <MSlider label="Intensidade" pct={55} val="média" />
          </Shot>
        ),
      },
      {
        title: 'Escolha o formato de saída',
        text: 'MP4 se você vai subir o arquivo direto na plataforma, ou apenas o áudio se você mesmo vai montar o vídeo no editor depois.',
      },
      {
        title: 'Envie os dois áudios',
        text: 'No card "Original + escondido", solte o ORIGINAL do lado esquerdo e o ESCONDIDO do lado direito. Regra prática: o original é a sua copy real; o escondido é o texto neutro que você quer que a plataforma "escute". Os dois precisam ter duração parecida — se o escondido for muito mais curto, a cauda do vídeo fica sem cobertura.',
        visual: (
          <Shot label="Camuflagem · arquivos">
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
        text: 'Depois de processar, clique em "Transcrever". A ferramenta escuta o resultado do mesmo jeito que uma IA de plataforma escutaria e compara com o esperado. Selo verde = a transcrição devolveu o áudio escondido, pode publicar. Selo vermelho = a camuflagem não segurou; suba um pouco a intensidade e rode de novo. Nunca publique sem o selo verde.',
        visual: (
          <Shot label="Camuflagem · validação">
            <MRow>
              <MBtn tone="primary">Transcrever</MBtn>
              <MChip tone="lime">SELO · CAMUFLADO ✓</MChip>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'O botão de MUDO no card dos áudios silencia só o preview — o arquivo final não muda.',
      'Precisa desfazer ou trocar o escondido? O modo Descamuflar recupera o áudio escondido de um arquivo já camuflado.',
      'A camuflagem mira a transcrição automática. Não existe garantia universal contra todo detector — por isso o selo existe: valide sempre.',
    ],
  },

  '/tools/downloader': {
    title: 'Downloader',
    tagline: 'Baixa vídeo, áudio e imagem do YouTube, TikTok, Instagram e Pinterest.',
    steps: [
      {
        title: 'Instale extensão + motor (uma vez só)',
        text: 'O Downloader usa duas peças que você instala uma única vez: a extensão do Chrome (que enxerga os links) e o motor local (um programinha que faz o download pesado no seu PC). O primeiro card da página guia a instalação — abra as "Instruções detalhadas" e siga na ordem. O Windows pode pedir confirmação pra rodar o instalador; pode aceitar. Quando os dois indicadores ficarem verdes, o setup está completo pra sempre.',
        visual: (
          <Shot label="Downloader · setup">
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
        text: 'Um link por linha, quantos quiser. Pode misturar plataformas na mesma fila — um Reel do Instagram, um vídeo do YouTube e um pin do Pinterest descem juntos. Links encurtados (pin.it, vm.tiktok) funcionam normalmente.',
        visual: (
          <Shot label="Downloader · links">
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
        text: 'Vídeo (arquivo completo), só áudio (extraído do vídeo) ou imagem. A escolha vale pra fila inteira — se precisar de formatos diferentes, rode em duas levas.',
      },
      {
        title: 'Baixe e acompanhe',
        text: 'Clique pra baixar e acompanhe o progresso de cada link na fila. Os arquivos caem direto na sua pasta de Downloads do Windows, com nome limpo. Link que falhar mostra o erro no próprio card — os outros continuam normalmente.',
      },
    ],
    tips: [
      'Conteúdo sensível tem um modo próprio: ligue o toggle +18 antes de colar o link.',
      'Status travado em "conectando"? O motor local caiu — abra ele de novo (ícone na bandeja do Windows, perto do relógio) e tente outra vez.',
    ],
  },

  '/tools/compressor': {
    title: 'Compressor',
    tagline: 'Reduz o peso do vídeo sem perda visível de qualidade.',
    steps: [
      {
        title: 'Solte os vídeos',
        text: 'Arraste os arquivos pra área de upload. Até 5 comprimem em paralelo; os demais aguardam a vez na fila automaticamente. Formatos comuns (MP4, MOV, WebM) entram sem conversão prévia.',
        visual: (
          <Shot label="Compressor · fila">
            <MDrop label="Solta os vídeos" sub="até 5 em paralelo" />
          </Shot>
        ),
      },
      {
        title: 'Ajuste a qualidade olhando a estimativa',
        text: 'O controle de qualidade mostra, em tempo real, uma estimativa do tamanho final antes de você processar. Isso elimina a tentativa e erro: quer caber em 25 MB pra mandar no WhatsApp? Vá descendo a qualidade até a estimativa bater. Pra redes sociais, dá pra comprimir bastante sem diferença visível — vídeo publicado aceita muito mais compressão que arquivo-mestre.',
        visual: (
          <Shot label="Compressor · qualidade">
            <MSlider label="Qualidade" pct={70} val="~24 MB" />
          </Shot>
        ),
      },
      {
        title: 'Escolha a resolução',
        text: 'Manter a original preserva o enquadramento exato; reduzir (1080p ou 720p) corta ainda mais o peso. Se o destino é feed/stories, 1080p é mais que suficiente.',
      },
      {
        title: 'Comprima e compare',
        text: 'Clique em "Comprimir". Cada card mostra o progresso e, no final, compara o previsto com o real — tamanho antigo, tamanho novo e a redução em %. Baixe um a um ou todos de uma vez.',
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
        text: 'Solte um áudio (MP3, WAV) ou um vídeo — de vídeo, a ferramenta aproveita só a trilha de áudio e descarta a imagem.',
        visual: (
          <Shot label="Dividir áudios">
            <MDrop label="Áudio ou vídeo" />
          </Shot>
        ),
      },
      {
        title: 'Entenda onde a ferramenta corta',
        text: 'A divisão acontece nas pausas mais longas da fala — nunca no meio de uma frase. Por isso as partes saem com durações diferentes entre si: o corte respeita o ritmo natural de quem fala, não um relógio. É o comportamento ideal pra dividir um áudio longo em blocos que outras ferramentas (como o Hey Auto) recebem parte por parte.',
      },
      {
        title: 'Processe, ouça e baixe',
        text: 'Clique em "Processar". Cada parte aparece numerada, com duração e player próprio — ouça o início e o fim de uma ou duas pra conferir que nenhuma frase foi partida. Baixe individualmente ou pegue o ZIP com todas de uma vez.',
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
        text: 'Até 20 vídeos ou áudios na mesma fila — todos vão sair na velocidade que você definir no próximo passo.',
      },
      {
        title: 'Defina a velocidade',
        text: 'Arraste o controle entre 0.5× (metade da velocidade) e 3× (o triplo), ou toque num dos atalhos prontos. O tom da voz é corrigido automaticamente pelo pitch: em 1.5× a fala fica mais rápida mas continua soando humana, sem o efeito "esquilo". Pra dar ritmo em anúncio sem chamar atenção, 1.15×–1.3× é a faixa que costuma passar despercebida.',
        visual: (
          <Shot label="Mixer · velocidade">
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
        text: 'MP4 pra vídeo, MP3 ou WAV pra áudio. Se a fila só tiver arquivos de áudio, a opção MP4 some sozinha — é o esperado.',
      },
      {
        title: 'Processe e baixe',
        text: 'O texto do botão principal acompanha o ajuste — "Acelerar 3" quando está acima de 1×, "Desacelerar" quando está abaixo. Cada arquivo pronto libera o próprio download, e o "Baixar ZIP" pega tudo de uma vez no final.',
      },
    ],
  },

  '/tools/fakepass': {
    title: 'FakePrint',
    tagline: 'Prints e stickers de redes sociais fiéis aos originais, prontos pra criativo.',
    steps: [
      {
        title: 'Escolha o modelo',
        text: 'Navegue pelas duas seções — Redes sociais (story, DM, WhatsApp, post, tweet, comentários, notificação) e Notícias & TV (telejornais por emissora) — e clique no modelo que quer recriar. Cada modelo reproduz a interface real da plataforma, pixel por pixel.',
        visual: (
          <Shot label="FakePrint · modelos">
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
        title: 'Preencha os campos do modelo',
        text: 'Cada modelo mostra só os campos que ele usa: nomes, textos das mensagens, foto de perfil, curtidas, horários. A prévia do lado direito atualiza a cada tecla — o que você vê é exatamente o que sai no PNG.',
      },
      {
        title: 'Ajuste a barra de status do celular',
        text: 'É o detalhe que separa um print convincente de um print óbvio: escolha iPhone ou Android, acerte a hora pra bater com a história do criativo, e ajuste operadora, Wi-Fi e bateria. Uma bateria em 63% às 21:47 conta uma história; 100% às 9:00 conta outra.',
        visual: (
          <Shot label="FakePrint · barra de status">
            <MRow>
              <MChip tone="violet">IPHONE</MChip>
              <MField label="Hora" value="21:47" />
              <MField label="Bateria" value="63%" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Exporte em alta',
        text: 'Confira a prévia uma última vez e clique em "Baixar PNG". O export sai em alta resolução (1080px de largura), nítido o bastante pra ser reampliado dentro de um vídeo sem serrilhar.',
        visual: (
          <Shot label="FakePrint · export">
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
        text: 'Preencha a pergunta do topo (o título do sticker) e a resposta/mensagem do corpo. O tamanho da fonte se ajusta sozinho pra caber, exatamente como o Instagram faz — texto longo encolhe, texto curto cresce.',
        visual: (
          <Shot label="Caixinha · textos">
            <MStack>
              <MField label="Pergunta" value="me pergunta qualquer coisa 👀" />
              <MField label="Mensagem" value="pode mandar, respondo tudo" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha a cor de fundo',
        text: 'Use a paleta pronta ou o seletor de cor pra casar com a arte do seu story. O sticker em si mantém o branco nativo do Instagram — só o palco ao redor muda.',
      },
      {
        title: 'Escolha o formato do palco',
        text: 'Story 9:16 (o mais comum), Quadrado ou Feed 4:5. A prévia ao lado mostra exatamente a proporção final.',
      },
      {
        title: 'Baixe o PNG',
        text: 'Clique em "Baixar PNG": sai em 1080px, idêntico ao sticker nativo — fonte, raio de borda e sombras batem com o original. É sobrepor no criativo e pronto.',
      },
    ],
  },

  '/tools/calculadora': {
    title: 'Calculadora',
    tagline: 'Monta o orçamento de edição por duração de AD e gera o PDF pro cliente.',
    steps: [
      {
        title: 'Defina sua tabela de preço',
        text: 'Informe quanto você cobra por minuto de edição. Esse valor fica salvo no navegador — nos próximos orçamentos já vem preenchido.',
      },
      {
        title: 'Adicione os ADs',
        text: 'Uma linha por AD, com a duração no formato mm:ss (um AD de 1 minuto e meio = 01:30). Use os botões + e − pra incluir ou remover linhas. O subtotal recalcula a cada mudança.',
        visual: (
          <Shot label="Calculadora · ADs">
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
        text: 'Desconto em % é opcional e aparece discriminado no orçamento. A chave PIX também é opcional — preencha uma vez e ela fica salva pros próximos.',
      },
      {
        title: 'Revise e gere o relatório',
        text: 'Confira subtotal, desconto e total no card de orçamento, preencha o nome do cliente e gere o relatório em PDF — pronto pra mandar direto no WhatsApp do cliente.',
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
        text: 'Solte o arquivo na área de upload — até 800 MB ou 60 minutos. Assim que o upload termina, a página mostra a duração e o tamanho detectados. Vídeo funciona igual áudio: a ferramenta extrai a trilha sonora sozinha.',
        visual: (
          <Shot label="Gerador de SRT · arquivo">
            <MDrop label="Áudio ou vídeo" sub="até 800MB · 60min" />
          </Shot>
        ),
      },
      {
        title: 'Cole a copy exatamente como foi narrada',
        text: 'Quanto mais fiel o texto for ao que foi realmente falado, mais preciso o alinhamento — inclusive vícios de fala que o locutor manteve. Se o locutor improvisou muito além da copy, o alinhamento marca os trechos de menor confiança pra você revisar.',
      },
      {
        title: 'Gere o SRT',
        text: 'Clique em "Gerar SRT". A ferramenta transcreve o áudio, casa cada palavra da sua copy com o tempo exato em que foi dita e monta os blocos de legenda nesse ritmo real — não em blocos de tempo fixo. O resultado aparece na tela pra conferência antes de baixar.',
        visual: (
          <Shot label="Gerador de SRT · resultado">
            <MRow>
              <MBtn tone="primary">Gerar SRT</MBtn>
              <MChip tone="lime">ALINHADO · PALAVRA A PALAVRA</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Importe no CapCut do jeito certo',
        text: 'Baixe o .SRT e siga o guia "Importar no CapCut" que está no final da página — o caminho certo é importar como LEGENDA (não como texto avulso). Importando assim, os modelos e animações de legenda do CapCut funcionam em cima do seu SRT normalmente.',
      },
    ],
    tips: [
      'A legenda nasce da fala real, não do papel: se o locutor pulou uma frase da copy, ela não aparece — e é o comportamento certo.',
    ],
  },

  '/tools/decupagem-copy': {
    title: 'Decupagem Inteligente',
    tagline: 'A IA lê a sua copy, escolhe o melhor take de cada frase e audita o resultado.',
    steps: [
      {
        title: 'Envie o vídeo bruto',
        text: 'A gravação inteira, sem cortar nada antes — erros, repetições e retakes fazem parte do jogo. Limite: 800 MB ou 40 minutos. É desse material bruto que a IA vai garimpar as melhores tomadas.',
      },
      {
        title: 'Cole a copy frase por frase',
        text: 'Cada linha do campo vira uma frase que a IA procura no vídeo. Se o locutor gravou a mesma frase três vezes, ela transcreve tudo, compara as tomadas e escolhe a mais limpa. Escreva as frases como foram realmente ditas — é o mapa que guia a busca.',
        visual: (
          <Shot label="Decupagem Inteligente · copy">
            <MStack>
              <MField value="Você já tentou de tudo pra dormir melhor?" />
              <MField value="Então presta atenção nos próximos 30 segundos." />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Decida sobre os silêncios',
        text: 'Com o corte de silêncios ligado, as pausas mortas entre as frases escolhidas também somem e o vídeo final sai no ritmo de anúncio. Desligado, as frases são emendadas preservando as pausas originais.',
      },
      {
        title: 'Decupe e leia o laudo',
        text: 'Clique em "Decupar pela copy" e aguarde — transcrição, escolha de takes e montagem rodam em sequência. No final, a auditoria re-transcreve o vídeo montado e compara com a sua copy: cada frase ganha um índice de confiança. Frases em 95%+ pode confiar de olho fechado; abaixo disso, o laudo aponta exatamente o trecho pra você ouvir antes de usar.',
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
        text: 'Escolha um take onde o rosto aparece inteiro e estável — de frente ou levemente de lado, sem mãos passando na frente da boca e sem cortes bruscos de câmera. Quanto mais limpo o take, mais natural o resultado. Iluminação uniforme ajuda mais do que resolução alta.',
        visual: (
          <Shot label="Lipsync · entrada">
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
        text: 'É essa fala que o rosto vai passar a dizer. Áudios longos são divididos em blocos automaticamente e re-emendados no final — você não precisa cortar nada antes. Voz limpa, sem música por cima, rende a sincronia mais precisa.',
      },
      {
        title: 'Dispare e acompanhe',
        text: 'O job entra na fila e o card mostra cada fase: enviando, renderizando, baixando. Você pode navegar pra outras ferramentas enquanto isso — o card continua atualizando. Renderização de lipsync leva alguns minutos; é normal.',
        visual: (
          <Shot label="Lipsync · fila">
            <MQueueItem name="depoimento-v2.mp4" status="renderizando" pct={58} />
          </Shot>
        ),
      },
      {
        title: 'Baixe e confira',
        text: 'Quando ficar pronto, o download libera no próprio card. Antes de usar, confira os primeiros segundos e um trecho do meio — se a boca escorregar em algum ponto, geralmente é um trecho do vídeo original com movimento brusco; vale trocar o take de entrada.',
      },
    ],
  },

  '/tools/ltx-video': {
    title: 'Vídeo do zero',
    tagline: 'Gera vídeo com áudio a partir de um prompt de texto ou de uma imagem.',
    steps: [
      {
        title: 'Descreva a cena',
        text: 'Escreva o que acontece no vídeo: sujeito, ação, ambiente e clima. Prompts em inglês rendem melhor no modelo. Seja específico com o movimento ("rain falling on a neon street, slow pan left") — é o que separa um clipe vivo de uma foto que respira.',
        visual: (
          <Shot label="Vídeo do zero · prompt">
            <MField value="cinematic shot of rain falling on a neon city street..." />
          </Shot>
        ),
      },
      {
        title: 'Escolha resolução e duração',
        text: '6 segundos saem numa geração só; 12 segundos são gerados em dois blocos emendados automaticamente (a emenda é suave, mas confira a transição no resultado).',
      },
      {
        title: 'Opcional: comece de uma imagem',
        text: 'Envie uma imagem pra ser o primeiro frame — o vídeo nasce dela e anima a partir dali. É o caminho certo quando você precisa de continuidade visual com um material que já existe.',
      },
      {
        title: 'Gere e acompanhe a fila de GPU',
        text: 'Clique em gerar e acompanhe o status. A cota de GPU é compartilhada — em horário cheio o job espera a vez, sem travar. Cada resultado cai na galeria abaixo com o prompt salvo junto, pronto pra baixar em MP4.',
      },
    ],
    tips: ['Guarde os prompts que funcionaram — a galeria mostra o prompt de cada vídeo gerado.'],
  },

  '/tools/separador-audio': {
    title: 'Separador de Áudio',
    tagline: 'Separa voz, trilha sonora e efeitos em três faixas independentes.',
    steps: [
      {
        title: 'Envie o arquivo',
        text: 'Áudio ou vídeo — o upload vai direto pro processamento em nuvem, sem limite apertado de tamanho. De vídeo, só a trilha de áudio é usada.',
      },
      {
        title: 'Separe',
        text: 'Clique em "Separar voz, trilha sonora e SFX" e aguarde. A separação roda num modelo de IA em nuvem e leva alguns minutos em arquivos longos — a página mostra o estágio atual.',
        visual: (
          <Shot label="Separador · ação">
            <MBtn tone="primary">Separar voz, trilha sonora e SFX</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Ouça e baixe as faixas',
        text: 'Cada faixa sai num card com player próprio: voz isolada, trilha sonora e efeitos. Ouça pra conferir a separação e baixe só a que precisa — ou todas de uma vez.',
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
        text: 'O arquivo com voz e música misturadas — o caso típico é um criativo pronto de onde você precisa recuperar só a fala.',
      },
      {
        title: 'Escolha o modo de isolação',
        text: 'AUTO resolve a grande maioria dos casos — comece sempre por ele. Os outros são pra áudios difíceis: CENTER quando a voz está centralizada no estéreo, BANDPASS quando a música invade as frequências da fala, AGGRESSIVE quando sobrou muito vazamento (ao custo de alguma naturalidade).',
        visual: (
          <Shot label="Isolar voz · modo">
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
        title: 'Compare antes e depois',
        text: 'Clique em "Isolar voz" e use os dois players pra comparar o original com o resultado. Ficou bom? Baixe o vocals.wav. Sobrou música? Tente o próximo modo da lista — cada um ataca o problema de um jeito.',
      },
    ],
  },

  '/tools/normalizador': {
    title: 'Normalizador',
    tagline: 'Iguala o volume de vários arquivos e limpa o chiado de fundo.',
    steps: [
      {
        title: 'Solte os arquivos',
        text: 'Até 10 por fila. O caso clássico: dois locutores gravaram em volumes diferentes e precisam sair no mesmo patamar pra edição não denunciar.',
      },
      {
        title: 'Escolha o formato de saída',
        text: 'MP4 pra vídeo, MP3 ou WAV pra áudio — vale pra fila inteira.',
      },
      {
        title: 'Normalize e baixe',
        text: 'Clique em "Normalizar": todas as vozes saem no mesmo nível, sem estouro nos picos e com o chiado de fundo atenuado. Cada card libera o próprio download; o ZIP pega tudo no final.',
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
        text: 'Use o mesmo token do ClickUp Pilot — se você já conectou lá, esta página entra sozinha, sem pedir nada.',
      },
      {
        title: 'Escolha o escopo',
        text: 'Aponte pra pasta de tasks do seu time. Só as entregas dessa pasta contam pontos — o resto do workspace fica de fora da conta.',
      },
      {
        title: 'Acompanhe pontos e medalhas',
        text: 'Cada task concluída soma pontos pelo peso da entrega (subtasks contam também). As medalhas — Rookie, Elite, Champion e Legend — destravam por meta acumulada, e o anel de progresso mostra quanto falta pra próxima.',
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
        title: 'Ajuste o que conta como entrega',
        text: 'Nas opções, defina quais status fecham uma task (closed, done ou os dois). Se o seu fluxo usa um status custom de "entregue", marque o equivalente aqui pra conta bater com a realidade.',
      },
    ],
  },

  '/tools/lipsync-history': {
    title: 'Histórico de avatares',
    tagline: 'Todos os seus disparos de avatar, com os ZIPs salvos no navegador.',
    steps: [
      {
        title: 'Encontre o disparo',
        text: 'Cada lote aparece com data, nome e status. Os arquivos ficam guardados no armazenamento do próprio navegador — sobrevivem a F5 e a fechar a aba.',
      },
      {
        title: 'Baixe de novo quando precisar',
        text: 'Os ZIPs de takes, montado e camuflado continuam disponíveis mesmo dias depois do disparo. Perdeu o download na hora? É aqui que você recupera.',
        visual: (
          <Shot label="Histórico · lote">
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
        text: '"Retomar" continua um lote interrompido exatamente de onde parou — o que já renderizou não é gerado de novo, só as partes que faltam. É o caminho certo depois de um limite diário do HeyGen ou de uma queda de conexão.',
      },
    ],
    tips: [
      'O espaço é gerenciado sozinho: lotes muito antigos são limpos pra não inchar o navegador — baixe e guarde o que for definitivo.',
    ],
  },

  '/tools/background': {
    title: 'Tarefas em segundo plano',
    tagline: 'Acompanha tudo que o Pilot e o Auto B-roll estão processando agora.',
    steps: [
      {
        title: 'Leia o panorama',
        text: 'Os contadores do topo mostram o momento da operação: quantas tasks estão em processo, na fila, concluídas e com falha — atualizando ao vivo, sem precisar recarregar.',
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
        title: 'Filtre por tipo de trabalho',
        text: 'As abas separam a fila de Lipsync (HeyGen) da fila de B-rolls (Magnific). "Tudo" mostra as duas misturadas em ordem de atividade.',
      },
      {
        title: 'Baixe ou intervenha',
        text: 'Cada task mostra barra de progresso e o detalhe das partes. Nas concluídas, baixe os ZIPs (takes, montado, camuflado) direto daqui; nas outras, dá pra cancelar ou remover. Cancelar aqui tem o mesmo efeito que cancelar na ferramenta de origem.',
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
      'Esta tela é um observador — o processamento roda na aba da ferramenta de origem. Mantenha aquela aba aberta até o fim.',
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
        text: 'Duas condições, e você nunca mais pensa nisso: a extensão DARKO LAB instalada no Chrome (o bloco "Como instalar (passo a passo)" na página mostra cada clique) e uma aba do navegador logada no HeyGen. O disparo roda pela sua assinatura normal do HeyGen — não usa API, não tem custo extra por vídeo. O indicador de extensão no topo da página precisa estar verde antes de qualquer disparo.',
        visual: (
          <Shot label="Hey Auto · setup">
            <MRow>
              <MChip tone="lime">EXTENSÃO CONECTADA ✓</MChip>
              <MChip tone="dim">HEYGEN LOGADO</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Comece pelo caminho certo: Docs ou manual',
        text: 'Tem um Google Docs com as copys? Use o botão de importar doc: o Hey Auto lê o documento, identifica cada AD (avatar, voz, hooks e body) com o mesmo parser do ClickUp Pilot e abre a análise em tela cheia pra você revisar antes de enfileirar. Sem doc, siga o fluxo manual dos próximos passos — o resultado é o mesmo.',
      },
      {
        title: 'Nomeie o AD',
        text: 'O nome organiza a fila e vira o prefixo dos ZIPs finais (AD07_takes.zip, AD07_montado.zip...). Use o código real do AD pra bater com o resto da sua operação.',
      },
      {
        title: 'Escolha avatar, voz e motor',
        text: 'O seletor de avatar busca na sua biblioteca do HeyGen com preview em vídeo. A voz pode seguir o padrão do avatar ou ser trocada por outra da sua conta. O motor define o estilo de render do HeyGen — na dúvida, mantenha o padrão; o app memoriza as combinações de avatar+voz que você usa e sugere sozinho da próxima vez.',
        visual: (
          <Shot label="Hey Auto · avatar e voz">
            <MRow>
              <MField label="Avatar" value="Ana — Studio" grow />
              <MField label="Voz" value="padrão do avatar" grow />
              <MField label="Motor" value="V" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Estruture hooks e body',
        text: 'No modo Copy, cole o texto; no modo Áudio, suba os arquivos. Cada HOOK vira um take independente (é assim que nascem as variações de gancho), e o BODY é dividido automaticamente em partes de ~20 segundos — o tamanho que o HeyGen rende com mais estabilidade. Você vê a contagem de partes antes de enfileirar.',
        visual: (
          <Shot label="Hey Auto · estrutura">
            <MStack>
              <MField label="Hook 1" value="Você já tentou de tudo pra..." />
              <MField label="Hook 2" value="O que ninguém te contou sobre..." />
              <MField label="Body" value="A verdade é que existe um jeito..." />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Adicione à fila — e repita',
        text: '"Adicionar à fila" captura o AD inteiro (avatar, voz, motor, estrutura, decupagem/camuflagem) como um item. Monte quantos ADs quiser antes de disparar: dá pra reordenar com as setas, editar qualquer parte e remover itens. Cada item da fila já mostra o preview dos takes que vai gerar.',
      },
      {
        title: 'Processe a fila e deixe rodar',
        text: 'Clique em "▶ Processar fila". A partir daí é tudo automático, item por item: disparo das partes no HeyGen, poll de renderização, download dos vídeos e montagem final — com decupagem e camuflagem no meio, se você marcou. O card de cada item mostra a fase e a porcentagem ao vivo. Não precisa clicar em mais nada.',
        visual: (
          <Shot label="Hey Auto · fila rodando">
            <MStack>
              <MBtn tone="primary">▶ Processar fila (3)</MBtn>
              <MQueueItem name="AD07 · 4 partes" status="renderizando 2/4" pct={45} />
              <MQueueItem name="AD08 · 3 partes" status="na fila" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Receba os 3 ZIPs por AD',
        text: 'Cada AD entrega três pacotes, baixados automaticamente quando ficam prontos: os takes na ordem (parte1, parte2...), o montado (hook + body emendado e decupado, pronto pra edição) e o camuflado (quando a camuflagem está ligada). Tudo também fica salvo no Histórico de avatares — perdeu o download, recupera lá.',
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
      'O avatar ainda não existe no HeyGen? O Avatar First cria um novo a partir de foto + áudio, direto na fila.',
      'Fila "travada" no meio do dia quase sempre é o limite diário do HeyGen — não é defeito. Use Retomar mais tarde: continua de onde parou, sem regenerar o que já ficou pronto.',
      'F5 não perde nada: fila, progresso e resultados ficam salvos no navegador.',
      'Disparou sem fila (modo direto)? O fluxo também segue sozinho até os ZIPs — igual ao Pilot.',
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
        text: 'Cole seu token pessoal do ClickUp (Configurações → Apps, no próprio ClickUp) — ele fica salvo só no seu navegador, e o Pilot apenas LÊ as tasks: nada é escrito de volta no seu workspace. Depois escolha o Time e o Editor que você quer operar; essa escolha também fica memorizada.',
        visual: (
          <Shot label="Pilot · conexão">
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
        text: 'Escolha a data e o Pilot lista as tasks daquele dia com o nome exato do ClickUp. Marque as que entram no disparo — uma, algumas ou todas. A seleção em massa existe pra dias cheios; nada acontece até você iniciar explicitamente no passo 6.',
        visual: (
          <Shot label="Pilot · seleção">
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
        text: '"⬇ Buscar automático" lê o Google Docs linkado na descrição da task e traz a copy inteira. Doc privado que o automático não alcança? Abra o doc, Ctrl+A, Ctrl+C, e cole no campo da task — o resultado da análise é idêntico. O briefing precisa seguir o formato do manual: é ele que permite ao Pilot identificar avatar e roteiro sem erro.',
      },
      {
        title: 'Deixe o Pilot analisar',
        text: 'A análise interpreta o briefing: identifica o avatar (por link, print ou nome), acha a voz memorizada daquele avatar, separa hooks e body e divide a copy em partes de ~20s. Task com selo PRONTO está completa pra disparar. Task PARCIAL está quase — normalmente falta você confirmar o avatar à mão no seletor. Task com erro mostra o motivo exato (geralmente briefing fora do formato).',
        visual: (
          <Shot label="Pilot · análise">
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
        title: 'Refine o que quiser antes de disparar',
        text: 'Tudo que a análise decidiu é ajustável por task: troque avatar ou voz pelo seletor (com preview), defina o motor por lote inteiro, por percentual ou task a task, e ligue decupagem e camuflagem individualmente. O preview mostra exatamente o que vai ser disparado — parte por parte — antes de qualquer clique no HeyGen.',
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
        text: 'Clique em "▶ Iniciar N tasks em background". O Pilot assume: dispara parte por parte no HeyGen respeitando o limite de slots, acompanha a renderização, baixa cada vídeo e monta o resultado — com auto-cura no meio (parte que travar no render é re-disparada sozinha, até 2 rodadas). Você pode trocar de aba ou ir embora; só não feche a aba do Pilot.',
        visual: (
          <Shot label="Pilot · disparo">
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
        text: 'Pelos cards da própria página ou pela tela "Tarefas em segundo plano" (atalho dentro do Histórico geral). Pausar, Retomar e Cancelar funcionam por task, a qualquer momento — pausar não perde nada do que já rendeu.',
      },
      {
        title: 'Receba os 3 ZIPs por task',
        text: 'Cada task entrega takes na ordem, montado (decupado) e camuflado — nomeados pelo nome real da task, prontos pra edição final. Se alguma parte não veio (limite do HeyGen no meio do caminho), o Pilot NÃO monta vídeo furado: ele trava a entrega e explica o que faltou, pra você retomar depois.',
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
      'F5 no meio do disparo não perde nada: o plano fica salvo e a task retoma sozinha.',
      '"Travou" no meio do dia? Normalmente é o limite diário do HeyGen — Retomar continua depois, sem regenerar o que já ficou pronto.',
      'Avatar de outro workspace do HeyGen aparece como "not accessible" — troque o workspace na aba do HeyGen e retome.',
      'O Pilot nunca escreve no seu ClickUp — leitura apenas.',
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
        text: 'Clique em "⬇ Baixar Extensão" no primeiro card e siga o passo a passo da própria página. A extensão é quem opera o Magnific por você — sem ela não existe geração. O indicador do card precisa ficar verde ("PRONTO"); se aparecer "reinstalar", é porque saiu versão nova: baixe de novo, leva menos de um minuto.',
        visual: (
          <Shot label="Auto B-roll · extensão">
            <MRow>
              <MBtn tone="primary">⬇ Baixar Extensão</MBtn>
              <MChip tone="lime">PRONTO ✓</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Conecte sua conta Freepik Premium+',
        text: 'Faça login no magnific.com com a conta que tem o plano Premium+ ativo — é o único pré-requisito externo. Cada take roda no modo Unlimited da SUA conta: você não gasta crédito por vídeo, só a mensalidade do Freepik que já paga. Trocou de conta no Magnific? Clique em "Trocar conta" na página pra re-sincronizar.',
      },
      {
        title: 'Confira a configuração',
        text: 'O painel de Configuração tem três decisões: o modelo de IMAGEM (Nano Banana 2 pra consistência e velocidade, Seedream 4.5 pra detalhe cinematográfico), o FORMATO (Vertical 9:16 pra Reels/TikTok, Horizontal 16:9 pra YouTube/VSL) e o MOVIMENTO opcional — um prompt de câmera aplicado aos takes que não trouxerem o próprio. O perfil de VÍDEO é travado de propósito (Kling 2.5 · 720p · 10s): é o ponto calibrado do Unlimited.',
        visual: (
          <Shot label="Auto B-roll · configuração">
            <MRow>
              <MChip tone="violet">NANO BANANA 2</MChip>
              <MChip tone="lime">VERTICAL 9:16</MChip>
              <MChip tone="dim">KLING 2.5 · TRAVADO</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Crie um job com a lista de prompts',
        text: 'Dê um nome ao pack (vira o nome do ZIP) e cole a lista de takes — texto simples ou JSON no formato {take, imagePrompt, videoPrompt}. O app conta na hora quantos takes detectou; confira esse número antes de disparar. Dá pra colar da área de transferência com um clique e empilhar vários jobs com "+ Adicionar outro JSON".',
        visual: (
          <Shot label="Auto B-roll · job">
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
        title: 'Dispare e acompanhe take a take',
        text: 'Aperte "Disparar". Cada take passa por duas fases: primeiro o FRAME (a imagem-base, ~50% do progresso), depois o VÍDEO (o movimento por cima do frame). O grid mostra cada take com porcentagem ao vivo e marca qual está gerando agora. A fila é serial de propósito — um take por vez é o que rende estável no Magnific.',
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
        title: 'Baixe sem esperar o lote inteiro',
        text: 'Take pronto é take utilizável: expanda pra tela cheia pra conferir e baixe o MP4 individual na hora, enquanto os outros ainda geram. Take que não convenceu? Regenere só ele, sem tocar no resto do lote.',
      },
      {
        title: 'Pegue o ZIP organizado',
        text: 'Quando o último take termina, sai um ZIP nomeado com todos os MP4s na ordem do JSON — direto pra timeline, sem renomear nada. O Histórico na parte de baixo da página guarda os lotes anteriores: re-baixe o ZIP de dias atrás ou remova o que já era.',
        visual: (
          <Shot label="Auto B-roll · entrega">
            <MRow>
              <MBtn tone="lime">Baixar ZIP (12)</MBtn>
              <MChip tone="dim">HISTÓRICO · 4 LOTES</MChip>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Os takes ficam salvos offline no navegador — F5 no meio do lote não apaga nada.',
      '"Retomar" continua um lote interrompido sem regenerar o que já ficou pronto.',
      'O MOVIMENTO global só entra nos takes sem videoPrompt próprio — take com prompt de câmera no JSON mantém o dele.',
    ],
  },
};

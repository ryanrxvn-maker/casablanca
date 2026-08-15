import type { ReactNode } from 'react';

import {
  MBtn,
  MChip,
  MDoc,
  MDocL,
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
 * Regras da copy (pedido do dono, 10.07.26):
 * - cada passo ensina de verdade: o que fazer, o que a tela responde e o que
 *   conferir antes de seguir — quem lê termina sabendo usar;
 * - nomes de botões/campos IDÊNTICOS aos da UI real (conferidos no código);
 * - NUNCA prometer o que a ferramenta não faz — a entrega descrita é a
 *   entrega real (ex.: Hey Auto/Pilot entregam o MP4 montado, não "3 ZIPs");
 * - cobrir os modos secundários também (Descamuflar, modo mudo, Retomar...);
 * - sem marcadores sobre os prints: o print imita a UI e fala por si.
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
    tagline:
      'Corta os silêncios em lote e devolve cada arquivo limpo — vídeo vira vídeo, áudio vira áudio.',
    steps: [
      {
        title: 'Solte os arquivos na fila',
        text: 'No card "Solta os arquivos (até 10)", arraste seus vídeos ou áudios — ou clique na área pra abrir o seletor. Aceita MP3, WAV, MP4, WEBM e MOV, até 800 MB cada, e pode misturar vídeo com áudio na mesma fila. Cada arquivo vira um item numerado com o tamanho e o status "na fila". O contador embaixo da área mostra quantos já entraram (ex.: "3/10 na fila"). Entrou arquivo errado? O "×" ao lado do item tira ele da fila.',
        visual: (
          <Shot label="Decupagem · fila">
            <MStack>
              <MDrop
                label="Arraste ou clique pra subir"
                sub="Arraste vários ou clique. 3/10 na fila."
              />
              <MQueueItem name="ad-hook-03.mp4" status="na fila" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha como receber os vídeos',
        text: 'Se a fila tiver vídeo, aparece o card "Como receber os vídeos?" com duas opções: "Vídeo" (o arquivo volta em MP4, já cortado) ou "Áudio" (só a trilha de voz limpa — útil quando o vídeo era apenas o meio de transporte da fala). A escolha vale pra fila inteira. No plano grátis a saída é sempre o áudio; receber o vídeo em MP4 é recurso das contas pagas — a própria tela sinaliza com "🔒 Vídeo bloqueado no plano grátis."',
        visual: (
          <Shot label="Decupagem · como receber">
            <MRow>
              <MBtn tone="primary">Vídeo</MBtn>
              <MBtn tone="dark">Áudio</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Defina o formato do áudio',
        text: 'Quando a saída for áudio (ou a fila só tiver áudio), o card "Formato do áudio" deixa você escolher entre "MP3" (leve, serve pra quase tudo) e "WAV" (sem compressão, ideal se o arquivo ainda vai passar por outra etapa de edição). O padrão é MP3.',
        visual: (
          <Shot label="Decupagem · formato">
            <MRow>
              <MChip tone="violet">MP3</MChip>
              <MChip tone="dim">WAV</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Calibre quanto de silêncio manter',
        text: 'O card "Quanto de silêncio manter?" controla o ritmo do corte com o controle "Tolerância de silêncio" (de 0.01s a 0.5s). Puxando pra esquerda, as pausas somem quase por completo — corte seco, estilo anúncio. Puxando pra direita, a fala respira mais natural. Na dúvida, deixe no padrão (0.05s): remove o tempo morto preservando uma pausa curta e confortável entre as frases.',
        visual: (
          <Shot label="Decupagem · ajuste">
            <MSlider label="Tolerância de silêncio" pct={10} val="0.05s" />
          </Shot>
        ),
      },
      {
        title: 'Decupe a fila e acompanhe',
        text: 'Clique em "Decupar fila (N)". Os arquivos processam um por vez, na ordem, e cada item mostra a fase em tempo real: "Analisando...", "Regulando a voz...", "Cortando silêncios...", "Gerando arquivo...". Precisa parar? "Cancelar fila" interrompe sem perder o que já ficou pronto — depois o botão vira "Continuar fila (N restantes)" e retoma de onde parou.',
        visual: (
          <Shot label="Decupagem · processando">
            <MStack>
              <MBtn tone="lime">Decupar fila (3)</MBtn>
              <MQueueItem name="ad-hook-03.mp4" status="Cortando silêncios..." pct={64} />
              <MQueueItem name="body-parte2.mp3" status="na fila" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Confira o resultado e baixe',
        text: 'Cada arquivo pronto ganha um card "PRONTO" com player de preview e três métricas: "Original", "Após decupagem" e "Redução" (ex.: −31%). Ouça o começo e um trecho do meio pra confirmar que o corte ficou no ritmo que você queria. Baixe cada arquivo pelo botão "Baixar MP4/MP3/WAV" do card (sai nomeado como "_decupado") ou, com 2 ou mais prontos, use "↓ Baixar todos (ZIP)" pra pegar tudo de uma vez.',
        visual: (
          <Shot label="Decupagem · resultado">
            <MStack>
              <MQueueItem name="ad-hook-03_decupado.mp4" status="PRONTO · −31%" pct={100} tone="lime" />
              <MRow>
                <MBtn tone="lime">Baixar MP4</MBtn>
                <MBtn tone="ghost">↓ Baixar todos (ZIP)</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'O volume da voz é regulado automaticamente antes do corte ("Regulando a voz") — dois locutores gravados em volumes diferentes saem no mesmo patamar.',
      'O corte protege o ataque das palavras: nenhuma sílaba é comida no início nem no fim das frases.',
      'Tudo roda no seu navegador — nada sobe pra servidor. Arquivos grandes (acima de 200 MB) são divididos em partes automaticamente, processados parte a parte ("Parte 2/4 — Cortando silêncios...") e juntados num arquivo só no final.',
      'Apareceu "Não consegui detectar a fala"? Diminua a tolerância de silêncio e rode de novo.',
    ],
  },

  '/tools/camuflagem': {
    title: 'Camuflagem',
    tagline:
      'Esconde o áudio que a IA do TikTok/Kwai/YouTube/Meta lê — e descamufla quando você precisar do áudio de volta.',
    size: 'large',
    steps: [
      {
        title: 'Entenda os dois modos: Camuflar e Descamuflar',
        text: 'No topo da ferramenta tem um seletor com dois modos. "Camuflar" junta dois áudios num arquivo só: o ORIGINAL (o que o público realmente ouve) e o ESCONDIDO (o que a transcrição automática da plataforma vai ler no lugar). "Descamuflar" faz o caminho inverso: recebe um arquivo já camuflado e separa as camadas de volta. Os passos 2 a 5 são do modo Camuflar; os passos 6 e 7, do Descamuflar.',
        visual: (
          <Shot label="Camuflagem · modo">
            <MRow>
              <MBtn tone="primary">Camuflar</MBtn>
              <MBtn tone="dark">Descamuflar</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Ajuste a intensidade',
        text: 'O controle "Volume da camuflagem" vai de 5% a 100% e começa em 30%. Intensidade maior segura melhor a transcrição, mas pode deixar rastros audíveis em fone de ouvido; menor é imperceptível, mas pode não cobrir todos os trechos. Comece no padrão — o selo do passo 5 diz na hora se precisou de mais.',
        visual: (
          <Shot label="Camuflagem · intensidade">
            <MSlider label="Volume da camuflagem" pct={30} val="30%" />
          </Shot>
        ),
      },
      {
        title: 'Escolha o formato de saída',
        text: 'No card "Formato de saída": "MP4" mantém o vídeo original e troca só a trilha de áudio pela versão camuflada (precisa que o arquivo original seja um vídeo); "MP3" e "WAV" entregam só o áudio. O padrão é WAV.',
        visual: (
          <Shot label="Camuflagem · formato">
            <MRow>
              <MChip tone="dim">MP4</MChip>
              <MChip tone="dim">MP3</MChip>
              <MChip tone="violet">WAV</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Envie os pares Original + escondido',
        text: 'No card "Original + escondido", suba o "Áudio original" (o que toca no vídeo — pode ser o próprio MP4) e o "Áudio escondido" (o que a IA vai transcrever). O escondido pode ser mais curto que o original: o resultado mantém a duração do original. Dá pra processar até 10 pares de uma vez com "+ Adicionar par (N/10)". Existe ainda o MODO MUDO (botão de alto-falante no canto do card): com ele ligado você não sobe escondido nenhum — o público ouve o original normalmente e a IA escuta silêncio.',
        visual: (
          <Shot label="Camuflagem · arquivos">
            <MRow>
              <div className="flex-1">
                <MDrop label="Áudio original" sub="o que toca no vídeo" />
              </div>
              <div className="flex-1">
                <MDrop label="Áudio escondido" sub="o que a IA vai ler" />
              </div>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Processe e confie no selo',
        text: 'Clique em "Processar tudo". Depois de camuflar, a ferramenta verifica sozinha o arquivo final do mesmo jeito que as IAs das plataformas escutam, e mostra o veredito por plataforma: selo verde "CAMUFLADO PRA TIKTOK / KWAI / YOUTUBE / META" significa que essas IAs escutam o áudio escondido — pode publicar. Veio "NÃO CAMUFLADO"? Suba a intensidade e processe de novo. O botão de transcrever no card mostra o texto exato que a IA leu, pra você conferir com os próprios olhos. Baixe cada resultado ("Baixar MP4/MP3/WAV") ou tudo junto com "Baixar ZIP (N)". Nunca publique sem o selo verde.',
        visual: (
          <Shot label="Camuflagem · validação">
            <MStack>
              <MChip tone="lime">CAMUFLADO ✓ · TIKTOK · KWAI · YOUTUBE · META</MChip>
              <MRow>
                <MBtn tone="lime">Baixar WAV</MBtn>
                <MBtn tone="ghost">Baixar ZIP (3)</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Descamuflar: recupere qualquer camada',
        text: 'Troque pro modo "Descamuflar" no seletor do topo. No card "O que recuperar", escolha: "Áudio original" devolve a voz limpa que o público ouvia (remove a camada escondida); "Áudio escondido" extrai a trilha que estava embutida pra IA — útil pra conferir o que tinha dentro de um arquivo camuflado. Suba os arquivos no card "Arquivos camuflados" (até 10, com "+ Adicionar arquivo") e clique em "Descamuflar tudo". Cada resultado sai com player pra ouvir e botão de download — nomeado "_original" ou "_escondido", conforme o que você recuperou.',
        visual: (
          <Shot label="Descamuflar · o que recuperar">
            <MStack>
              <MRow>
                <MBtn tone="primary">Áudio original</MBtn>
                <MBtn tone="dark">Áudio escondido</MBtn>
              </MRow>
              <MDrop label="Arquivo camuflado" sub="áudio ou vídeo estéreo já camuflado" />
              <MBtn tone="lime">Descamuflar tudo</MBtn>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Troque o escondido sem regravar nada',
        text: 'Ainda no modo Descamuflar, o botão "Trocar áudio escondido" (no canto do card de arquivos) ativa a troca direta: você sobe o arquivo camuflado + um "Novo áudio escondido", ajusta a "Intensidade do novo escondido" e clica em "Trocar escondido e camuflar". A ferramenta recupera o áudio original, descarta o escondido antigo e embute o novo no lugar — validando no final ("NOVO ESCONDIDO EMBUTIDO"). O download sai como "_escondido-trocado".',
        visual: (
          <Shot label="Descamuflar · trocar escondido">
            <MStack>
              <MToggle on label="Trocar áudio escondido" />
              <MDrop label="Novo áudio escondido" sub="entra no lugar do antigo" />
              <MBtn tone="primary">Trocar escondido e camuflar</MBtn>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'O selo é medido no arquivo real, depois de pronto — não é estimativa. Se ficou verde, é porque a transcrição devolveu o áudio escondido.',
      'A camuflagem funciona em áudio estéreo. Arquivo mono não tem camada pra separar — no Descamuflar a ferramenta avisa e devolve o áudio como está.',
      'A camuflagem mira a transcrição automática das plataformas. Não existe garantia universal contra todo detector — por isso o selo existe: valide sempre antes de publicar.',
      'A verificação usa a chave de Transcrição — se estiver faltando, o banner "Chave pendente" aponta direto pro botão "Configurar →".',
    ],
  },

  '/tools/downloader': {
    title: 'Downloader',
    tagline: 'Baixa vídeos, áudios e imagens do YouTube, Instagram, TikTok e Pinterest.',
    steps: [
      {
        title: 'Instale o Motor + a Extensão (uma vez só)',
        text: 'O Downloader usa duas peças que você instala uma única vez: o Motor (card "Passo 01 — Instalar o Motor": um .exe de 1 clique que instala sozinho e faz o download pesado no seu PC) e a Extensão do Chrome (card "Passo 02 — Baixar Extensão"). O bloco "Instruções detalhadas" mostra cada clique — inclusive o aviso do Windows: se aparecer a tela azul do SmartScreen, clique em "Mais informações" e depois "Executar assim mesmo". Quando tudo estiver certo, o card mostra o ponto verde com "Auto Edit · Downloader" e o selo "✓ motor online".',
        visual: (
          <Shot label="Downloader · setup">
            <MStack>
              <MRow>
                <MBtn tone="primary">Instalar o Motor (.exe)</MBtn>
                <MBtn tone="ghost">Baixar Extensão</MBtn>
              </MRow>
              <MRow>
                <MChip tone="lime">AUTO EDIT · DOWNLOADER</MChip>
                <MChip tone="lime">✓ MOTOR ONLINE</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Cole os links',
        text: 'Um link por linha, quantos quiser — o contador "Detectados" mostra quantos links válidos a ferramenta reconheceu. Pode misturar plataformas na mesma leva: um Reel do Instagram, um vídeo do YouTube, um TikTok e um pin do Pinterest descem juntos. Links encurtados (pin.it, vm.tiktok) funcionam normalmente.',
        visual: (
          <Shot label="Downloader · links">
            <MStack>
              <MField value="https://youtube.com/watch?v=..." />
              <MField value="https://www.instagram.com/reel/..." />
              <MField value="https://pin.it/..." />
              <MChip tone="dim">DETECTADOS · 3 LINKS</MChip>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha formato e qualidade',
        text: 'No card "Formato": "Vídeo" (arquivo completo), "Áudio MP3" ou "Áudio WAV" (só o som, extraído do vídeo). Escolhendo Vídeo, aparece a linha "Qualidade": 1080p, 720p, 480p ou Máxima. A escolha vale pra leva inteira — se precisar de formatos diferentes, rode em duas levas. Imagens (como pins do Pinterest) baixam direto como mídia, sem precisar escolher nada.',
        visual: (
          <Shot label="Downloader · formato">
            <MStack>
              <MRow>
                <MChip tone="violet">VÍDEO</MChip>
                <MChip tone="dim">ÁUDIO MP3</MChip>
                <MChip tone="dim">ÁUDIO WAV</MChip>
              </MRow>
              <MRow>
                <MChip tone="violet">1080P</MChip>
                <MChip tone="dim">720P</MChip>
                <MChip tone="dim">480P</MChip>
                <MChip tone="dim">MÁXIMA</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe e acompanhe cada link',
        text: 'Clique em "Baixar N arquivos". Cada link vira um card com a plataforma detectada e o status ao vivo: "fila" → "localizando" → porcentagem baixando → "ok". Vários links baixam em paralelo, com download acelerado. Os arquivos caem na sua pasta de Downloads com nome limpo. Um link que falhar mostra "erro" no próprio card — os outros seguem normalmente.',
        visual: (
          <Shot label="Downloader · baixando">
            <MStack>
              <MBtn tone="lime">Baixar 3 arquivos</MBtn>
              <MQueueItem name="reel-cliente.mp4 · Instagram" status="62%" pct={62} />
              <MQueueItem name="video-ref.mp4 · YouTube" status="ok" pct={100} tone="lime" />
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'TikTok sai sem marca d’água e em HD; Pinterest baixa a mídia direta.',
      'Apareceu "Motor desconectado"? Abra o atalho "Auto Edit Downloader" no menu Iniciar do Windows e clique em "↻ Verificar de novo" — a página re-testa sozinha a cada 5 segundos.',
      'Antivírus bloqueou o instalador? Use o botão "↓ Baixar versão ZIP (alternativa)" no mesmo card.',
      'Links privados exigem login na plataforma. Baixe apenas conteúdo que você tem direito de usar.',
    ],
  },

  '/tools/compressor': {
    title: 'Compressor',
    tagline: 'Reduz o peso dos vídeos sem perda visível — com previsão de tamanho antes de processar.',
    steps: [
      {
        title: 'Solte os vídeos',
        text: 'No card "Solta os vídeos", arraste até 20 arquivos MP4, WEBM ou MOV (esta ferramenta é só pra vídeo). Até 5 comprimem ao mesmo tempo; os demais aguardam a vez sozinhos. Assim que os arquivos entram, o topo mostra as métricas do lote: "Arquivos", "Entrada" (peso total), "Duração" e "Previsão" — o tamanho estimado da saída com o ajuste atual.',
        visual: (
          <Shot label="Compressor · fila">
            <MStack>
              <MDrop label="Arraste ou clique pra subir" sub="MP4, WEBM ou MOV — até 20 por lote" />
              <MRow>
                <MChip tone="dim">ENTRADA · 312 MB</MChip>
                <MChip tone="violet">PREVISÃO · ~118 MB</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Ajuste a qualidade olhando a previsão',
        text: 'O controle "CRF" vai de 18 (alta qualidade) a 35 (menor arquivo) — padrão 23. A cada movimento do controle, a métrica "Previsão" e a linha "prev." de cada vídeo recalculam na hora, então você acerta o alvo sem tentativa e erro: precisa caber num limite de upload? Vá subindo o CRF até a previsão bater. Pra vídeo publicado em rede social, dá pra comprimir bastante sem diferença visível.',
        visual: (
          <Shot label="Compressor · qualidade">
            <MSlider label="CRF" pct={30} val="23" />
          </Shot>
        ),
      },
      {
        title: 'Escolha a resolução',
        text: 'No card "Resolução": "Original" preserva o tamanho exato do quadro; "1080p", "720p" ou "480p" reduzem a resolução e cortam ainda mais o peso. Pra feed e stories, 1080p é mais que suficiente.',
        visual: (
          <Shot label="Compressor · resolução">
            <MRow>
              <MChip tone="violet">ORIGINAL</MChip>
              <MChip tone="dim">1080P</MChip>
              <MChip tone="dim">720P</MChip>
              <MChip tone="dim">480P</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Comprima e compare o real com o previsto',
        text: 'Clique em "Comprimir N vídeos". Durante o processo, os chips mostram o pool ao vivo: "Rodando · n/5", "Fila" e "Concluídos". Cada vídeo pronto exibe a comparação completa — tamanho de entrada → saída, a redução em % e quão perto a previsão chegou do resultado real — e a barra "Você economizou" soma o total do lote. Baixe um a um pelo "Baixar" de cada card ou tudo junto com "Baixar ZIP (N)".',
        visual: (
          <Shot label="Compressor · resultado">
            <MStack>
              <MRow>
                <MChip tone="violet">RODANDO · 3/5</MChip>
                <MChip tone="dim">FILA · 2</MChip>
                <MChip tone="lime">CONCLUÍDOS · 4</MChip>
              </MRow>
              <MQueueItem name="criativo-final.mp4" status="62% menor" pct={100} tone="lime" />
              <MBtn tone="lime">Baixar ZIP (4)</MBtn>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'A saída é sempre MP4, independente do formato de entrada.',
      'Tudo roda no seu navegador — os vídeos não sobem pra nenhum servidor.',
    ],
  },

  '/tools/audio-split': {
    title: 'Dividir áudios',
    tagline: 'Quebra um áudio longo em partes, cortando apenas nas pausas — sem partir frase.',
    steps: [
      {
        title: 'Envie o arquivo',
        text: 'Um arquivo por vez: MP3, WAV, MP4, WEBM ou OGG. Se você subir um vídeo, a ferramenta aproveita só a trilha de áudio e descarta a imagem.',
        visual: (
          <Shot label="Dividir áudios · arquivo">
            <MDrop label="Selecione ou arraste um arquivo" sub="MP3, WAV, MP4, WEBM ou OGG" />
          </Shot>
        ),
      },
      {
        title: 'Entenda onde a ferramenta corta',
        text: 'A divisão procura as pausas mais longas da fala e quebra em partes equilibradas — cerca de 4 partes por minuto de fala, nunca no meio de uma frase. Por isso as partes saem com durações diferentes entre si: o corte respeita o ritmo de quem fala, não um relógio. Importante: esta ferramenta DIVIDE o áudio; ela não remove silêncios — pra isso, use a Decupagem (a própria tela indica o caminho).',
      },
      {
        title: 'Processe, ouça e baixe',
        text: 'Clique em "Processar" e acompanhe o status ("Carregando...", "Dividindo...", "Gerando arquivos..."). O resultado lista cada parte numerada com duração e player próprio — ouça o fim de uma e o começo da seguinte pra conferir a emenda. Baixe cada parte pelo "Baixar" (saem como parte1.wav, parte2.wav...) ou pegue tudo com "Baixar ZIP".',
        visual: (
          <Shot label="Dividir áudios · resultado">
            <MStack>
              <MQueueItem name="Parte 1 · 0:19" status="pronta" pct={100} tone="lime" />
              <MQueueItem name="Parte 2 · 0:22" status="pronta" pct={100} tone="lime" />
              <MBtn tone="lime">Baixar ZIP</MBtn>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'As partes saem sempre em WAV — qualidade máxima pra próxima etapa do fluxo.',
      'Partes com durações diferentes entre si é o comportamento certo: o corte segue as pausas reais da fala.',
    ],
  },

  '/tools/acelerador': {
    title: 'Mixer de Velocidade',
    tagline: 'Acelera ou desacelera vídeo e áudio em lote, sem a voz ficar robótica.',
    steps: [
      {
        title: 'Solte os arquivos',
        text: 'Até 20 vídeos ou áudios na mesma fila (MP3, WAV, MP4, WEBM ou MOV) — todos vão sair na velocidade que você definir no próximo passo.',
        visual: (
          <Shot label="Mixer · fila">
            <MDrop label="Selecione ou arraste arquivos" sub="MP3, WAV, MP4, WEBM ou MOV — até 20 por lote" />
          </Shot>
        ),
      },
      {
        title: 'Defina a velocidade',
        text: 'Arraste o controle entre 0.5x (metade) e 3.0x (o triplo), ou toque num atalho pronto: 0.75x, 0.85x, 1.00x, 1.25x, 1.50x ou 2.00x. O tom da voz é corrigido automaticamente — em 1.5x a fala fica mais rápida mas continua soando humana, sem efeito "esquilo". Pra dar ritmo num anúncio sem chamar atenção, 1.25x é o atalho que costuma passar despercebido. Repare: em 1.00x o botão de processar fica desativado — não há o que mudar.',
        visual: (
          <Shot label="Mixer · velocidade">
            <MStack>
              <MSlider label="Acelerando" pct={40} val="1.50x" />
              <MRow>
                <MChip tone="dim">0.75x</MChip>
                <MChip tone="dim">0.85x</MChip>
                <MChip tone="dim">1.00x</MChip>
                <MChip tone="violet">1.25x</MChip>
                <MChip tone="dim">1.50x</MChip>
                <MChip tone="dim">2.00x</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha o formato de saída',
        text: 'No card "Formato de saída": "MP4" (vídeo), "MP3" ou "WAV" (áudio). Se a fila só tiver arquivos de áudio, o MP4 desativa sozinho — é o esperado. E se a fila for de vídeos mas você escolher saída de áudio, a imagem é descartada e sai só o som acelerado (a tela avisa).',
      },
      {
        title: 'Processe e baixe',
        text: 'O botão principal acompanha o ajuste: "Acelerar N" acima de 1x, "Desacelerar N" abaixo. Cada item mostra a porcentagem ao vivo e, pronto, libera o próprio "Baixar" — o arquivo sai com a velocidade no nome (ex.: "_1.5x"). No fim, "Baixar ZIP (N)" pega tudo de uma vez.',
        visual: (
          <Shot label="Mixer · processar">
            <MStack>
              <MBtn tone="lime">Acelerar 3</MBtn>
              <MQueueItem name="ad-final_1.5x.mp4" status="OK" pct={100} tone="lime" />
            </MStack>
          </Shot>
        ),
      },
    ],
  },

  '/tools/fakepass': {
    title: 'FakePrint',
    tagline: 'Prints e stickers de redes sociais, telejornais e sites de notícia — fiéis aos originais.',
    steps: [
      {
        title: 'Escolha o modelo',
        text: 'Os modelos ficam em dois grupos. "Redes sociais": Stickers de Story (Caixinha de Pergunta, Enquete, Quiz, Slider de Emoji, Contagem Regressiva, Localização, Menção), Conversas (Instagram DM e WhatsApp), Posts (Post do Instagram, Tweet / X, Comentários), Notificações (tela de bloqueio iPhone/Android) e Lives (Live do TikTok e Live do Instagram, com comentários e reações animadas). "Notícias & TV": Telejornais por emissora (CNN, BBC, Fox News, GloboNews, CNN Brasil, Record News e outras) e Sites de notícia (G1, Folha, UOL, BBC, Reuters e mais). Clique no card do modelo pra abrir os controles dele.',
        visual: (
          <Shot label="FakePrint · categorias">
            <MRow>
              <MChip tone="violet">STICKERS DE STORY</MChip>
              <MChip tone="dim">CONVERSAS</MChip>
              <MChip tone="dim">POSTS</MChip>
              <MChip tone="dim">NOTIFICAÇÕES</MChip>
              <MChip tone="dim">LIVES</MChip>
              <MChip tone="dim">TELEJORNAIS</MChip>
              <MChip tone="dim">SITES DE NOTÍCIA</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Preencha os campos do modelo',
        text: 'Cada modelo mostra só os campos que ele usa — nomes, textos, fotos, curtidas, horários — e a "Prévia" do lado direito atualiza a cada tecla: o que você vê é exatamente o que sai no PNG. Nas Conversas, cada linha do campo vira uma mensagem; comece a linha com ">" pra mensagem ser sua (lado direito) e escreva "audio 0:07" pra virar um balão de áudio. Nos Comentários, o formato é "usuário: texto", com ✓ no fim do nome pra selo de verificado.',
        visual: (
          <Shot label="FakePrint · conversa">
            <MStack>
              <MField label="Nome" value="Dra. Helena" />
              <MField label="Conversa" value="> essa linha é a sua mensagem" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Ajuste a barra de status do celular',
        text: 'Nos modelos que simulam a tela do celular, o bloco "Barra de status do celular" é o detalhe que separa um print convincente de um print óbvio: escolha iPhone ou Android, acerte a "Hora" pra bater com a história do criativo, e ajuste "Operadora", "Sinal", rede (5G/4G/LTE), "Wi-Fi", "Bateria" e até o indicador de "Carregando". Uma bateria em 63% às 21:47 conta uma história; 100% às 9:00 conta outra.',
        visual: (
          <Shot label="FakePrint · barra de status">
            <MRow>
              <MChip tone="violet">IPHONE</MChip>
              <MField label="Hora" value="21:47" />
              <MField label="Operadora" value="Vivo" />
              <MField label="Bateria" value="63%" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Telejornal ou site? Monte a cena',
        text: 'Os modelos de TV têm "Formato" (16:9 pra TV ou 9:16 pra Reels — os dois exportam em alta), "Layout da cena" (1, 2 ou 3 quadros, ou Repórter) e o "Fundo": a opção "Tela verde" gera o cenário em chroma key, pronto pra você encaixar qualquer imagem ou vídeo por trás dos gráficos no editor. Manchete, tag do assunto, hora, local e ticker são todos editáveis. E além do PNG, os telejornais também têm "Exportar vídeo (.webm)": o gráfico sai VIVO — relógio rodando, ticker deslizando e a bolinha do "ao vivo" pulsando (3 a 15 segundos) — pronto pra sobrepor no editor. Nos sites de notícia funciona igual: manchete, linha de apoio, autor e primeiro parágrafo, com a imagem principal também podendo sair em tela verde.',
        visual: (
          <Shot label="FakePrint · telejornal">
            <MRow>
              <MChip tone="dim">16:9 (TV)</MChip>
              <MChip tone="violet">9:16 (REELS)</MChip>
              <MChip tone="lime">TELA VERDE</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Live? Dá pra exportar em vídeo',
        text: 'Nas Lives (TikTok e Instagram) a prévia é animada: as reações sobem e os comentários rolam sozinhos. Preencha as visualizações, os comentários (um por linha, "usuário: mensagem"), a foto de perfil e a cor do selo. Além do PNG, o botão "Exportar vídeo (.webm)" grava a animação (escolha de 3 a 15 segundos) — e com o "Fundo verde (chroma key)" ligado é só sobrepor no editor e remover o verde: a live anima por cima do seu criativo.',
        visual: (
          <Shot label="FakePrint · live">
            <MRow>
              <MChip tone="violet">LIVE DO TIKTOK</MChip>
              <MChip tone="dim">LIVE DO INSTAGRAM</MChip>
              <MChip tone="lime">EXPORTAR VÍDEO (.WEBM)</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Baixe o PNG em alta',
        text: 'Confira a prévia uma última vez e clique em "Baixar PNG". A imagem sai em alta resolução — 1080px na maioria dos modelos, mais nos formatos largos (Tweet, sites e telejornais 16:9) — nítida o bastante pra ser ampliada dentro de um vídeo sem serrilhar.',
        visual: (
          <Shot label="FakePrint · export">
            <MRow>
              <MBtn tone="lime">Baixar PNG</MBtn>
              <MChip tone="dim">ALTA RESOLUÇÃO · PRONTA PRA POSTAR</MChip>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Os emojis saem no estilo do aparelho escolhido: Apple no iPhone, Google no Android — igual ao print real.',
      'No modelo Bem Estar (entrevista) dá pra escolher 1 ou 2 pessoas no quadro.',
    ],
  },

  '/tools/caixinha-pergunta': {
    title: 'Caixinha de Pergunta',
    tagline: 'A caixinha de perguntas do Instagram em PNG, idêntica à nativa.',
    steps: [
      {
        title: 'Escreva os textos',
        text: 'No card "Textos", preencha a "Pergunta do topo" (o título do sticker, até 80 caracteres) e "A pergunta / mensagem" (o corpo, até 280 — com contador). O tamanho da fonte se ajusta sozinho pra caber, exatamente como o Instagram faz: texto longo encolhe, texto curto cresce.',
        visual: (
          <Shot label="Caixinha · textos">
            <MStack>
              <MField label="Pergunta do topo" value="Faça uma pergunta" />
              <MField label="A pergunta / mensagem" value="Drop ainda vai valer a pena com essas taxas?" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha a cor de fundo',
        text: 'O card "Fundo" traz a paleta pronta — Azul, Instagram, Pôr do sol, Roxo, Verde, Preto e Grafite — e o seletor de "Cor personalizada" pra casar com a arte do seu story. O sticker em si mantém o branco nativo do Instagram; só o palco ao redor muda.',
      },
      {
        title: 'Escolha o formato',
        text: 'No card "Formato": "Story 9:16" (o mais comum), "Quadrado 1:1" ou "Feed 4:5". A prévia ao lado mostra a proporção final exata.',
        visual: (
          <Shot label="Caixinha · formato">
            <MRow>
              <MChip tone="violet">STORY 9:16</MChip>
              <MChip tone="dim">QUADRADO 1:1</MChip>
              <MChip tone="dim">FEED 4:5</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Baixe o PNG',
        text: 'Clique em "Baixar PNG": a imagem sai em 1080px, com a fonte, o raio de borda e as sombras batendo com o sticker original. É sobrepor no criativo e pronto.',
        visual: (
          <Shot label="Caixinha · export">
            <MRow>
              <MBtn tone="lime">Baixar PNG</MBtn>
              <MChip tone="dim">1080PX · PRONTA PRO STORY</MChip>
            </MRow>
          </Shot>
        ),
      },
    ],
  },

  '/tools/calculadora': {
    title: 'Calculadora',
    tagline: 'Fecha o orçamento de edição por duração de AD e gera a proposta em PDF — com PIX e QR Code.',
    steps: [
      {
        title: 'Defina o valor por minuto',
        text: 'No card "Tabela de preço", informe o "Valor por minuto (R$)" — digitando ou tocando num dos presets (R$50 a R$300). Esse é o valor padrão: vale pra todo AD que você não precificar individualmente no passo seguinte.',
        visual: (
          <Shot label="Calculadora · preço">
            <MRow>
              <MField label="Valor por minuto (R$)" value="100,00" />
              <MChip tone="dim">R$50</MChip>
              <MChip tone="violet">R$100</MChip>
              <MChip tone="dim">R$200</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Adicione os ADs',
        text: 'Uma linha por AD. Você só digita os números da duração e ela vira tempo sozinha, sempre no formato 00:00 — sem precisar de dois-pontos, vírgula ou ponto (digitou 619, virou 06:19; digitou 45, virou 00:45). Cada linha também tem um campo "R$" próprio: preencha pra dar um valor por minuto diferente só àquele AD (a borda fica violeta) — vazio, ele usa a tabela. Use "Adicionar AD" pra incluir linhas e o "×" pra remover. O valor de cada AD e a "Duração total" recalculam a cada tecla.',
        visual: (
          <Shot label="Calculadora · ADs">
            <MRow>
              <MField label="AD1" value="01:30" />
              <MField label="AD2" value="00:45" />
              <MField label="AD3" value="02:10" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Aplique desconto e PIX',
        text: 'O controle "Desconto" vai de 0 a 50% e aparece discriminado no orçamento — bom pra cliente recorrente ou pacote fechado. Ligando "Incluir PIX no relatório", você informa a "Chave PIX" e pode salvá-la pra reutilizar (vira um chip em "Chaves salvas"). O PDF sai com QR Code de PIX já com o valor total preenchido — o cliente escaneia e paga. A chave fica só no seu navegador.',
        visual: (
          <Shot label="Calculadora · PIX">
            <MStack>
              <MSlider label="Desconto" pct={20} val="10%" />
              <MToggle on label="Incluir PIX no relatório" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Revise e gere o PDF',
        text: 'O card "Orçamento" mostra Subtotal, Desconto e Total. Preencha "Cliente / Projeto (opcional)" pra personalizar e clique em "Baixar Relatório (PDF)": sai uma proposta profissional com a tabela de ADs (com o R$/min de cada um, quando os preços variam), duração total e o bloco de pagamento PIX — pronta pra mandar no WhatsApp do cliente.',
        visual: (
          <Shot label="Calculadora · orçamento">
            <MRow>
              <MChip tone="lime">TOTAL · R$ 418,33</MChip>
              <MBtn tone="primary">Baixar Relatório (PDF)</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
  },

  /* ── Com a IA ─────────────────────────────────────────────────────── */

  '/tools/copy-srt': {
    title: 'Gerador de SRT',
    tagline: 'Sua copy vira legenda com os tempos extraídos do áudio — palavra por palavra.',
    steps: [
      {
        title: 'Envie o áudio ou vídeo',
        text: 'Solte o arquivo na área de upload — MP3, WAV, MP4, MOV ou WEBM, até 800 MB e 60 minutos. Assim que entra, a página mostra o "Tamanho" e a "Duração" detectados. Vídeo funciona igual áudio: a trilha sonora é extraída sozinha.',
        visual: (
          <Shot label="Gerador de SRT · arquivo">
            <MDrop label="Arraste ou clique pra subir" sub="MP3, WAV, MP4, MOV, WEBM — até 800MB e 60min" />
          </Shot>
        ),
      },
      {
        title: 'Cole o texto da copy',
        text: 'O campo "Texto da copy" é o conteúdo exato que vai virar o SRT — a ferramenta não reescreve nada: o texto das legendas é o seu, e só os TEMPOS vêm do áudio. Por isso, cole a copy como ela foi narrada de verdade. O contador de caracteres ajuda a conferir se veio tudo.',
        visual: (
          <Shot label="Gerador de SRT · copy">
            <MField value="Cole aqui o texto da copy. O SRT sai com este texto exato + os tempos do áudio." />
          </Shot>
        ),
      },
      {
        title: 'Gere e confira o resultado',
        text: 'Clique em "Gerar SRT" e acompanhe as fases ("Extraindo audio..." → "Transcrevendo e alinhando a copy..."). A ferramenta escuta o áudio, casa cada palavra da copy com o momento exato em que foi dita e monta os blocos de legenda nesse ritmo real. O card "SRT gerado" mostra o número de legendas e o conteúdo completo pra você revisar na tela antes de baixar com "Baixar .SRT".',
        visual: (
          <Shot label="Gerador de SRT · resultado">
            <MRow>
              <MBtn tone="primary">Gerar SRT</MBtn>
              <MChip tone="lime">LEGENDAS · 42</MChip>
              <MBtn tone="lime">Baixar .SRT</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Importe no CapCut do jeito certo',
        text: 'No CapCut Desktop ou Web, vá em "Texto → Legendas → Importar arquivo" e escolha o .srt. Importando por esse caminho, os modelos, estilos e animações de legenda do CapCut funcionam em cima do seu SRT — inclusive o "Aplicar a todas". Não arraste o .srt direto pra timeline nem importe como mídia: aí ele vira texto avulso e perde os recursos de legenda. No celular o CapCut não importa legenda; use o Desktop ou o Web.',
        visual: (
          <Shot label="CapCut · caminho">
            <MRow>
              <MChip tone="dim">TEXTO</MChip>
              <MChip tone="dim">LEGENDAS</MChip>
              <MChip tone="violet">IMPORTAR ARQUIVO</MChip>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'A ferramenta usa a chave de Transcrição — se faltar, o banner "Chave pendente" aponta o caminho ("Configurar →").',
      'Áudio muito longo pode passar do limite do servidor — se acontecer, divida em partes menores e gere um SRT por parte.',
    ],
  },

  '/tools/tipografia': {
    title: 'Tipografia Automática',
    tagline: 'A fala do vídeo vira lettering animado profissional, no tempo exato do áudio — e sai queimado no MP4.',
    steps: [
      {
        title: 'Envie o vídeo',
        text: 'Solte o arquivo na área de upload — MP4, MOV ou WEBM, até 800 MB e 20 minutos. A página mostra o tamanho e a duração detectados. O vídeo não sai do seu navegador: só o áudio comprimido sobe pra transcrição.',
        visual: (
          <Shot label="Tipografia · vídeo">
            <MDrop label="Arraste ou clique pra subir" sub="MP4, MOV, WEBM — até 800MB e 20min" />
          </Shot>
        ),
      },
      {
        title: 'Gere as legendas automáticas',
        text: 'Escolha o idioma da fala (ou "Detectar") e clique em "Gerar legendas". A ferramenta transcreve palavra por palavra e monta os blocos no ritmo da fala — como a legenda automática do CapCut, só que já com timing word-level pros letterings baterem certinho.',
        visual: (
          <Shot label="Tipografia · transcrição">
            <MRow>
              <MChip tone="violet">PORTUGUÊS</MChip>
              <MBtn tone="primary">Gerar legendas</MBtn>
              <MChip tone="lime">PALAVRAS · 214</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Escolha o modelo e edite',
        text: 'A galeria tem dezenas de letterings animados (karaokê, glitch, neon, bounce, máquina de escrever...) com preview ao vivo — o que você vê no player é EXATAMENTE o que sai no MP4. Ajuste tamanho, altura na tela, cores e ritmo dos blocos. Na lista de blocos dá pra corrigir texto, dividir, juntar, ajustar o tempo e clicar numa palavra pra pintá-la na cor de destaque.',
        visual: (
          <Shot label="Tipografia · editor">
            <MRow>
              <MChip tone="violet">KARAOKÊ</MChip>
              <MChip tone="dim">GLITCH</MChip>
              <MChip tone="dim">NEON</MChip>
              <MChip tone="dim">BOUNCE</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Renderize — o download vem sozinho',
        text: 'Clique em "Renderizar vídeo". O render roda no SEU navegador, acelerado por hardware (o áudio original volta no final) — bem mais rápido que o vídeo em tempo real. Deixe a aba aberta até o fim: quando terminar, o MP4 baixa automaticamente. Se o navegador segurar o download, o card do resultado tem o "Baixar de novo".',
        visual: (
          <Shot label="Tipografia · render">
            <MRow>
              <MBtn tone="primary">Renderizar vídeo</MBtn>
              <MBtn tone="lime">Baixar de novo</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'A transcrição usa a chave Groq (Whisper) de /configuracoes/api — se faltar, o banner "Chave pendente" aponta o caminho.',
      'O render local precisa de Chrome ou Edge atualizados no computador (WebCodecs). Não feche a aba durante o render.',
      'F5 no meio da edição não perde nada: selecionando o MESMO arquivo de novo, a edição anterior é restaurada.',
      'Trocar o "Ritmo dos blocos" remonta tudo a partir da transcrição — faça isso ANTES de corrigir textos na lista.',
    ],
  },

  '/tools/decupagem-copy': {
    title: 'Decupagem Inteligente',
    tagline: 'A IA lê a sua copy, escolhe o melhor take de cada frase no vídeo bruto e audita o resultado.',
    steps: [
      {
        title: 'Envie o vídeo bruto',
        text: 'A gravação inteira, sem cortar nada antes — erros, repetições e retakes fazem parte do jogo: é desse material que a IA garimpa as melhores tomadas. Limites: 800 MB e 40 minutos (MP4, MOV, WEBM ou MKV). Passou do peso? Comprima primeiro na ferramenta Compressor.',
        visual: (
          <Shot label="Decupagem Inteligente · vídeo">
            <MDrop label="Selecione ou arraste um arquivo" sub="MP4, MOV, WEBM, MKV — até 800MB e 40min" />
          </Shot>
        ),
      },
      {
        title: 'Cole a copy frase por frase',
        text: 'No card "Copy / Script", cole o texto na ordem desejada, quebrando por linha ou pontuação — o rodapé mostra quantas frases foram detectadas. Cada frase é o que a IA procura no vídeo: se o locutor gravou a mesma frase três vezes, ela transcreve tudo, compara as tomadas e escolhe a mais limpa. Escreva as frases como foram realmente ditas.',
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
        text: 'A opção "Remover silêncios entre as falas" vem LIGADA: depois de montar as frases na ordem da copy, toda pausa de 0,10s ou mais é cortada — calibrado pra tirar o tempo morto sem comer palavra. Desligue se quiser preservar as pausas originais entre as frases escolhidas.',
        visual: (
          <Shot label="Decupagem Inteligente · silêncios">
            <MToggle on label="Remover silêncios entre as falas" />
          </Shot>
        ),
      },
      {
        title: 'Decupe e acompanhe as fases',
        text: 'Clique em "Decupar pela Copy". As etapas rodam em sequência e aparecem na tela: "Regulando a voz..." → "Extraindo audio..." → "Transcrevendo o áudio..." → alinhamento das frases → corte e concatenação → "Auditando o resultado (conferindo contra a copy)...". Se a auditoria achar corte ruim, ela se auto-corrige e re-audita sozinha — você não precisa fazer nada.',
      },
      {
        title: 'Leia o laudo e baixe o MP4',
        text: 'O resultado aparece como "Decupagem pronta · N cortes na ordem da copy", com player, o chip de auditoria ("auditado ✓ 12/12" é o cenário ideal) e a confiança da transcrição. Quer prova extra? "Transcrever (AssemblyAI)" re-transcreve o vídeo final pra você comparar com a copy. A lista "Cortes detectados" mostra frase por frase com o score de cada match — os itens marcados "revisar" merecem uma ouvida antes de usar. Tudo certo, clique em "Baixar MP4".',
        visual: (
          <Shot label="Decupagem Inteligente · laudo">
            <MStack>
              <MQueueItem name="Decupagem pronta · 12 cortes" status="auditado ✓ 12/12" pct={100} tone="lime" />
              <MRow>
                <MBtn tone="lime">Baixar MP4</MBtn>
                <MBtn tone="ghost">Transcrever (AssemblyAI)</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'O volume da voz é regulado automaticamente antes de tudo — a análise não se perde com locutor baixo.',
      'Copy muito curta não dá material pro alinhamento: cole pelo menos algumas frases completas.',
    ],
  },

  '/tools/lipsync': {
    title: 'Lipsync Video to Video',
    tagline: 'Sobe o vídeo do rosto, sobe o áudio novo — a boca passa a falar o que você mandou.',
    steps: [
      {
        title: 'Suba o vídeo do rosto',
        text: 'Na coluna "VÍDEOS" à esquerda, clique em "Subir vídeo" (até 300 MB por arquivo). Pode subir vários e escolher qual usar — o selecionado aparece no preview central, sempre marcado como FONTE. Escolha um take com o rosto inteiro e estável, de frente ou levemente de lado, sem mãos passando na boca. A tela avisa sozinha: vídeo com menos de 2 segundos de rosto é bloqueado, e resolução baixa gera um alerta (os dentes podem sair menos nítidos).',
        visual: (
          <Shot label="Lipsync · entrada">
            <MRow>
              <div className="flex-1">
                <MDrop label="Subir vídeo" sub="arraste ou clique · até 300MB" />
              </div>
              <div className="flex-1">
                <MDrop label="Subir áudio ou vídeo" sub="mp3, wav, m4a ou mp4 (extrai áudio)" />
              </div>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Suba o áudio novo',
        text: 'No painel "Configure e gera", o campo "Áudio" recebe a fala que o rosto vai passar a dizer — MP3, WAV, M4A ou até um MP4 (a ferramenta extrai o áudio sozinha). Limite: 10 minutos. O botão "Limpar áudio" vem LIGADO e tira ruído e sujeira antes do lipsync — desligue só se o seu áudio já for tratado. Voz limpa, sem música por cima, rende a sincronia mais precisa.',
        visual: (
          <Shot label="Lipsync · configuração">
            <MStack>
              <MToggle on label="Limpar áudio" />
              <MBtn tone="primary">▶ Gerar</MBtn>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Gere e acompanhe em "Meus LipSyncs"',
        text: 'Clique em "Gerar". O disparo vira um card na seção "MEUS LIPSYNCS" ("LipSync 01", "LipSync 02"...), passando por "Na fila…" e "Renderizando…" com a porcentagem ao vivo. O formulário fica livre na hora — pode disparar vários em sequência e até navegar pra outras ferramentas: os cards continuam atualizando. Renderização de lipsync leva alguns minutos; é normal.',
        visual: (
          <Shot label="Lipsync · fila">
            <MStack>
              <MQueueItem name="LipSync 01" status="Renderizando…" pct={58} />
              <MQueueItem name="LipSync 02" status="Na fila…" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe o MP4 e confira',
        text: 'No card pronto, o botão de download baixa o vídeo final como MP4 (dá pra expandir pra tela cheia antes, pelo ícone do card, e baixar por lá com "Baixar MP4"). Confira os primeiros segundos e um trecho do meio: se a boca escorregar em algum ponto, geralmente é movimento brusco no vídeo original — vale trocar o take de entrada. Deu falha? "↻ Tentar de novo" re-roda com os mesmos arquivos.',
        visual: (
          <Shot label="Lipsync · entrega">
            <MStack>
              <MQueueItem name="LipSync 01" status="pronto" pct={100} tone="lime" />
              <MBtn tone="lime">Baixar MP4</MBtn>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'Rosto frontal e centralizado, sem mão na boca — é a regra número 1.',
      'Iluminação uniforme ajuda mais que resolução alta (luz lateral cria sombra que engana a sincronia).',
      '720p ou mais deixa a boca nítida; mesma pessoa e mesma língua do áudio dão o resultado mais natural.',
      'O preview central mostra sempre a FONTE — o resultado aparece nos cards de "Meus LipSyncs", embaixo.',
    ],
  },

  '/tools/ltx-video': {
    title: 'Vídeo do zero',
    tagline: 'Descreve a cena e recebe um vídeo com áudio sincronizado — ou anima uma imagem sua.',
    steps: [
      {
        title: 'Descreva a cena no Prompt',
        text: 'Escreva o que acontece: sujeito, ação, ambiente e clima. Prompts em inglês rendem melhor no modelo. Seja específico com o movimento de câmera ("slow dolly forward", "soft rain, film grain") — é o que separa um clipe vivo de uma foto que respira.',
        visual: (
          <Shot label="Vídeo do zero · prompt">
            <MField value="A close-up of a young woman in a Tokyo neon alley at night, cinematic, slow dolly forward..." />
          </Shot>
        ),
      },
      {
        title: 'Opcional: comece de uma imagem',
        text: 'O campo "Imagem inicial (opcional — anima a foto)" aceita PNG, JPG ou WEBP. Com imagem anexada, ela vira o primeiro frame do vídeo e o prompt muda de papel: descreva o MOVIMENTO que a cena deve ganhar ("slow zoom in, soft wind moving the hair"). É o caminho certo quando você precisa de continuidade com um material que já existe.',
      },
      {
        title: 'Escolha duração e resolução',
        text: 'Duração: "4s", "6s" ou "10s" saem numa geração só (1 chunk); "12s (2 chunks)" é gerado em dois blocos emendados automaticamente — confira a transição no resultado. Resolução: 16:9, 9:16 vertical ou 1:1, cada uma em versão rápida ou HD (ex.: "768×512 (16:9 rápido)", "1024×1536 (9:16 vertical HD)"). Os padrões são 6s e 768×512.',
        visual: (
          <Shot label="Vídeo do zero · ajustes">
            <MRow>
              <MField label="Duração" value="6s (1 chunk)" grow />
              <MField label="Resolução" value="768×512 (16:9 rápido)" grow />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Gere e acompanhe a fila de GPU',
        text: 'Clique em "Gerar vídeo". O botão mostra a fase em tempo real: "Conectando ao servidor de geração...", depois "gerando na H200 (pode levar ~1-2 min)" — e "Chunk 1/2", "Chunk 2/2" nos vídeos de 12s. A barra do topo mostra a cota do dia ("≈ N gerações restantes hoje"): a GPU é compartilhada, então em horário cheio o job espera a vez sem travar.',
        visual: (
          <Shot label="Vídeo do zero · gerando">
            <MStack>
              <MChip tone="dim">≈ 12 GERAÇÕES RESTANTES HOJE</MChip>
              <MBtn tone="primary">Gerar vídeo</MBtn>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe e reaproveite o que funcionou',
        text: 'O "Resultado" aparece com player e botão "Baixar MP4". A galeria "Últimas gerações" guarda os 8 vídeos mais recentes com o prompt salvo junto — reaproveite os prompts que funcionaram em vez de começar do zero.',
        visual: (
          <Shot label="Vídeo do zero · entrega">
            <MRow>
              <MBtn tone="lime">Baixar MP4</MBtn>
              <MChip tone="dim">ÚLTIMAS GERAÇÕES · 8</MChip>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Num vídeo de 12s, se o segundo bloco falhar a ferramenta NÃO entrega o vídeo parcial — ela avisa e você gera de novo.',
      'A cota de GPU renova por dia — o contador no topo mostra quanto ainda dá pra gerar hoje.',
    ],
  },

  '/tools/separador-audio': {
    title: 'Separador de Áudio',
    tagline: 'Separa voz, trilha sonora e SFX em três faixas independentes — qualidade Demucs v4.',
    steps: [
      {
        title: 'Envie o arquivo',
        text: 'Áudio ou vídeo — MP3, WAV, M4A, OGG ou MP4, até 200 MB ou 25 minutos. O upload vai direto pro processamento em nuvem. De vídeo, só a trilha de áudio é usada.',
        visual: (
          <Shot label="Separador · arquivo">
            <MDrop label="Arraste ou clique pra subir" sub="MP3, WAV, M4A, OGG, MP4 — até 200MB" />
          </Shot>
        ),
      },
      {
        title: 'Separe as três faixas de uma vez',
        text: 'Clique em "Separar voz, trilha sonora e SFX" e acompanhe: "Enviando o áudio…" → "IA separando as trilhas (pode levar 1-3 min)…" → "Montando voz, trilha sonora e SFX…". A separação sempre gera as três faixas juntas — você escolhe depois qual usar.',
        visual: (
          <Shot label="Separador · ação">
            <MBtn tone="primary">Separar voz, trilha sonora e SFX</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Ouça e baixe as faixas',
        text: 'O resultado são três cards com player próprio: "Voz" (só a voz isolada, sem música nem efeitos), "Trilha sonora" (a música completa sem a voz) e "SFX / Ambiência" (efeitos e foley). Ouça pra conferir a separação e baixe só a que precisa com o "↓ Baixar" de cada card — ou clique em "Baixar todas" pra receber as três em sequência.',
        visual: (
          <Shot label="Separador · faixas">
            <MStack>
              <MQueueItem name="Voz" status="pronta" pct={100} tone="lime" />
              <MQueueItem name="Trilha sonora" status="pronta" pct={100} tone="lime" />
              <MQueueItem name="SFX / Ambiência" status="pronta" pct={100} tone="lime" />
              <MBtn tone="lime">Baixar todas</MBtn>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'Deu erro no meio? O botão "↻ Tentar de novo" re-roda sem precisar subir o arquivo outra vez.',
    ],
  },

  '/tools/voice-test': {
    title: 'Isolar voz',
    tagline: 'Tira a música e deixa só a voz — ideal pra preparar áudio de referência pra avatar e lipsync.',
    steps: [
      {
        title: 'Envie o áudio',
        text: 'MP3, WAV, M4A, OGG ou MP4 — o caso típico é um criativo pronto de onde você precisa recuperar só a fala.',
      },
      {
        title: 'Escolha o modo de isolação',
        text: 'Comece sempre por "Auto (detecta stereo/mono)" — ele resolve a grande maioria dos casos. Os outros são pra áudios difíceis: "Center Channel Extraction (stereo wide)" quando a voz está centralizada no estéreo, "Bandpass + Compand (mono ou stereo fake)" quando a música invade as frequências da fala, e "Aggressive (audio sujo com denoise pesado)" quando sobrou muito vazamento — ao custo de alguma naturalidade.',
        visual: (
          <Shot label="Isolar voz · modo">
            <MRow>
              <MChip tone="violet">AUTO</MChip>
              <MChip tone="dim">CENTER CHANNEL</MChip>
              <MChip tone="dim">BANDPASS + COMPAND</MChip>
              <MChip tone="dim">AGGRESSIVE</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Compare antes e depois, e baixe',
        text: 'Clique em "Isolar voz" e use os dois players — "Antes (original)" e "Depois (vocals isolated)" — pra avaliar: a voz deve estar clara no Depois, com a música muito mais baixa ou inaudível. Ficou bom? "⬇ Baixar vocals.wav". Ainda ouve música forte? Troque pro modo Aggressive e rode de novo.',
        visual: (
          <Shot label="Isolar voz · resultado">
            <MStack>
              <MRow>
                <MChip tone="dim">ANTES (ORIGINAL)</MChip>
                <MChip tone="lime">DEPOIS (VOCALS)</MChip>
              </MRow>
              <MBtn tone="lime">⬇ Baixar vocals.wav</MBtn>
            </MStack>
          </Shot>
        ),
      },
    ],
  },

  '/tools/normalizador': {
    title: 'Normalizador',
    tagline: 'Duas ou mais vozes em volumes diferentes saem no mesmo nível — e o chiado de fundo vai embora.',
    steps: [
      {
        title: 'Solte os arquivos',
        text: 'Até 10 por lote — MP3, WAV, MP4, WEBM ou MOV. O caso clássico: dois locutores gravaram em volumes diferentes e precisam sair no mesmo patamar pra edição não denunciar.',
        visual: (
          <Shot label="Normalizador · arquivos">
            <MDrop label="Selecione ou arraste arquivos" sub="MP3, WAV, MP4, WEBM ou MOV — até 10 por lote" />
          </Shot>
        ),
      },
      {
        title: 'Escolha o formato de saída',
        text: 'No card "Formato de saída": "MP4" mantém o vídeo e normaliza só a trilha de áudio; "MP3" e "WAV" entregam só o som (se a entrada for vídeo, a imagem é descartada — a tela avisa). Se houver áudio puro no lote, o MP4 desativa sozinho.',
        visual: (
          <Shot label="Normalizador · formato">
            <MRow>
              <MChip tone="violet">MP4</MChip>
              <MChip tone="dim">MP3</MChip>
              <MChip tone="dim">WAV</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Normalize e baixe',
        text: 'Clique em "Normalizar N". Cada arquivo passa por duas fases (limpeza de ruído + análise, depois normalização) e o banner mostra qual item está rodando. No fim, todas as vozes saem no mesmo nível, sem estouro nos picos e com o chiado atenuado. Baixe por arquivo ("Baixar MP4/MP3/WAV" — sai nomeado "_normalizado") ou tudo com "Baixar ZIP (N)".',
        visual: (
          <Shot label="Normalizador · fila">
            <MStack>
              <MQueueItem name="locutor-a_normalizado.mp3" status="OK" pct={100} tone="lime" />
              <MQueueItem name="locutor-b.mp3" status="44%" pct={44} />
              <MBtn tone="lime">Baixar ZIP (2)</MBtn>
            </MStack>
          </Shot>
        ),
      },
    ],
  },

  '/tools/points': {
    title: 'Seus pontos',
    tagline: 'Cada entrega concluída no ClickUp vira ponto — e cada meta do mês vira medalha.',
    steps: [
      {
        title: 'Conecte o ClickUp',
        text: 'A página usa o mesmo token do ClickUp Pilot — se você já conectou lá, esta tela entra sozinha. Se aparecer o aviso pedindo o token, configure primeiro no Pilot e volte.',
      },
      {
        title: 'Acompanhe o mês atual',
        text: 'O visor grande mostra seus PONTOS do mês — somados pelo peso de cada task concluída (subtasks contam também). Logo abaixo, a barra "Próxima meta" diz exatamente quantos pontos faltam pra próxima medalha. O botão "⟳ Atualizar" busca a contagem mais recente no ClickUp. Importante: a contagem é MENSAL — os pontos zeram na virada do mês e a corrida recomeça.',
        visual: (
          <Shot label="Pontos · visor">
            <MStack>
              <MQueueItem name="Próxima meta: CHAMPION · 120 pts" status="18 pts faltam" pct={85} tone="violet" />
              <MBtn tone="ghost">⟳ Atualizar</MBtn>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Conheça as medalhas',
        text: 'São quatro metas mensais: ROOKIE (60 pts), ELITE (90 pts), CHAMPION (120 pts) e LEGEND (150 pts) — cada card mostra a meta e a recompensa correspondente. Bateu a meta, a medalha acende no mês.',
        visual: (
          <Shot label="Pontos · medalhas">
            <MRow>
              <MChip tone="lime">ROOKIE · 60</MChip>
              <MChip tone="lime">ELITE · 90</MChip>
              <MChip tone="violet">CHAMPION · 120</MChip>
              <MChip tone="dim">LEGEND · 150</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'A conta não bateu? Ajuste o recorte',
        text: 'Se a pontuação daqui não bater com a do seu ClickUp, abra o painel de ajuste (botão "▶ debug"): nele você escolhe o recorte de pastas que conta ponto e quais status fecham uma entrega (closed, done ou os dois). A escolha fica travada pros próximos meses — configure uma vez e esqueça.',
      },
    ],
  },

  '/tools/lipsync-history': {
    title: 'Histórico de avatares',
    tagline: 'Todos os seus disparos de avatar num lugar só — com os arquivos guardados pra rebaixar quando quiser.',
    steps: [
      {
        title: 'Encontre o disparo',
        text: 'O topo mostra os totais (Total, Concluidos, Rodando, Falhas, Videos gerados) e os filtros: busca por nome ou AD, período (7 a 180 dias), tipo ("Batch (ClickUp Pilot)" ou "VA (Variacao Avatar)") e status. Cada lote aparece com data, duração e quantos vídeos gerou.',
        visual: (
          <Shot label="Histórico · filtros">
            <MRow>
              <MField value="Buscar por nome / AD ID..." grow />
              <MChip tone="dim">ULTIMOS 30 DIAS</MChip>
              <MChip tone="lime">CONCLUIDO</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Baixe de novo o que precisar',
        text: 'Nos lotes concluídos, os downloads ficam no próprio card. O principal é o "↓ montado/decupado": o vídeo final JÁ MONTADO (hook + body emendados e decupados) — é o MP4 que você entrega. O "↓ takes" traz as partes brutas separadas (útil só se você for editar por conta própria), e o "↓ camuflado" aparece quando a camuflagem foi usada no disparo. Lotes de variação de avatar têm o "↓ VA avatares". Se o navegador recarregou e o link se perdeu, o botão "(do disco)" recupera o arquivo do armazenamento local.',
        visual: (
          <Shot label="Histórico · downloads">
            <MStack>
              <MQueueItem name="AD140GL · 6 videos" status="Concluido" pct={100} tone="lime" />
              <MRow>
                <MBtn tone="lime">↓ montado/decupado</MBtn>
                <MBtn tone="ghost">↓ takes</MBtn>
                <MBtn tone="ghost">↓ camuflado</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Retome o que ficou pela metade',
        text: 'O botão "🔄 Retomar" continua um lote interrompido exatamente de onde parou — o que já renderizou não é gerado de novo, só o que falta. É o caminho certo depois de um limite diário do HeyGen ou de uma queda de conexão. O "▼ Detalhes" abre a lista parte por parte, mostrando o status de cada uma.',
        visual: (
          <Shot label="Histórico · retomar">
            <MRow>
              <MBtn tone="dark">🔄 Retomar</MBtn>
              <MBtn tone="ghost">▼ Detalhes</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Tudo fica salvo no seu navegador — sobrevive a F5 e a fechar a aba. Limpar os dados do site apaga o histórico.',
      'O HeyGen guarda os vídeos por cerca de 60 dias — dentro desse prazo, o Retomar consegue re-baixar e remontar qualquer pacote perdido.',
    ],
  },

  '/tools/background': {
    title: 'Tarefas em segundo plano',
    tagline: 'Tudo que está rodando agora — lipsyncs do Pilot e b-rolls do Magnific, ao vivo.',
    steps: [
      {
        title: 'Leia o panorama',
        text: 'Os contadores do topo mostram o momento da operação: "Em processo", "Na fila", "Concluidos" e "Falhas" — atualizando ao vivo, sem recarregar a página.',
        visual: (
          <Shot label="Segundo plano · panorama">
            <MRow>
              <MChip tone="violet">EM PROCESSO · 2</MChip>
              <MChip tone="dim">NA FILA · 4</MChip>
              <MChip tone="lime">CONCLUIDOS · 12</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Filtre por tipo de trabalho',
        text: 'O filtro "Mostrar" separa as filas: "🎙 Lipsync (HeyGen)" e "🍌 B-Rolls (Magnific)" — ou "Tudo" misturado. A fila do Magnific roda em série, um job por vez, de propósito.',
      },
      {
        title: 'Acompanhe cada task de perto',
        text: 'Cada card mostra a fase ("Na fila" → "Disparando" → "Renderizando" → "Baixando" → "Pos-prod (concat/decupagem/camo)" → "Concluido"), a porcentagem, e o raio-X das partes: quantas foram disparadas, renderizadas e quantas falharam. O "✕ Cancelar" para uma task; "Remover" tira do painel sem apagar arquivos já baixados.',
        visual: (
          <Shot label="Segundo plano · task">
            <MStack>
              <MQueueItem name="AD31 · Renderizando" status="partes 3/6" pct={52} />
              <MRow>
                <MBtn tone="dark">✕ Cancelar</MBtn>
                <MBtn tone="ghost">Remover</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe das tasks concluídas',
        text: 'Task "Concluido" libera os downloads no card: "↓ montado/decupado" (o vídeo final montado — o MP4 de entrega), "↓ takes" (partes brutas) e "↓ camuflado" (quando a camuflagem estava ligada). Nos jobs de B-roll, o "↓ takes" traz o pacote de vídeos gerados. Se aparecer "(perdido no reload)", o link expirou com o recarregamento — re-gere pelo ClickUp Pilot com o Retomar.',
        visual: (
          <Shot label="Segundo plano · entrega">
            <MRow>
              <MBtn tone="lime">↓ montado/decupado</MBtn>
              <MBtn tone="ghost">↓ takes</MBtn>
              <MBtn tone="ghost">↓ camuflado</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Esta tela é um observador — o motor roda na aba do ClickUp Pilot. Mantenha a aba do Pilot aberta até o fim.',
      'Você pode fechar ESTA tela sem medo: o trabalho continua e o estado sobrevive ao reload.',
    ],
  },

  '/tools/historico': {
    title: 'Histórico geral',
    tagline: 'Tudo que você produziu nos últimos 7 dias, em todas as ferramentas — agrupado por dia.',
    steps: [
      {
        title: 'Navegue pela linha do tempo',
        text: 'Cada coisa que você processa, exporta ou dispara em qualquer ferramenta vira um registro aqui — agrupado por dia ("Hoje", "Ontem"...), do mais novo pro mais antigo. Cada linha mostra o arquivo, a ferramenta, o detalhe e a etiqueta do tipo: PRONTO, EXPORT, DISPARO ou DOWNLOAD.',
        visual: (
          <Shot label="Histórico geral · timeline">
            <MStack>
              <MQueueItem name="criativo-final.mp4 · Compressor" status="PRONTO · 14:32" pct={100} tone="lime" />
              <MQueueItem name="AD140GL.mp4 · Decupagem" status="PRONTO · 11:05" pct={100} tone="violet" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Filtre e pesquise',
        text: 'Os chips filtram por ferramenta (só aparecem as que têm registro, com a contagem ao lado) e a busca encontra por nome de arquivo, ferramenta ou detalhe. Clicar no chip de novo desfaz o filtro.',
        visual: (
          <Shot label="Histórico geral · filtros">
            <MRow>
              <MChip tone="violet">TUDO · 24</MChip>
              <MChip tone="dim">DECUPAGEM · 6</MChip>
              <MChip tone="dim">COMPRESSOR · 4</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Limpe quando quiser',
        text: 'O botão "Limpar histórico" zera a linha do tempo — só os registros, sem tocar em nenhum arquivo que você baixou. Como tudo fica no seu navegador, nada disso sobe pra servidor.',
      },
    ],
    tips: [
      'O registro fica só no seu navegador e é limpo sozinho depois de 7 dias.',
      '"Limpar histórico" apaga só os registros — não toca nos seus arquivos baixados.',
    ],
  },

  /* ── Automação (guias grandes) ────────────────────────────────────── */

  '/tools/heygen-auto': {
    title: 'Hey Auto',
    tagline:
      'Lipsync no HeyGen em lote, num clique — e no final você recebe o vídeo MONTADO, sem nunca abrir o HeyGen.',
    size: 'large',
    steps: [
      {
        title: 'Prepare o ambiente (uma vez só)',
        text: 'Duas condições, e você nunca mais pensa nisso: a extensão Hey Auto instalada no Chrome (o botão "⬇ Baixar extensao (.zip)" e o bloco "Como instalar (passo a passo)" mostram cada clique) e uma aba do navegador logada no HeyGen. O disparo roda pela sua conta logada — não usa API, não tem custo extra por vídeo. Com tudo certo, aparece o chip verde da extensão; o botão "Testar conexao HeyGen" confirma que a ponte está de pé antes de qualquer disparo.',
        visual: (
          <Shot label="Hey Auto · setup">
            <MRow>
              <MChip tone="lime">EXTENSÃO HEY AUTO ✓</MChip>
              <MChip tone="dim">HEYGEN LOGADO NUMA ABA</MChip>
              <MBtn tone="ghost">Testar conexao HeyGen</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Caminho rápido: importe a copy do Google Docs',
        text: 'Tem um Docs com as copys? No card "Fila de disparos", use o botão de importar: cole o "🔗 Link do Docs" (ou suba um arquivo .txt/.docx) e clique em "🧠 Analisar copy". A análise abre em TELA CHEIA mostrando cada AD detectado — hooks, body, avatar e voz por locutor. Revise o texto, resolva os avatares marcados como "Pendente" e clique em "+ Adicionar N à fila". Sem doc? Siga o fluxo manual dos próximos passos — o resultado é o mesmo.',
        visual: (
          <Shot label="Hey Auto · importar Docs">
            <MRow>
              <MBtn tone="primary">🧠 Analisar copy</MBtn>
              <MChip tone="lime">3 ADS DETECTADOS</MChip>
              <MBtn tone="lime">+ Adicionar 3 à fila</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Monte o Docs no modelo que a análise lê perfeito',
        text: 'A análise detecta cada AD pela NOMENCLATURA em linha própria. A capa ("AD01GL - VFPB04") declara os avatares, um por linha, no formato "Papel: @arquivo.mp4" — e o nome do arquivo deve ser o MESMO nome do avatar na sua biblioteca HeyGen, porque é por ele que o casamento automático acontece. Com um avatar só, "Link do avatar: arquivo.mp4" também vale. Cada variação de gancho vive numa seção própria "AD01G1GL - VFPB04": G1 vira o HOOK 1, G2 vira o HOOK 2, e assim por diante. Antes de cada fala, o rótulo do locutor em linha própria ("Mulher:") — ele diz quem fala e NÃO é lido como fala. A palavra "Body" sozinha numa linha marca onde o corpo começa (fica na última seção G); trocou o locutor no meio do corpo, abra um novo rótulo. Regra de ouro: fala é SÓ fala — nada de .mp4, link ou nomenclatura no meio do texto, porque o parser trata referência como fim da fala. Linhas de produção ("Instruções para edição:", "Música:", "Referência:") podem existir — são ignoradas de propósito. E um doc pode ter vários ADs: cada capa nova vira um disparo na análise.',
        visual: (
          <Shot label="Google Docs · modelo de briefing">
            <MDoc>
              <MDocL k="h">AD01GL - VFPB04</MDocL>
              <MDocL k="label">Avatar e Vozes:</MDocL>
              <MDocL k="label">Doutor: @doutorexemplo1.mp4</MDocL>
              <MDocL k="label">Mulher: @mulherexemplo2.mp4</MDocL>
              <MDocL k="label">Instruções para edição: <span className="font-normal text-[#3c3c38]">edição limpa (o parser ignora)</span></MDocL>
              <MDocL k="gap" />
              <MDocL k="h">AD01G1GL - VFPB04</MDocL>
              <MDocL k="label">Mulher:</MDocL>
              <MDocL k="hl">Você sabia que dá pra organizar a semana inteira em dez minutos por dia?</MDocL>
              <MDocL k="gap" />
              <MDocL k="h">AD01G2GL - VFPB04</MDocL>
              <MDocL k="label">Mulher:</MDocL>
              <MDocL k="hl">Eu vivia perdendo prazos — até adotar um hábito simples.</MDocL>
              <MDocL k="gap" />
              <MDocL k="marker">Body</MDocL>
              <MDocL k="label">Doutor:</MDocL>
              <MDocL>O problema quase nunca é falta de esforço, e sim de um sistema simples...</MDocL>
              <MDocL k="label">Mulher:</MDocL>
              <MDocL>Depois que eu testei, minhas manhãs mudaram. Toca no botão e começa hoje.</MDocL>
            </MDoc>
          </Shot>
        ),
      },
      {
        title: 'Nomeie o AD e escolha o motor',
        text: 'O campo "Identidade" recebe o nome do AD — ele vira o prefixo dos arquivos finais, então use o código real da sua operação. No "Motor do avatar", escolha entre os motores do HeyGen (III, IV, V) com a previsão de créditos por take na tela: dá pra definir um motor global, misturar por percentual ou escolher parte por parte.',
        visual: (
          <Shot label="Hey Auto · identidade">
            <MRow>
              <MField label="Identidade" value="AD07" grow />
              <MField label="Motor" value="V" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Escolha avatar e voz',
        text: 'O card "Avatar (sua biblioteca HeyGen)" lista a sua conta espelhada, com preview em vídeo. A "Voz" pode seguir o padrão do avatar ou ser trocada por outra da sua conta. No modo de áudio, escolher uma voz liga o Espelhamento de Voz: cada take sai com a voz escolhida no lugar da voz do áudio enviado.',
        visual: (
          <Shot label="Hey Auto · avatar e voz">
            <MRow>
              <MField label="Avatar" value="Ana — Studio" grow />
              <MField label="Voz" value="voz do avatar" grow />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Estruture hooks e body',
        text: 'Escolha o modo de input: "Cole a copy (texto)" ou "Upload de audios (parte1, parte2...)". Cada HOOK vira um take independente — é assim que nascem as variações de gancho (até 10). O checkbox "Incluir BODY" (marcado por padrão) adiciona o corpo que entra depois de cada hook: o texto do BODY é dividido automaticamente em partes de ~20 segundos, sem cortar frase no meio — o tamanho que o HeyGen rende com mais estabilidade.',
        visual: (
          <Shot label="Hey Auto · estrutura">
            <MStack>
              <MField label="HOOK 1" value="Você já tentou de tudo pra..." />
              <MField label="HOOK 2" value="O que ninguém te contou sobre..." />
              <MField label="BODY" value="A verdade é que existe um jeito... (~20s por parte)" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Ajuste os modos extra: Decupagem e Camuflagem',
        text: 'A "Decupagem" vem LIGADA: o vídeo montado sai com os silêncios e respiros já cortados, com intensidade ajustável ("Agressivo · 0.05s", "Padrão · 0.12s" ou "Suave · 0.20s"). A "Camuflagem" vem desligada; ligando, você sobe o áudio escondido e define o volume — e o disparo entrega também a versão camuflada de cada vídeo montado.',
        visual: (
          <Shot label="Hey Auto · modos extra">
            <MStack>
              <MRow>
                <MToggle on label="Decupagem ON" />
                <MToggle on={false} label="Camuflagem" />
              </MRow>
              <MRow>
                <MChip tone="dim">AGRESSIVO · 0.05S</MChip>
                <MChip tone="violet">PADRÃO · 0.12S</MChip>
                <MChip tone="dim">SUAVE · 0.20S</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Monte a fila e processe',
        text: '"+ Adicionar config atual à fila" captura o AD inteiro (avatar, voz, motor, estrutura, decupagem, camuflagem) como um item — monte quantos quiser antes de disparar. Depois, "▶ Processar fila (N)" roda tudo sozinho, item por item: disparo das partes no HeyGen, renderização, download e montagem final. O card de cada item mostra a fase ao vivo (Enviando → Renderizando → Baixando → Montando → Pronto). Pra um AD único, o botão "Gerar todas as partes via HeyGen" dispara direto, sem fila — e também termina sozinho.',
        visual: (
          <Shot label="Hey Auto · fila rodando">
            <MStack>
              <MBtn tone="primary">▶ Processar fila (3)</MBtn>
              <MQueueItem name="AD07 · 4 partes" status="Renderizando 2/4" pct={45} />
              <MQueueItem name="AD08 · 3 partes" status="na fila" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Receba o vídeo MONTADO em MP4',
        text: 'A entrega é o lipsync PRONTO: o vídeo montado (hook + body emendados) e decupado baixa sozinho em MP4 assim que termina — com vários hooks, cada gancho gera o seu vídeo final. Com a camuflagem ligada, a versão camuflada vem junto. No card do item, o botão "Baixar MP4" rebaixa a entrega quando você quiser; os takes brutos NÃO são baixados automaticamente — ficam guardados no navegador (botão "⬇ Takes" e Histórico de avatares) só como segurança pra retomar ou editar por conta própria.',
        visual: (
          <Shot label="Hey Auto · entrega">
            <MStack>
              <MQueueItem name="AD07 · montado + decupado" status="Pronto" pct={100} tone="lime" />
              <MRow>
                <MBtn tone="lime">Baixar MP4</MBtn>
                <MChip tone="dim">TAKES GUARDADOS NO HISTÓRICO</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'Fila "travada" no meio do dia quase sempre é o limite diário do HeyGen — não é defeito. O Retomar continua depois do reset, sem regenerar o que já ficou pronto.',
      'F5 não perde nada: fila, progresso e resultados ficam salvos no navegador.',
      'Se faltar alguma parte, o Hey Auto NÃO monta vídeo furado: ele avisa o que faltou ("INCOMPLETO") e o Retomar completa só as partes ruins.',
      'Hey Auto Dynamic: marque pra usar um avatar diferente em cada parte do mesmo AD.',
      'O link "Abrir HeyGen Projects" mostra os renders direto na sua conta HeyGen, se quiser conferir por lá.',
    ],
  },

  '/tools/clickup-pilot': {
    title: 'ClickUp Pilot',
    tagline:
      'Lê o briefing das suas tasks no ClickUp e dispara os avatares de cada uma, em fila, sozinho — entregando o vídeo montado.',
    size: 'large',
    steps: [
      {
        title: 'Conecte e configure (uma vez só)',
        text: 'Clique em "Configurar" pra abrir a página de ajustes: lá entram o token pessoal do ClickUp (fica salvo só no seu navegador), o workspace e o Editor que você opera. Com tudo certo, o painel mostra o chip "Pilot Online" com o nome do workspace e do editor. Dois avisos importantes: o Pilot só LÊ o ClickUp — nada é escrito de volta —, e ele usa a mesma extensão + aba logada no HeyGen que o Hey Auto.',
        visual: (
          <Shot label="Pilot · conexão">
            <MRow>
              <MChip tone="lime">PILOT ONLINE</MChip>
              <MField label="Workspace" value="Estúdio" grow />
              <MField label="Editor" value="João" grow />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Carregue e selecione as tasks',
        text: 'Clique em "Carregar tasks" e a lista aparece com o nome exato do ClickUp, ordenada por vencimento. O botão redondo com o olho, ao lado, liga a leitura das tasks em REVISÃO: com ele aceso, as tasks com status de revisão entram na lista junto com as de edição — útil pra redisparar um ad que voltou da revisão. Os filtros ajudam nos dias cheios: "Período" (Todas, Ontem, Hoje, Amanhã, Atrasadas, Próximos 7 dias ou uma data específica) e "Prioridade" (Urgente, Alta). Marque as que entram no disparo — uma, algumas ou todas. Tasks irmãs (G1/G2 do mesmo AD) são selecionadas e analisadas juntas, sem duplicar trabalho.',
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
        title: 'Monte o Docs no modelo que o parser lê perfeito',
        text: 'O Start lê o Google Docs vinculado à task — e a leitura sai perfeita quando o doc segue este modelo. A capa abre com a MESMA nomenclatura do nome da task ("AD01GL - VFPB04") e declara os avatares, um por linha, no formato "Papel: @arquivo.mp4" — o nome do arquivo deve ser o MESMO nome do avatar na sua biblioteca HeyGen, porque é por ele que o Pilot casa avatar e voz sozinho. Com um avatar só, "Link do avatar: arquivo.mp4" também vale. Cada variação de gancho vive numa seção própria "AD01G1GL - VFPB04": G1 vira o HOOK 1, G2 vira o HOOK 2, e assim por diante. Antes de cada fala, o rótulo do locutor em linha própria ("Mulher:") — ele diz quem fala e NÃO é lido como fala. A palavra "Body" sozinha numa linha marca onde o corpo começa (fica na última seção G); trocou o locutor no meio do corpo, abra um novo rótulo. Regra de ouro: fala é SÓ fala — nada de .mp4, link ou nomenclatura no meio do texto, porque o parser trata referência como fim da fala. Linhas de produção ("Instruções para edição:", "Música:", "Referência:") podem existir — são ignoradas de propósito. Depoimento entra como "Depoimento com avatar: arquivo.mp4" com o texto dele embaixo.',
        visual: (
          <Shot label="Google Docs · modelo de briefing">
            <MDoc>
              <MDocL k="h">AD01GL - VFPB04</MDocL>
              <MDocL k="label">Avatar e Vozes:</MDocL>
              <MDocL k="label">Doutor: @doutorexemplo1.mp4</MDocL>
              <MDocL k="label">Mulher: @mulherexemplo2.mp4</MDocL>
              <MDocL k="label">Instruções para edição: <span className="font-normal text-[#3c3c38]">edição limpa (o parser ignora)</span></MDocL>
              <MDocL k="gap" />
              <MDocL k="h">AD01G1GL - VFPB04</MDocL>
              <MDocL k="label">Mulher:</MDocL>
              <MDocL k="hl">Você sabia que dá pra organizar a semana inteira em dez minutos por dia?</MDocL>
              <MDocL k="gap" />
              <MDocL k="h">AD01G2GL - VFPB04</MDocL>
              <MDocL k="label">Mulher:</MDocL>
              <MDocL k="hl">Eu vivia perdendo prazos — até adotar um hábito simples.</MDocL>
              <MDocL k="gap" />
              <MDocL k="marker">Body</MDocL>
              <MDocL k="label">Doutor:</MDocL>
              <MDocL>O problema quase nunca é falta de esforço, e sim de um sistema simples...</MDocL>
              <MDocL k="label">Mulher:</MDocL>
              <MDocL>Depois que eu testei, minhas manhãs mudaram. Toca no botão e começa hoje.</MDocL>
            </MDoc>
          </Shot>
        ),
      },
      {
        title: 'Analise com o Start',
        text: 'Com as tasks marcadas, clique em "Start (N)". O Pilot busca o doc da copy de cada task (pelo campo de doc da task ou pelo botão "⬇ Buscar automatico"), interpreta o briefing, separa hooks e body (partes de ~20s sem cortar frase), identifica o avatar — por link, print ou nome — e casa a voz memorizada. Cada task ganha um selo: ✓ pronta pra disparar; ⚠ parcial (normalmente falta você confirmar o avatar no seletor); ✗ erro, com o motivo exato escrito no card.',
        visual: (
          <Shot label="Pilot · análise">
            <MStack>
              <MRow>
                <MField label="Avatar" value="identificado ✓" grow />
                <MField label="Voz" value="memorizada ✓" grow />
                <MChip tone="lime">✓ PRONTA</MChip>
              </MRow>
              <MRow>
                <MField label="Copy" value="1 hook + 3 partes de body (~20s)" grow />
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Refine cada task antes de disparar',
        text: 'Tudo é ajustável por task na barra de ações do card: o motor (III/IV/V), a Decupagem — que aqui vem DESLIGADA por padrão (o vídeo sai montado sem cortar silêncios; ligue a tesoura e escolha a intensidade se quiser o corte automático) —, a Camuflagem (suba o áudio escondido e o volume) e o Auto B-roll (cole o JSON de prompts da task pra gerar os b-rolls junto). Dá também pra abrir o doc da copy direto do card.',
        visual: (
          <Shot label="Pilot · opções por task">
            <MRow>
              <MToggle on={false} label="Decupagem" />
              <MToggle on={false} label="Camuflagem" />
              <MChip tone="dim">MOTOR V</MChip>
              <MChip tone="dim">✨ AUTO B-ROLL</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Dispare em background',
        text: 'Clique em "▶ Iniciar N tasks em background". O Pilot assume tudo: dispara parte por parte no HeyGen respeitando os slots, acompanha a renderização, baixa cada vídeo e monta o resultado — com auto-cura no meio (parte travada no render é re-disparada sozinha). Você pode trocar de aba e seguir trabalhando; só não feche a aba do Pilot, que é onde o motor vive.',
        visual: (
          <Shot label="Pilot · disparo">
            <MStack>
              <MBtn tone="primary">▶ Iniciar 2 tasks em background</MBtn>
              <MQueueItem name="AD15VN · parte 2/4" status="Renderizando" pct={38} />
              <MQueueItem name="AD16VN" status="Na fila" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Acompanhe de onde preferir',
        text: 'Pelos cards de "Tasks em produção" na própria página — com as fases Na fila → Enviando → Renderizando → Baixando → Montando → Pronto — ou pela tela "Tarefas em segundo plano" (atalho no Histórico geral). Pausar, Retomar e Remover funcionam por task, a qualquer momento; pausar não perde nada do que já rendeu.',
      },
      {
        title: 'Receba o vídeo MONTADO em MP4',
        text: 'Task pronta = vídeo pronto. O botão "Baixar MP4" do card entrega o lipsync final MONTADO (hook + body emendados; decupado, se você ligou a decupagem), nomeado pelo AD da task — é o arquivo de entrega, sem etapa manual de edição. Com camuflagem ligada, a versão camuflada vem junto. E se alguma parte não veio (limite do HeyGen no meio do caminho), o Pilot NÃO entrega vídeo furado: o download trava com o aviso "Incompleto — clique Retomar pra completar", e o Retomar termina só o que faltou. Os takes brutos ficam guardados no Histórico de avatares, como reserva.',
        visual: (
          <Shot label="Pilot · entrega">
            <MStack>
              <MQueueItem name="AD15VN_PRPB06 · montado" status="Pronto" pct={100} tone="lime" />
              <MRow>
                <MBtn tone="lime">Baixar MP4</MBtn>
                <MChip tone="amber">INCOMPLETO? O RETOMAR COMPLETA</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'Pré-requisitos: extensão instalada e uma aba logada no HeyGen (os mesmos do Hey Auto).',
      'F5 no meio do disparo não perde nada: o plano fica salvo e a task retoma sozinha do checkpoint.',
      '"Travou" no meio do dia? Normalmente é o limite diário do HeyGen — o Retomar continua depois do reset, sem regenerar o que já ficou pronto.',
      'Avatar de outro workspace do HeyGen aparece como "not accessible" — troque o workspace na aba do HeyGen e retome.',
      'O Pilot também cuida de variação de avatar (VA) e troca de áudio — os cards especiais aparecem na análise e rodam pela mesma fila.',
      'O Pilot nunca escreve no seu ClickUp — leitura apenas.',
    ],
  },

  '/tools/auto-broll': {
    title: 'Auto B-roll',
    tagline:
      'Uma lista de prompts vira dezenas de b-rolls prontos — gerando pela sua conta Freepik Premium+, sem gastar crédito por vídeo.',
    size: 'large',
    steps: [
      {
        title: 'Instale a extensão Magnific (uma vez só)',
        text: 'Clique em "⬇ Baixar Extensão" no primeiro card e siga o "Passo a passo →". A extensão é quem opera o Magnific por você — sem ela não existe geração. Instalada e logada, o card fica verde: "Magnific · Conectado", mostrando o e-mail da conta ativa; o "Testar sessão" confirma a ponte. Se aparecer o selo "reinstalar", saiu versão nova — baixe de novo, leva menos de um minuto.',
        visual: (
          <Shot label="Auto B-roll · extensão">
            <MRow>
              <MBtn tone="primary">⬇ Baixar Extensão</MBtn>
              <MChip tone="lime">MAGNIFIC · CONECTADO</MChip>
              <MBtn tone="ghost">Testar sessão</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Conecte sua conta Freepik Premium+',
        text: 'Faça login no magnific.com com a conta que tem o plano Premium+ ativo — é o único pré-requisito externo. Cada take roda no modo Unlimited da SUA conta: você não gasta crédito por vídeo, só a mensalidade que já paga. Trocou de conta no Freepik? A página percebe sozinha e atualiza o e-mail exibido.',
      },
      {
        title: 'Confira a configuração',
        text: 'Três decisões no painel "Configuração": o modelo de IMAGEM — "Nano Banana 2" (rápido e consistente, o padrão) ou "Seedream 4.5" (detalhe rico, cinematográfico) —, o FORMATO — "Vertical" 9:16 (Reels/TikTok/Shorts) ou "Horizontal" 16:9 (YouTube/VSL) — e o "Movimento" opcional: um prompt de câmera (com atalhos prontos: "slow push-in", "soft handheld", "slow orbit", "static tripod") aplicado aos takes que não trouxerem o próprio. O perfil de VÍDEO é travado de propósito: Kling 2.5 · 720p · 10s — o ponto calibrado do Unlimited.',
        visual: (
          <Shot label="Auto B-roll · configuração">
            <MRow>
              <MChip tone="violet">NANO BANANA 2</MChip>
              <MChip tone="lime">VERTICAL 9:16</MChip>
              <MChip tone="dim">KLING 2.5 · 720P · 10S · 🔒</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Crie o job com a lista de prompts',
        text: 'Preencha o "Código do AD / Nome do Pack" (vira o nome do pacote final) e cole a lista de takes no campo de JSON — o formato é uma lista de objetos com "imagePrompt" e "videoPrompt". O chip "N takes detectados" confere a contagem na hora: valide esse número antes de disparar. Dá pra empilhar vários jobs com "+ Adicionar outro JSON" e rodar tudo com "Disparar TODOS os N jobs" (em série, um por vez).',
        visual: (
          <Shot label="Auto B-roll · job">
            <MStack>
              <MField label="Código do AD / Nome do Pack" value="AD15VN" />
              <MField value='[ { "imagePrompt": "...", "videoPrompt": "..." }, ... ]' />
              <MChip tone="lime">12 TAKES DETECTADOS</MChip>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Dispare e acompanhe take a take',
        text: 'Clique em "Disparar N takes". Cada take passa por duas fases visíveis no grid: primeiro o FRAME (a imagem-base — o card marca "FRAME OK" na metade do caminho), depois o VÍDEO por cima ("RENDERIZADO" → "ARQUIVANDO" → "ENTREGUE"). A fila é serial de propósito — um take por vez é o que rende estável no Magnific. Takes que falharem entram sozinhos em rodadas de auto-retry no final.',
        visual: (
          <Shot label="Auto B-roll · gerando">
            <MStack>
              <MQueueItem name="TAKE 01" status="ENTREGUE" pct={100} tone="lime" />
              <MQueueItem name="TAKE 02" status="RENDERIZADO" pct={80} />
              <MQueueItem name="TAKE 03" status="FRAME OK" pct={50} />
              <MQueueItem name="TAKE 04" status="NA FILA" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe sem esperar o lote inteiro',
        text: 'Take pronto é take utilizável: expanda pra tela cheia pra conferir e baixe o arquivo individual na hora com o "Baixar MP4" do card, enquanto os outros ainda geram. O pacote completo ("⬇ Baixar ZIP", com todos os vídeos na ordem da lista) libera quando o último take termina — a barra "Pipeline N/N prontos" mostra o quanto falta.',
      },
      {
        title: 'Use o Histórico pra retomar e rebaixar',
        text: 'A seção "Histórico" guarda os lotes anteriores com o anel de progresso de cada um. "Retomar" re-dispara SÓ os takes que faltaram (o que ficou pronto não regenera); "Preview" abre o grid dos vídeos; "Baixar" reconstrói o pacote completo direto pro seu disco. Lote incompleto também gera um pacote parcial — você nunca fica de mãos vazias.',
        visual: (
          <Shot label="Auto B-roll · histórico">
            <MStack>
              <MQueueItem name="AD15VN · 10/12" status="2 faltam" pct={83} tone="amber" />
              <MRow>
                <MBtn tone="dark">Retomar</MBtn>
                <MBtn tone="ghost">Preview</MBtn>
                <MBtn tone="lime">Baixar</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'Os takes ficam salvos no navegador — F5 no meio do lote não apaga nada.',
      'O "Movimento" global só entra nos takes sem videoPrompt próprio — take com prompt de câmera na lista mantém o dele.',
      'Take que não sai nem depois das rodadas de retry costuma ser prompt vetado pela política do Magnific — ajuste o texto e retome.',
    ],
  },
};

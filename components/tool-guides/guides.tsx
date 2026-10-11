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
 * - ferramenta COM aula em vídeo (lib/aulas-video.ts): os passos seguem a aula
 *   — mesma ordem, mesmos nomes e números que o vídeo fala (pedido do dono em
 *   10.10.26: o passo a passo não pode divergir do vídeo). O que a aula não
 *   mostra (modos secundários, avisos, limites) vai nas dicas;
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
    title: 'Remover Silêncios',
    tagline:
      'Corta os silêncios em lote e devolve cada arquivo limpo — vídeo vira vídeo, áudio vira áudio.',
    steps: [
      {
        title: 'Adicione seus arquivos',
        text: 'No card "Adicione seus arquivos (até 10)", arraste os arquivos ou clique na área pra escolher. São até 10, em MP3, WAV, MP4, WEBM ou MOV, com até 800 MB cada.',
        visual: (
          <Shot label="Remover Silêncios · arquivos">
            <MDrop label="Selecione ou arraste seus arquivos" sub="Selecione um ou mais arquivos. 3/10 na fila." />
          </Shot>
        ),
      },
      {
        title: 'Confira a fila',
        text: 'Cada arquivo entra na fila com o tipo ("Vídeo" ou "Áudio") e o tamanho. Entrou o arquivo errado? O "×" ao lado dele tira ele da fila.',
        visual: (
          <Shot label="Remover Silêncios · fila">
            <MStack>
              <MQueueItem name="depoimento-cliente.mp4" status="Vídeo · 2.2 MB · na fila" pct={0} />
              <MQueueItem name="musica-de-fundo.mp3" status="Áudio · 1.3 MB · na fila" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha o formato de saída',
        text: 'No card "Formato de saída": "MP4" devolve o vídeo já cortado; "MP3" e "WAV" devolvem só o áudio.',
        visual: (
          <Shot label="Remover Silêncios · formato de saída">
            <MRow>
              <MChip tone="violet">MP4</MChip>
              <MChip tone="dim">MP3</MChip>
              <MChip tone="dim">WAV</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Ajuste quanto de silêncio manter',
        text: 'No card "Quanto de silêncio manter?", use o controle "Tolerância de silêncio": pra esquerda, o corte fica mais seco; pra direita, a fala respira mais. Na dúvida, deixe no padrão (0.05s).',
        visual: (
          <Shot label="Remover Silêncios · tolerância">
            <MSlider label="Tolerância de silêncio" pct={10} val="0.05s" />
          </Shot>
        ),
      },
      {
        title: 'Clique em Decupar fila',
        text: 'Clique em "Decupar fila (N)". Os arquivos rodam um por vez, direto no seu navegador.',
        visual: (
          <Shot label="Remover Silêncios · decupar">
            <MBtn tone="lime">Decupar fila (2)</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Veja a duração de antes e de depois',
        text: 'Na fila, cada arquivo pronto mostra a duração de antes e a de depois (ex.: "0:26 → 0:15") e quanto encolheu (ex.: "−41%").',
        visual: (
          <Shot label="Remover Silêncios · fila pronta">
            <MStack>
              <MQueueItem name="depoimento-cliente.mp4" status="0:26 → 0:15 · −41%" pct={100} tone="lime" />
              <MQueueItem name="aula-gravada.mp4" status="0:35 → 0:20 · −43%" pct={100} tone="lime" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Confira o resultado e a auditoria do corte',
        text: 'Embaixo, cada arquivo ganha um card "Pronto" com quanto ficou mais curto (ex.: "−41% mais curto"), a duração "Original" e "Sem silêncio", e quanto silêncio saiu (ex.: "−0:10 de silêncio removido"). Logo abaixo, a "Auditoria do corte" confere se nenhuma palavra foi cortada — e mostra "Nenhuma palavra cortada".',
        visual: (
          <Shot label="Remover Silêncios · resultado">
            <MStack>
              <MRow>
                <MChip tone="lime">Pronto</MChip>
                <MChip tone="lime">−41% mais curto</MChip>
              </MRow>
              <MRow>
                <MField label="Original" value="0:26" />
                <MField label="Sem silêncio" value="0:15" />
              </MRow>
              <MChip tone="lime">Nenhuma palavra cortada · Auditoria do corte</MChip>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Dê o play e baixe',
        text: 'Dê o play no preview do card pra conferir. Depois, baixe um por um pelo "Baixar MP4" (ou "Baixar MP3"/"Baixar WAV") de cada card — ou todos de uma vez com "↓ Baixar todos (ZIP)".',
        visual: (
          <Shot label="Remover Silêncios · download">
            <MRow>
              <MBtn tone="lime">Baixar MP4</MBtn>
              <MBtn tone="ghost">↓ Baixar todos (ZIP)</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Com um arquivo de áudio na fila, o MP4 fica bloqueado ("Só com vídeos na fila") e a saída é em MP3 ou WAV. No plano grátis a saída é sempre em áudio — o MP4 aparece com cadeado.',
      'Precisa parar? "Cancelar fila" interrompe sem perder o que já ficou pronto; depois o botão vira "Continuar fila (N restantes)".',
      'O volume da voz é regulado antes do corte — dois locutores gravados em volumes diferentes saem no mesmo patamar.',
      'Tudo roda no seu navegador — nada sobe pra servidor. Arquivos grandes são divididos em partes automaticamente e juntados num arquivo só no final.',
      'O arquivo baixado sai com "_decupado" no nome.',
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
        title: 'Abra no modo Camuflar',
        text: 'No seletor do topo, deixe em "Camuflar".',
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
        title: 'Monte o par: original + escondido',
        text: 'No card "Original + escondido", cada par tem dois arquivos. Primeiro, o "Áudio original": é o que toca, o que as pessoas ouvem. Depois, o "Áudio escondido": é o que a transcrição vai ler no lugar. Ele pode ser mais curto — o resultado fica com a duração do original.',
        visual: (
          <Shot label="Camuflagem · par 1">
            <MRow>
              <MField label="Áudio original" value="criativo-v3.mp4" grow />
              <MField label="Áudio escondido" value="texto-neutro.mp3" grow />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Mais vídeos? Mais pares',
        text: 'Tem mais vídeos? Use "+ Adicionar par" — são até 10 pares.',
        visual: (
          <Shot label="Camuflagem · pares">
            <MBtn tone="ghost">+ Adicionar par (1/10)</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Ajuste a intensidade',
        text: 'No card "Intensidade", o "Volume da camuflagem": quanto maior, mais difícil de detectar. Comece nos 30% do padrão.',
        visual: (
          <Shot label="Camuflagem · intensidade">
            <MSlider label="Volume da camuflagem" pct={30} val="30%" />
          </Shot>
        ),
      },
      {
        title: 'Escolha a saída',
        text: 'No card "Formato de saída": "MP4" mantém o vídeo e troca só o áudio; "MP3" e "WAV" entregam só o som.',
        visual: (
          <Shot label="Camuflagem · formato">
            <MRow>
              <MChip tone="violet">MP4</MChip>
              <MChip tone="dim">MP3</MChip>
              <MChip tone="dim">WAV</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Clique em Processar tudo',
        text: 'Clique em "Processar tudo".',
        visual: (
          <Shot label="Camuflagem · processar">
            <MBtn tone="primary">Processar tudo</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Confira o selo',
        text: 'Pronto o arquivo, a ferramenta escuta o resultado do jeito que as plataformas escutam e dá o veredito em selos. Selo verde: camuflado. Veio "NÃO CAMUFLADO"? Suba a intensidade e processe de novo.',
        visual: (
          <Shot label="Camuflagem · veredito">
            <MStack>
              <MChip tone="lime">Camuflado pra TikTok / Kwai / YouTube / Meta</MChip>
              <MChip tone="amber">Não camuflado → suba a intensidade</MChip>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe',
        text: 'Aí é só baixar: um por um ("Baixar MP4/MP3/WAV") ou tudo em "Baixar ZIP (N)".',
      },
      {
        title: 'Descamuflar: o caminho inverso',
        text: 'O modo "Descamuflar" faz o caminho inverso: separa as camadas de volta. Em "O que recuperar", escolha "Áudio original" ou "Áudio escondido", suba os arquivos camuflados e clique em "Descamuflar tudo".',
        visual: (
          <Shot label="Camuflagem · descamuflar">
            <MRow>
              <MChip tone="violet">Áudio original</MChip>
              <MChip tone="dim">Áudio escondido</MChip>
              <MBtn tone="primary">Descamuflar tudo</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Nunca publique sem o selo verde: ele é medido no arquivo real, depois de pronto — não é estimativa. O botão "Transcrever (ouvir como a IA)" mostra o texto exato que a IA leu.',
      'Pra sair em MP4, o áudio original precisa ser um arquivo de vídeo.',
      'Modo mudo (botão de alto-falante no card dos pares): camufla sem áudio escondido — o público ouve o original e a IA escuta silêncio.',
      'No Descamuflar, o "Trocar áudio escondido" sobe um novo escondido no lugar do antigo, mantendo o áudio original.',
      'A camuflagem funciona em áudio estéreo; arquivo mono não tem camada pra separar.',
      'A conferência do selo usa a chave do AssemblyAI (a do Groq não serve pra conferir). Sem ela, a camuflagem funciona — só a conferência fica desligada.',
    ],
  },

  '/tools/downloader': {
    title: 'Downloader',
    tagline: 'Baixa vídeos, áudios e imagens do YouTube, Instagram, TikTok e Pinterest.',
    steps: [
      {
        title: 'Entenda as duas peças',
        text: 'O Downloader usa duas peças, instaladas uma vez só: a extensão, um complemento do Chrome, e o Motor, um programinha que faz o download no seu computador. As duas ficam no card "Sua conexão".',
      },
      {
        title: 'Baixe e extraia a extensão',
        text: 'Clique em "Baixar extensão": o arquivo ZIP vai pra sua pasta de Downloads. Clique nele com o botão direito, em "Extrair tudo" e depois em "Extrair".',
        visual: (
          <Shot label="Downloader · sua conexão">
            <MRow>
              <MBtn tone="primary">Baixar extensão</MBtn>
              <MBtn tone="ghost">Instalar Motor</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Carregue a extensão no Chrome',
        text: 'No Chrome, abra o menu dos três pontinhos → "Extensões" → "Gerenciar extensões" e ligue o "Modo do desenvolvedor", no canto de cima. Clique em "Carregar sem compactação" e escolha a pasta que você extraiu. Pronto: a extensão aparece na lista.',
        visual: (
          <Shot label="Chrome · extensões">
            <MRow>
              <MToggle on label="Modo do desenvolvedor" />
              <MBtn tone="ghost">Carregar sem compactação</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Instale o Motor',
        text: 'Clique em "Instalar Motor", abra o arquivo que baixou e espere a janela confirmar a instalação.',
      },
      {
        title: 'Verifique a conexão',
        text: 'Volte pro Downloader e clique em "Verificar conexão". Tudo verde — "Tudo pronto para baixar": pode usar.',
        visual: (
          <Shot label="Downloader · conexão">
            <MRow>
              <MChip tone="lime">Tudo pronto para baixar</MChip>
              <MBtn tone="ghost">Verificar conexão</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Baixe direto do vídeo',
        text: 'Abra um vídeo no YouTube: o botão de baixar aparece no canto da tela. Um clique… e o vídeo vai direto pra sua pasta de Downloads. No Instagram é igual: abra o Reels e clique no botão. Funciona também no TikTok, no Pinterest e em sites +18.',
      },
      {
        title: 'Vários de uma vez',
        text: 'Cole os links no card "Links", um por linha, escolha o "Formato" e a "Qualidade" e clique em "Baixar N arquivos".',
        visual: (
          <Shot label="Downloader · vários links">
            <MStack>
              <MField label="Links" value="https://www.youtube.com/watch?v=…" />
              <MRow>
                <MChip tone="violet">Vídeo</MChip>
                <MChip tone="dim">Áudio MP3</MChip>
                <MChip tone="dim">Áudio WAV</MChip>
                <MChip tone="violet">1080p</MChip>
                <MBtn tone="primary">Baixar 3 arquivos</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'Baixe só o que você tem direito de usar. Links privados exigem login na plataforma.',
      'No Windows, se aparecer a tela azul do SmartScreen ao abrir o Motor, clique em "Mais informações" e depois "Executar assim mesmo". Se o instalador não abrir, use a "versão ZIP" no mesmo card.',
      'No Mac, o Motor está em teste fechado: o Instagram (pela extensão) e o TikTok em vídeo funcionam sem ele; YouTube e Pinterest precisam do Motor.',
      'Apareceu "Extensão conectada. Abra o Motor."? Abra o "Auto Edit Downloader" no menu Iniciar e clique em "Verificar conexão" de novo.',
      'Pra colar links de sites +18 na lista, ligue o botão "+18" do card de links.',
      'TikTok sai sem marca d’água e em HD; Pinterest baixa a mídia direta.',
    ],
  },

  '/tools/compressor': {
    title: 'Compressor',
    tagline: 'Reduz o peso dos vídeos sem perda visível — com previsão de tamanho antes de processar.',
    steps: [
      {
        title: 'Adicione seus vídeos',
        text: 'No card "Adicione seus vídeos", arraste ou clique. São até 20 arquivos, MP4, MOV ou WEBM, com até 2 GB cada.',
        visual: (
          <Shot label="Compressor · vídeos">
            <MDrop label="Adicione seus vídeos" sub="Até 20 arquivos · MP4, WEBM ou MOV · até 2 GB cada" />
          </Shot>
        ),
      },
      {
        title: 'Leia o resumo',
        text: 'O resumo mostra quantos "Arquivos", o tamanho ("Entrada"), a "Duração"… e a "Previsão" de quanto vai sobrar.',
        visual: (
          <Shot label="Compressor · resumo">
            <MRow>
              <MField label="Arquivos" value="3" />
              <MField label="Entrada" value="141.5 MB" />
              <MField label="Duração" value="1min 15s" />
              <MField label="Previsão" value="~86.8 MB" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Ajuste a qualidade',
        text: 'No card "Qualidade", o controle "Compressão": pra esquerda ("Alta qualidade"), imagem mais fiel; pra direita ("Menor arquivo"), arquivo menor. A previsão muda na hora, enquanto você arrasta. Na dúvida, fique no 23, o padrão.',
        visual: (
          <Shot label="Compressor · qualidade">
            <MSlider label="Compressão" pct={29} val="23" />
          </Shot>
        ),
      },
      {
        title: 'Quer reduzir mais? Baixe a resolução',
        text: 'No card "Resolução", escolha "1080p", "720p" ou "480p" ("Original" mantém o tamanho do quadro).',
        visual: (
          <Shot label="Compressor · resolução">
            <MRow>
              <MChip tone="dim">Original</MChip>
              <MChip tone="violet">1080p</MChip>
              <MChip tone="dim">720p</MChip>
              <MChip tone="dim">480p</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Clique em Comprimir',
        text: 'Clique em "Comprimir N vídeos". Até cinco vídeos rodam ao mesmo tempo.',
        visual: (
          <Shot label="Compressor · comprimir">
            <MBtn tone="primary">Comprimir 3 vídeos</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Compare o antes e o depois',
        text: 'Cada vídeo mostra o tamanho de antes, o de depois e quanto encolheu. No final, "Você economizou" mostra o total.',
        visual: (
          <Shot label="Compressor · resultado">
            <MStack>
              <MQueueItem name="depoimento-cliente.mp4" status="47.5 MB → 10.3 MB · 78% menor" pct={100} tone="lime" />
              <MChip tone="lime">Você economizou</MChip>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe',
        text: 'Baixe um por um ("Baixar") ou todos de uma vez com "Baixar ZIP (N)".',
      },
    ],
    tips: [
      'A saída é sempre MP4, independente do formato de entrada.',
      'Tudo roda no seu navegador — os vídeos não sobem pra nenhum servidor.',
      'O número do controle "Compressão" vai de 18 (alta qualidade) a 35 (menor arquivo). Precisa caber num limite de upload? Vá subindo até a previsão bater.',
    ],
  },

  '/tools/audio-split': {
    title: 'Dividir Voz',
    tagline: 'Quebra um áudio longo em partes, cortando apenas nas pausas — sem partir frase.',
    steps: [
      {
        title: 'Suba o arquivo',
        text: 'No card "Áudio ou vídeo", suba o arquivo: MP3, WAV, MP4, WEBM ou OGG.',
        visual: (
          <Shot label="Dividir Voz · arquivo">
            <MDrop label="Selecione ou arraste um arquivo" sub="MP3, WAV, MP4, WEBM ou OGG" />
          </Shot>
        ),
      },
      {
        title: 'Entenda o critério',
        text: 'O "Critério de divisão" é automático: ele procura as pausas mais longas da fala e divide em partes equilibradas, mais ou menos quatro por minuto. O corte acontece sempre numa pausa, nunca no meio de uma palavra.',
      },
      {
        title: 'Clique em Processar',
        text: 'Clique em "Processar". Pronto: ele mostra quantas partes saíram.',
        visual: (
          <Shot label="Dividir Voz · processar">
            <MRow>
              <MBtn tone="primary">Processar</MBtn>
              <MChip tone="lime">5 partes · Pausas detectadas</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Ouça cada parte',
        text: 'Cada parte tem a duração e um player pra você ouvir antes de baixar.',
        visual: (
          <Shot label="Dividir Voz · partes">
            <MStack>
              <MQueueItem name="Parte 1 · 0:12" status="Baixar" pct={100} tone="lime" />
              <MQueueItem name="Parte 2 · 0:15" status="Baixar" pct={100} tone="lime" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe',
        text: 'Baixe só a que precisa ("Baixar") ou todas de uma vez com "Baixar ZIP".',
      },
      {
        title: 'Quer tirar os silêncios?',
        text: 'Se o que você quer é tirar os silêncios, e não dividir, use o Remover Silêncios.',
      },
    ],
    tips: [
      'As partes saem sempre em WAV (parte1.wav, parte2.wav...) — qualidade máxima pra próxima etapa.',
      'Partes com durações diferentes entre si é o comportamento certo: o corte segue as pausas reais da fala.',
      'Subiu um vídeo? A ferramenta aproveita só a trilha de áudio.',
    ],
  },

  '/tools/acelerador': {
    title: 'Mixer de Velocidade',
    tagline: 'Acelera ou desacelera vídeo e áudio em lote, sem a voz ficar robótica.',
    steps: [
      {
        title: 'Adicione os arquivos',
        text: 'No card "Arquivos", adicione vídeo ou áudio: até 20 por vez (MP3, WAV, MP4, WEBM ou MOV).',
        visual: (
          <Shot label="Mixer · arquivos">
            <MDrop label="Arraste ou clique pra subir" sub="Até 20 · MP3, WAV, MP4, WEBM ou MOV" />
          </Shot>
        ),
      },
      {
        title: 'Defina a velocidade',
        text: 'No card "Velocidade", arraste de 0.5x até 3x… ou use os atalhos, como 1.25x, 1.5x e 2x. Acima de 1, acelera; abaixo, desacelera. E o tom da voz não muda.',
        visual: (
          <Shot label="Mixer · velocidade">
            <MStack>
              <MSlider label="Velocidade" pct={40} val="1.50x" />
              <MRow>
                <MChip tone="dim">1.25x</MChip>
                <MChip tone="violet">1.5x</MChip>
                <MChip tone="dim">2x</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha a saída',
        text: 'No card "Formato de saída": MP4 mantém o vídeo; MP3 e WAV, só o áudio. Com um áudio na fila, o MP4 fica bloqueado.',
        visual: (
          <Shot label="Mixer · formato de saída">
            <MRow>
              <MChip tone="violet">MP4</MChip>
              <MChip tone="dim">MP3</MChip>
              <MChip tone="dim">WAV</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Clique em Acelerar',
        text: 'Clique em "Acelerar N" (abaixo de 1x, o botão vira "Desacelerar N").',
        visual: (
          <Shot label="Mixer · processar">
            <MBtn tone="primary">Acelerar 3</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Baixe',
        text: 'Cada arquivo sai com a velocidade no nome (ex.: "_1.5x"). Baixe um por um ("Baixar") ou todos com "Baixar ZIP (N)".',
      },
    ],
    tips: [
      'Os atalhos são 0.75x, 0.85x, 1.00x, 1.25x, 1.5x e 2x. Em 1.00x o arquivo sairia igual ao original — por isso o botão só ativa quando a velocidade muda.',
      'Com vídeo na fila e saída em MP3/WAV, a imagem é descartada e só o áudio acelerado é exportado (a tela avisa).',
      'Pra dar ritmo num anúncio sem chamar atenção, 1.25x costuma passar despercebido.',
    ],
  },

  '/tools/fakepass': {
    title: 'FakePrint',
    tagline: 'Prints e stickers de redes sociais, telejornais e sites de notícia — fiéis aos originais.',
    steps: [
      {
        title: 'Escolha o tipo',
        text: 'Escolha o tipo de print: Stickers de Story, Conversas, Posts, Notificações, Lives, Reuniões, Telejornais e Sites de notícia. Clique no card do modelo pra abrir os campos dele.',
        visual: (
          <Shot label="FakePrint · tipos">
            <MRow>
              <MChip tone="dim">Stickers de Story</MChip>
              <MChip tone="violet">Conversas</MChip>
              <MChip tone="dim">Posts</MChip>
              <MChip tone="dim">Lives</MChip>
              <MChip tone="dim">Telejornais</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Monte a conversa (ex.: WhatsApp)',
        text: 'Em Conversas, abra o WhatsApp. Preencha o "Nome" do contato, o "Status"… e a "Conversa": cada mensagem pode ser texto, áudio, imagem (foto) ou vídeo, e você escolhe quem fala — "Eu" ou "Contato". A "Prévia" atualiza a cada tecla.',
        visual: (
          <Shot label="FakePrint · WhatsApp">
            <MStack>
              <MRow>
                <MField label="Nome" value="Dra. Ana" grow />
                <MField label="Status" value="online" grow />
              </MRow>
              <MRow>
                <MChip tone="violet">Eu</MChip>
                <MChip tone="dim">Contato</MChip>
                <MChip tone="dim">Texto</MChip>
                <MChip tone="dim">Áudio</MChip>
                <MChip tone="dim">Imagem</MChip>
                <MChip tone="dim">Vídeo</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Ajuste a barra do celular',
        text: 'O detalhe que convence: no bloco "Barra de status do celular", escolha iPhone ou Android e acerte a hora, a bateria e o sinal.',
        visual: (
          <Shot label="FakePrint · barra de status">
            <MRow>
              <MChip tone="violet">iPhone</MChip>
              <MChip tone="dim">Android</MChip>
              <MField label="Hora" value="21:47" />
              <MField label="Bateria" value="63%" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Baixe o PNG',
        text: 'Clique em "Baixar PNG": a imagem sai em alta, pronta pro seu vídeo.',
        visual: (
          <Shot label="FakePrint · download">
            <MBtn tone="lime">Baixar PNG</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Telejornal',
        text: 'Em Telejornais, escolha o canal, escreva a "Manchete" e o texto da faixa ("Sub-manchete").',
        visual: (
          <Shot label="FakePrint · telejornal">
            <MStack>
              <MField label="Manchete" value="Nova regra muda o preço da conta de luz" />
              <MField label="Sub-manchete" value="Entenda o que muda a partir de novembro" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Site de notícia',
        text: 'Em Sites de notícia, é a matéria inteira: título ("Manchete"), linha fina ("Linha de apoio"), foto ("Imagem principal") e data ("Quando").',
      },
      {
        title: 'Live? Exporte em vídeo',
        text: 'Nas Lives, a prévia é animada: dá pra "Exportar vídeo" com fundo verde (em "Fundo", escolha "Chroma key"), pra sobrepor no seu criativo.',
        visual: (
          <Shot label="FakePrint · live">
            <MRow>
              <MChip tone="violet">Chroma key</MChip>
              <MBtn tone="primary">Exportar vídeo</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'Os emojis saem no estilo do aparelho escolhido: Apple no iPhone, Google no Android — igual ao print real.',
      'Os telejornais também exportam em vídeo (relógio e ticker animados) e têm "Formato" 16:9, 9:16 ou 4:5, "Layout da cena" e fundo "Tela verde" pra encaixar sua imagem por trás.',
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
        title: 'Entenda o SRT',
        text: 'SRT é o arquivo de legenda: cada frase com o momento exato em que aparece e some. Os editores de vídeo, como o CapCut e o Premiere, leem esse arquivo.',
      },
      {
        title: 'Suba o áudio ou o vídeo',
        text: 'No card "Áudio ou vídeo", suba o arquivo: MP3, WAV, MP4, MOV ou WEBM, até 800 MB e 60 minutos.',
        visual: (
          <Shot label="Gerador de SRT · arquivo">
            <MDrop label="Áudio ou vídeo" sub="MP3, WAV, MP4, MOV ou WEBM · até 800 MB e 60 minutos" />
          </Shot>
        ),
      },
      {
        title: 'Cole a copy exatamente como foi narrada',
        text: 'No campo "Texto da copy", cole a copy exatamente como foi narrada. O texto da legenda é o seu: a ferramenta não reescreve nada — só os tempos vêm do áudio.',
        visual: (
          <Shot label="Gerador de SRT · copy">
            <MField label="Texto da copy" value="Você sabia que o seu metabolismo muda depois dos 40…" />
          </Shot>
        ),
      },
      {
        title: 'Gere o SRT',
        text: 'Clique em "Gerar SRT". A ferramenta casa cada palavra com o momento exato em que foi dita e monta os blocos no ritmo da fala.',
        visual: (
          <Shot label="Gerador de SRT · gerar">
            <MBtn tone="primary">Gerar SRT</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Confira e baixe o arquivo',
        text: 'O card "SRT gerado" mostra as legendas pra você conferir. Baixe com "Baixar .SRT".',
        visual: (
          <Shot label="Gerador de SRT · resultado">
            <MBtn tone="lime">Baixar .SRT</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Importe no CapCut',
        text: 'No CapCut, abra o projeto com esse áudio, clique em "Texto", depois em "Legendas locais", e em "Importar arquivo" escolha o .srt. A legenda entra na linha do tempo já no ritmo da voz — daí é só escolher o estilo.',
        visual: (
          <Shot label="CapCut · Texto">
            <MRow>
              <MChip tone="dim">Texto</MChip>
              <MChip tone="violet">Legendas locais</MChip>
              <MBtn tone="ghost">Importar arquivo</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'No Premiere, o mesmo arquivo',
        text: 'No Premiere é o mesmo .srt: vá em "Arquivo" → "Importar", escolha o arquivo e arraste pra linha do tempo.',
      },
      {
        title: 'Chave de transcrição (só na primeira vez)',
        text: 'Na primeira vez, a ferramenta pede a sua chave de transcrição: você cadastra uma vez só, em Configurações → Chaves de IA, e pronto.',
      },
    ],
    tips: [
      'Basta UMA chave de transcrição: AssemblyAI OU Groq. Faltando as duas, o banner "Chave pendente" aponta o caminho ("Configurar →").',
      'No CapCut, importe sempre por "Legendas locais": assim os modelos, estilos e animações de legenda funcionam em cima do seu SRT (inclusive o "Aplicar a todas"). Arrastando o .srt direto pra timeline ele vira texto avulso. No celular o CapCut não importa legenda — use o Desktop ou o Web.',
      'Áudio muito longo pode passar do limite do servidor — se acontecer, divida em partes menores e gere um SRT por parte.',
    ],
  },

  '/tools/tipografia': {
    title: 'Legendas Automáticas',
    tagline: 'A fala do vídeo vira legenda animada profissional, no tempo exato do áudio — e sai queimada no MP4.',
    steps: [
      {
        title: 'Suba o vídeo',
        text: 'Abra as Legendas Automáticas e suba o vídeo: MP4, MOV ou WEBM, até 800 MB e 20 minutos.',
        visual: (
          <Shot label="Legendas · vídeo">
            <MDrop label="Arraste ou clique pra subir" sub="MP4, MOV ou WEBM · até 800 MB e 20 min" />
          </Shot>
        ),
      },
      {
        title: 'Gere as legendas',
        text: 'Escolha o idioma da fala — ou deixe em "Identificar automaticamente" — e clique em "Gerar legendas". A ferramenta transcreve palavra por palavra e divide a legenda em blocos, os pedaços que aparecem na tela, no ritmo da fala.',
        visual: (
          <Shot label="Legendas · transcrição">
            <MRow>
              <MChip tone="violet">Identificar automaticamente</MChip>
              <MBtn tone="primary">Gerar legendas</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Escolha o modelo na galeria',
        text: 'A galeria tem centenas de modelos, e o player mostra a legenda animada do jeito que vai sair. Quer algo discreto? Escolha uma legenda simples, limpa.',
      },
      {
        title: 'Ligue o Destaque automático',
        text: 'Quer dinâmica? Com o "Destaque automático", a palavra forte de cada bloco ganha destaque sozinha.',
        visual: (
          <Shot label="Legendas · destaque">
            <MToggle on label="Destaque automático" />
          </Shot>
        ),
      },
      {
        title: 'Use os Templates',
        text: 'O segredo dos criativos: em "Templates", você aplica de uma vez um estilo de legenda no gancho (o comecinho do vídeo) e outro no resto.',
      },
      {
        title: 'Ligue a Linha única',
        text: 'Com a "Linha única" ligada, o bloco nunca quebra em duas linhas: a frase seguinte entra no próximo bloco.',
        visual: (
          <Shot label="Legendas · linha única">
            <MToggle on label="Linha única" />
          </Shot>
        ),
      },
      {
        title: 'Adicione uma Headline',
        text: '"Headline" é um texto fixo na tela: você arrasta pra onde quiser e escolhe quando entra e quando sai.',
      },
      {
        title: 'Corrija pela copy',
        text: 'O mais importante: em "Corrigir pela copy", cole o texto que foi narrado — as palavras que a transcrição errou se corrigem sozinhas, sem mexer no tempo.',
      },
      {
        title: 'Renderize o vídeo',
        text: 'Tudo certo? Clique em "Renderizar vídeo". Roda no seu navegador, e o MP4 baixa sozinho no final.',
        visual: (
          <Shot label="Legendas · render">
            <MBtn tone="lime">Renderizar vídeo</MBtn>
          </Shot>
        ),
      },
    ],
    tips: [
      'A transcrição precisa de UMA chave só: AssemblyAI OU Groq, em Configurações → Chaves de IA. Faltando as duas, o banner "Chave pendente" aponta o caminho ("Configurar →").',
      'O render local precisa de Chrome ou Edge atualizados no computador. Não feche a aba durante o render; se o navegador segurar o download, use o "Baixar de novo".',
      'F5 no meio da edição não perde nada: selecionando o MESMO arquivo de novo, a edição anterior é restaurada.',
      'Trocar o "Ritmo dos blocos" remonta tudo a partir da transcrição — faça isso ANTES de corrigir textos na lista.',
      'Na lista de blocos dá pra corrigir texto, dividir, juntar, ajustar o tempo e clicar numa palavra pra pintá-la na cor de destaque. O cadeado 🔒 congela um bloco — o "aplicar a todas" não mexe mais nele.',
    ],
  },

  '/tools/auto-cortes': {
    title: 'Auto Cortes',
    tagline:
      'Vídeo longo — podcast, live, aula, entrevista — vira cortes curtos com legenda animada, headline e reenquadro, sem o arquivo sair do seu navegador.',
    size: 'large',
    steps: [
      {
        title: 'Cole o link ou solte o vídeo',
        text: 'O passo "1 Fonte" tem um campo único: "Cole o link do YouTube ou do Drive, ou solte o vídeo". Soltar o arquivo do computador é o caminho que não exige nada instalado. Pra colar LINK valem os mesmos dois requisitos do Downloader (passo 1 do guia dele): o Motor instalado e rodando, e a extensão do Chrome na versão 1.8.0. Os chips do lado dizem em que pé você está: "Motor conectado" quer dizer que pode colar link; "Extensão 1.8.0 necessária pra link" quer dizer que a extensão precisa ser atualizada — enquanto isso, subir o arquivo funciona igual. Limite de entrada: 4 GB e 4 horas por vídeo.',
        visual: (
          <Shot label="Auto Cortes · 1 Fonte">
            <MStack>
              <MField value="Cole o link do YouTube ou do Drive, ou solte o vídeo" grow />
              <MRow>
                <MChip tone="lime">Motor conectado</MChip>
                <MChip tone="amber">Extensão 1.8.0 necessária pra link</MChip>
              </MRow>
              <MDrop
                label="Solte o vídeo aqui"
                sub="Até 4 GB e 4 h — upload não precisa de extensão"
              />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Escolha os ajustes',
        text: 'No passo "2 Ajustes" você define como os cortes vão sair. "Proporção": 9:16, 4:5, 1:1 ou 16:9. "Duração do corte": Auto, <30s, 30-59s, 60-89s, 90s-3min ou 3-5min. "Quantidade": Auto (a ferramenta calcula pelo tamanho do vídeo) ou um número fixo — 5, 10, 15, 20 ou 30. "Gênero" e "Idioma da fala" afinam a curadoria e a transcrição. "Legenda" abre a mesma galeria das Legendas Automáticas (e tem "Sem legenda"), com "Ritmo da legenda" pra escolher se o bloco anda palavra por palavra ou em frases. "Headline" é o título queimado em cima do corte — galeria própria, opção "Sem headline" e "Headline aparece" em "Todo o corte" ou só nos "Primeiros 5 s". "Reenquadro" (Auto, Seguir, Dividir, Centro, Ajustar) decide o que fica no quadro quando a proporção muda. Em "Momentos específicos" você escreve o que quer que a IA procure ("tudo sobre tráfego pago") e em "Trecho do vídeo" limita a faixa analisada. Gostou da combinação? "Salvar como padrão" guarda tudo pra próxima vez.',
        visual: (
          <Shot label="Auto Cortes · 2 Ajustes">
            <MStack>
              <MRow>
                <MChip tone="violet">9:16</MChip>
                <MChip tone="dim">4:5</MChip>
                <MChip tone="dim">1:1</MChip>
                <MChip tone="dim">16:9</MChip>
              </MRow>
              <MRow>
                <MChip tone="violet">Auto</MChip>
                <MChip tone="dim">30-59s</MChip>
                <MChip tone="dim">60-89s</MChip>
                <MChip tone="dim">90s-3min</MChip>
              </MRow>
              <MRow>
                <MChip tone="dim">Legenda</MChip>
                <MChip tone="dim">Headline</MChip>
                <MChip tone="dim">Reenquadro</MChip>
              </MRow>
              <MField label="Momentos específicos" value="tudo sobre tráfego pago" grow />
              <MRow>
                <MBtn tone="ghost">Salvar como padrão</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Gere os cortes',
        text: 'Clique em "Gerar cortes" e acompanhe a barra "Fonte → Áudio → Transcrição → Análise → Render". Tudo roda no seu navegador: o vídeo é aberto localmente, o áudio é extraído em pedaços, a fala vira transcrição, a IA lê a transcrição pra escolher os trechos e o MP4 de cada corte é montado aqui mesmo. Só a chave de "Transcrição" (Groq, gratuita) precisa estar preenchida em /configuracoes/api — ela serve pra transcrever e pra IA escolher os cortes, sem custo. Faltando, o banner no topo do passo 2 aponta o caminho. Tempo esperado num PC comum: podcast de 1 h fica em torno de 8 a 12 minutos do início ao último corte renderizado.',
        visual: (
          <Shot label="Auto Cortes · 3 Gerar cortes">
            <MStack>
              <MRow>
                <MBtn tone="primary">Gerar cortes</MBtn>
              </MRow>
              <MRow>
                <MChip tone="lime">Fonte</MChip>
                <MChip tone="lime">Áudio</MChip>
                <MChip tone="violet">Transcrição</MChip>
                <MChip tone="dim">Análise</MChip>
                <MChip tone="dim">Render</MChip>
              </MRow>
              <MQueueItem name="Transcrição · pedaço 4 de 9" status="44%" pct={44} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Revise e baixe',
        text: 'Cada corte vira um card com a miniatura, a duração, o título e um score de 0 a 99. Esse score é um ranking relativo DENTRO do seu vídeo — serve pra dizer por onde começar, não pra prometer alcance. Nas ações do card: "Pré-visualizar" mostra o corte exatamente como o MP4 vai sair, "Ajustar" abre o editor, "Baixar" salva aquele corte, "Copiar textos" leva título, descrição e hashtags pra área de transferência, e "SRT" baixa a legenda do corte em arquivo. Na barra de cima, "Baixar todos (ZIP)" junta a leva inteira num arquivo só.',
        visual: (
          <Shot label="Auto Cortes · resultado">
            <MStack>
              <MRow>
                <MChip tone="lime">92</MChip>
                <MChip tone="dim">0:58</MChip>
                <MChip tone="dim">9:16</MChip>
              </MRow>
              <MRow>
                <MBtn tone="ghost">Pré-visualizar</MBtn>
                <MBtn tone="ghost">Ajustar</MBtn>
                <MBtn tone="ghost">Baixar</MBtn>
                <MBtn tone="ghost">Copiar textos</MBtn>
                <MBtn tone="ghost">SRT</MBtn>
              </MRow>
              <MRow>
                <MBtn tone="lime">Baixar todos (ZIP)</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Ajuste um corte',
        text: '"Ajustar" abre o editor daquele corte: puxe as bordas de início e fim pra pegar a frase inteira, reescreva o título e a headline, e clique em "Renderizar de novo" — só aquele corte é remontado. Se a mudança vale pra leva toda, use "Trocar legenda/headline" na barra: os cortes voltam a renderizar com o novo estilo sem refazer a análise. "Refazer análise" pede cortes novos aproveitando a transcrição que já existe, e "Retomar" volta de onde parou quando algo travou no meio. F5 não perde o trabalho: o projeto volta do jeito que estava — se a fonte foi upload, a página pede o mesmo arquivo de novo pra continuar.',
        visual: (
          <Shot label="Auto Cortes · editor">
            <MStack>
              <MField label="Headline" value="6 anos faturando: o segredo da consistência" grow />
              <MRow>
                <MBtn tone="primary">Renderizar de novo</MBtn>
                <MBtn tone="ghost">Trocar legenda/headline</MBtn>
                <MBtn tone="ghost">Refazer análise</MBtn>
                <MBtn tone="dark">Retomar</MBtn>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'Link do YouTube/Drive precisa da extensão 1.8.0 + Motor; upload não.',
      'Tudo roda no seu navegador — o vídeo não sobe pra nenhum servidor.',
      'Deixe a aba aberta; pode ficar em segundo plano.',
    ],
  },

  '/tools/decupagem-copy': {
    title: 'Remover Silêncios por Copy',
    tagline: 'A IA lê a sua copy, escolhe o melhor take de cada frase no vídeo bruto e audita o resultado.',
    steps: [
      {
        title: 'Envie o vídeo bruto',
        text: 'A gravação inteira, sem cortar nada antes — erros, repetições e retakes fazem parte do jogo: é desse material que a IA garimpa as melhores tomadas. Limites: 800 MB e 40 minutos (MP4, MOV, WEBM ou MKV). Passou do peso? Comprima primeiro na ferramenta Compressor.',
        visual: (
          <Shot label="Remover Silêncios por Copy · vídeo">
            <MDrop label="Selecione ou arraste um arquivo" sub="MP4, MOV, WEBM, MKV — até 800MB e 40min" />
          </Shot>
        ),
      },
      {
        title: 'Cole a copy frase por frase',
        text: 'No card "Copy / Script", cole o texto na ordem desejada, quebrando por linha ou pontuação — o rodapé mostra quantas frases foram detectadas. Cada frase é o que a IA procura no vídeo: se o locutor gravou a mesma frase três vezes, ela transcreve tudo, compara as tomadas e escolhe a mais limpa. Escreva as frases como foram realmente ditas.',
        visual: (
          <Shot label="Remover Silêncios por Copy · copy">
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
          <Shot label="Remover Silêncios por Copy · silêncios">
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
        text: 'O resultado aparece como "Remover Silêncios pronta · N cortes na ordem da copy", com player, o chip de auditoria ("auditado ✓ 12/12" é o cenário ideal) e a confiança da transcrição. Quer prova extra? "Transcrever (AssemblyAI)" re-transcreve o vídeo final pra você comparar com a copy. A lista "Cortes detectados" mostra frase por frase com o score de cada match — os itens marcados "revisar" merecem uma ouvida antes de usar. Tudo certo, clique em "Baixar MP4".',
        visual: (
          <Shot label="Remover Silêncios por Copy · laudo">
            <MStack>
              <MQueueItem name="Remover Silêncios pronta · 12 cortes" status="auditado ✓ 12/12" pct={100} tone="lime" />
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
        text: 'Na coluna "VÍDEOS", à esquerda, clique em "Subir vídeo" (até 300 MB). Ele aparece no centro, marcado como "FONTE".',
        visual: (
          <Shot label="Lipsync · vídeos">
            <MRow>
              <MBtn tone="ghost">Subir vídeo</MBtn>
              <MChip tone="violet">◇ Fonte</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'A regra número um',
        text: 'Rosto de frente, bem iluminado, sem mão na boca.',
      },
      {
        title: 'Suba o áudio novo',
        text: 'Em "Configure e gere", suba o áudio: a fala nova que esse rosto vai dizer. MP3, WAV, M4A ou até um MP4, com até 6 minutos. O "Limpar áudio" vem ligado e tira o ruído antes da sincronia.',
        visual: (
          <Shot label="Lipsync · configure e gere">
            <MRow>
              <MField label="Áudio" value="fala-nova.mp3" grow />
              <MToggle on label="Limpar áudio" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Clique em Gerar',
        text: 'Clique em "Gerar". O pedido vira um card em "MEUS LIPSYNCS", com a porcentagem ao vivo. Leva alguns minutos — e dá pra disparar outros enquanto espera.',
        visual: (
          <Shot label="Lipsync · meus lipsyncs">
            <MStack>
              <MBtn tone="primary">Gerar</MBtn>
              <MQueueItem name="LipSync 01" status="Renderizando… 42%" pct={42} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe o MP4',
        text: 'Ficou pronto? Baixe o MP4 pelo card.',
      },
    ],
    tips: [
      'Use sempre vídeos que você tem autorização pra usar.',
      'Iluminação uniforme ajuda mais que resolução alta (luz lateral cria sombra que engana a sincronia). 720p ou mais deixa a boca nítida.',
      'Vídeo com menos de 2 segundos de rosto é bloqueado; áudio acima de 6 minutos precisa ser dividido em partes.',
      'O preview central mostra sempre a FONTE — o resultado aparece nos cards de "Meus LipSyncs". Deu falha? "↻ Tentar de novo" re-roda com os mesmos arquivos.',
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
    title: 'Normalizador de Áudio',
    tagline: 'Duas ou mais vozes em volumes diferentes saem no mesmo nível — e o chiado de fundo vai embora.',
    steps: [
      {
        title: 'Adicione os arquivos',
        text: 'No card "Arquivos", adicione até 10, de vídeo ou de áudio (MP3, WAV, MP4, WEBM ou MOV).',
        visual: (
          <Shot label="Normalizador · arquivos">
            <MDrop label="Arraste ou clique pra subir" sub="Até 10 · MP3, WAV, MP4, WEBM ou MOV" />
          </Shot>
        ),
      },
      {
        title: 'Escolha a saída',
        text: 'No card "Formato de saída": MP4 mantém o vídeo e trata só a trilha de áudio; MP3 e WAV, só o som. Com um áudio na fila, o MP4 fica bloqueado.',
        visual: (
          <Shot label="Normalizador · formato de saída">
            <MRow>
              <MChip tone="violet">MP4</MChip>
              <MChip tone="dim">MP3</MChip>
              <MChip tone="dim">WAV</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Clique em Normalizar',
        text: 'Clique em "Normalizar N". Ele limpa o ruído, analisa a voz… e nivela tudo, sem estourar os picos.',
        visual: (
          <Shot label="Normalizador · processar">
            <MBtn tone="primary">Normalizar 2</MBtn>
          </Shot>
        ),
      },
      {
        title: 'Leia o relatório',
        text: 'O relatório mostra o antes e o depois: a "Onda sonora"… e a "Curva de volume da voz", agora reta. E os números: "Volume médio", "Oscilação da voz", "Pico" e "Ruído de fundo".',
        visual: (
          <Shot label="Normalizador · relatório">
            <MRow>
              <MField label="Volume médio" value="−24 → −16" />
              <MField label="Oscilação da voz" value="−62%" />
              <MField label="Pico" value="protegido" />
              <MField label="Ruído de fundo" value="−18 dB" />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Compare de ouvido',
        text: 'Quer ouvir a diferença? No "Comparar de ouvido", alterne entre o antes e o depois.',
        visual: (
          <Shot label="Normalizador · comparar">
            <MRow>
              <MChip tone="dim">Antes</MChip>
              <MChip tone="violet">Depois</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Baixe',
        text: 'Baixe cada arquivo ("Baixar MP4/MP3/WAV") ou todos com "Baixar ZIP (N)". O nome sai com "_normalizado" no final.',
      },
    ],
    tips: [
      'O caso clássico: dois locutores gravaram em volumes diferentes e precisam sair no mesmo patamar pra edição não denunciar.',
      'Se a voz oscila MUITO (um trecho sussurrado, outro gritado), o motor reforça o nivelamento sozinho — sem inflar o ruído das pausas.',
      'Com vídeo na fila e saída em MP3/WAV, a imagem é descartada e sai só o áudio normalizado.',
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
        text: 'Cada card mostra a fase ("Na fila" → "Disparando" → "Renderizando" → "Baixando" → "Pos-prod (concat/remoção de silêncios/camo)" → "Concluido"), a porcentagem, e o raio-X das partes: quantas foram disparadas, renderizadas e quantas falharam. O "✕ Cancelar" para uma task; "Remover" tira do painel sem apagar arquivos já baixados.',
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
              <MQueueItem name="AD140GL.mp4 · Remover Silêncios" status="PRONTO · 11:05" pct={100} tone="violet" />
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
              <MChip tone="dim">SILÊNCIOS · 6</MChip>
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
        title: 'Ajuste os modos extra: Remover Silêncios e Camuflagem',
        text: 'A "Remover Silêncios" vem LIGADA: o vídeo montado sai com os silêncios e respiros já cortados, com intensidade ajustável ("Agressivo · 0.05s", "Padrão · 0.12s" ou "Suave · 0.20s"). A "Camuflagem" vem desligada; ligando, você sobe o áudio escondido e define o volume — e o disparo entrega também a versão camuflada de cada vídeo montado.',
        visual: (
          <Shot label="Hey Auto · modos extra">
            <MStack>
              <MRow>
                <MToggle on label="Remover Silêncios ON" />
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
        text: '"+ Adicionar config atual à fila" captura o AD inteiro (avatar, voz, motor, estrutura, remoção de silêncios, camuflagem) como um item — monte quantos quiser antes de disparar. Depois, "▶ Processar fila (N)" roda tudo sozinho, item por item: disparo das partes no HeyGen, renderização, download e montagem final. O card de cada item mostra a fase ao vivo (Enviando → Renderizando → Baixando → Montando → Pronto). Pra um AD único, o botão "Gerar todas as partes via HeyGen" dispara direto, sem fila — e também termina sozinho.',
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
    title: 'Pilot',
    tagline:
      'A copy pode vir do zero, de um Google Docs ou das tasks do ClickUp. O Pilot prepara avatar e voz, dispara no HeyGen e entrega o vídeo montado, em fila.',
    size: 'large',
    steps: [
      {
        title: 'Escolha de onde vem a task',
        text: 'No topo da página fica o trilho com três modos. CREATOR: você monta o AD do zero, escrevendo a copy aqui mesmo. DOCS: você importa um Google Docs e todos os ADs dele viram tasks. CLICKUP: as tasks vêm da fila do editor no ClickUp, como sempre. Cada modo tem a própria tela: as tasks, as análises e a fila em produção de um modo nunca aparecem no outro, e tudo fica salvo neste navegador, inclusive depois de recarregar a página.',
        visual: (
          <Shot label="Pilot · trilho de modos">
            <MRow>
              <MChip tone="amber">CREATOR</MChip>
              <MChip tone="dim">DOCS</MChip>
              <MChip tone="lime">CLICKUP</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Creator: monte o AD do zero',
        text: 'Clique no botão "+" e uma task nova aparece já com o card de análise aberto (AD01, AD02 e assim por diante; o lápis ao lado do nome renomeia). Primeiro adicione o avatar em "Adicionar outro avatar" e escolha avatar e voz. Depois clique no lápis do avatar: no primeiro avatar você escreve os hooks (um por caixa, até dez; cada hook vira um vídeo, todos com o mesmo body) e o body; os outros avatares entram só no body. Sem hook, sai um vídeo só com o body. Escolha "Smart Division" para cortar o body em takes de cerca de vinte segundos ou "Sem divisão" para manter o body inteiro; no Avatar IV ou V o bloco sempre vai inteiro. Clique em "Montar takes" e use o olho para ajustar take por take.',
        visual: (
          <Shot label="Creator · copy do avatar">
            <MStack>
              <MField label="Hook 1" value="Você usa azeite todo dia e nunca soube que ele pode virar remédio." grow />
              <MField label="Hook 2" value="Meu tio de 71 anos me contou esse truque em segredo." grow />
              <MField label="Body" value="A maioria usa azeite do jeito errado e joga fora a parte que importa..." grow />
              <MRow><MBtn tone="primary">Smart Division</MBtn><MBtn>Sem divisão</MBtn><MBtn tone="primary">Montar takes</MBtn></MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Docs: importe o Google Docs',
        text: 'Cole o link do doc e clique em "Carregar tasks", ou importe o arquivo (.docx ou .txt), arrastando ou pelo botão de upload. Cada heading no padrão "AD12VN - NOME" vira uma task, igual ao ClickUp. Os docs importados ficam em cartões: clique num deles pra voltar às tasks dele, ou no "×" pra remover o doc e as tasks. O idioma é detectado por task: quando o doc traz polonês ou húngaro, o português é a tradução e a voz sai na outra língua; o botão "usar português" no card troca só aquela task.',
        visual: (
          <Shot label="Docs · importar">
            <MStack>
              <MDrop label="Link do Google Docs ou arquivo .docx" sub="Arraste o arquivo ou cole o link." />
              <MQueueItem name="AD11VN - VRWA07" status="docs" pct={100} tone="violet" />
              <MQueueItem name="AD12VN - VRWA07" status="docs" pct={100} tone="violet" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'ClickUp: o fluxo de sempre',
        text: 'Configure uma vez em "Configurar": o token pessoal do ClickUp (fica só no seu navegador), o workspace e o editor. Depois clique em "Carregar tasks": a lista chega com o nome exato do ClickUp, ordenada por vencimento. O botão redondo com o olho inclui as tasks em revisão. Com duas empresas no mesmo login, o seletor de empresa troca a lista, e a fila em produção mostra só a empresa ativa. Filtros de período e prioridade, empresa e link do doc só existem neste modo.',
        visual: (
          <Shot label="ClickUp · conexão">
            <MRow>
              <MChip tone="lime">PILOT ONLINE</MChip>
              <MField label="Empresa" value="B2C" grow />
              <MField label="Editor" value="Silas" grow />
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Analise e ajuste cada task',
        text: 'Marque as tasks e clique em "Start": o Pilot lê a copy de cada uma, separa hooks e body em takes, identifica os avatares e monta o card. Puxou três e mudou de ideia? Marque mais uma a qualquer momento: ela entra sem reiniciar o que já está rodando. No card você escolhe avatar e voz por papel, o motor (III, IV ou V), a remoção de silêncios e a intensidade do corte, o Normalizador de Áudio, a legenda automática, o zoom, os inserts, a headline e a camuflagem. Em "+ versões" cada versão pode ter pós-produção própria: uma com remoção de silêncios, outra sem; inserts e legendas diferentes. Tudo isso fica salvo sozinho: recarregou a página, o card volta como estava.',
        visual: (
          <Shot label="Pilot · análise">
            <MStack>
              <MRow>
                <MField label="Avatar" value="escolhido" grow />
                <MField label="Voz" value="Bianca" grow />
                <MChip tone="lime">PRONTA</MChip>
              </MRow>
              <MRow>
                <MToggle on={true} label="Remover Silêncios" />
                <MToggle on={true} label="Legenda" />
                <MChip tone="dim">MOTOR III</MChip>
              </MRow>
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Dispare e acompanhe',
        text: 'O botão de play no card dispara aquela task; "Iniciar N tasks em background" dispara todas as prontas. Todo disparo no HeyGen sai por aqui, em fila e em segundo plano: envia take por take, acompanha a renderização, baixa, monta e aplica a pós-produção. O painel "Tasks em produção" mostra as fases (na fila, enviando, renderizando, baixando, montando, pronto), e cada card tem pausar, retomar e remover. A mesma fila aparece em "Tarefas em segundo plano".',
        visual: (
          <Shot label="Pilot · fila">
            <MStack>
              <MBtn tone="primary">Iniciar 2 tasks em background</MBtn>
              <MQueueItem name="AD15VN · take 2/4" status="Renderizando" pct={38} />
              <MQueueItem name="AD16VN" status="Na fila" pct={0} />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Receba o vídeo montado',
        text: 'Task pronta é vídeo pronto: o botão "Baixar MP4" entrega o lipsync montado, um vídeo por hook, com remoção de silêncios, legenda e o resto do que você ligou. O nome do arquivo vem do AD da task. Faltou alguma parte? O "Retomar" completa só o que falta, sem gerar de novo o que já ficou pronto.',
        visual: (
          <Shot label="Pilot · entrega">
            <MStack>
              <MQueueItem name="AD15VN_PRPB06 · G1 montado" status="Pronto" pct={100} tone="lime" />
              <MQueueItem name="AD15VN_PRPB06 · G2 montado" status="Pronto" pct={100} tone="lime" />
              <MBtn tone="lime">Baixar MP4</MBtn>
            </MStack>
          </Shot>
        ),
      },
    ],
    tips: [
      'Pré-requisitos: a extensão Auto Edit instalada e uma aba logada no HeyGen. O disparo roda pela sua conta, sem custo extra por vídeo.',
      'Creator e Docs vivem neste navegador: as tasks, os docs e as análises ficam salvos aqui, inclusive depois de recarregar.',
      'F5 no meio do disparo não perde nada: o plano fica salvo e a task retoma do ponto em que parou.',
      'Travou no meio do dia? Costuma ser o limite diário do HeyGen. O Retomar continua depois do reset, sem gerar de novo o que já ficou pronto.',
      'Avatar de outro workspace do HeyGen aparece como "not accessible": troque o workspace na aba do HeyGen e retome.',
      'O Pilot nunca escreve no seu ClickUp, só lê.',
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
  '/tools/famous-hey': {
    title: 'Famous Hey',
    tagline:
      'Anima uma foto direto no HeyGen, sem cadastrar avatar na biblioteca. Um take, uma fala.',
    steps: [
      {
        title: 'Suba a imagem',
        text: 'JPEG, PNG ou WebP até 4MB. Rosto de frente, bem iluminado e sem nada cobrindo a boca é o que rende melhor. Não precisa cadastrar avatar nenhum — a imagem é enviada direto na geração, e como não existe objeto de avatar, não existe likeness pra moderação reprovar. É exatamente por isso que rosto reprovado no caminho normal funciona aqui.',
        visual: (
          <Shot label="Famous Hey · imagem">
            <MRow>
              <MChip tone="lime">IMAGEM CARREGADA</MChip>
              <MChip tone="dim">SEM AVATAR NA BIBLIOTECA</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Escolha de onde vem a fala',
        text: '"Escrever o texto" — você digita e escolhe uma voz da sua conta HeyGen; ele sintetiza. "Usar um áudio" — seu arquivo entra como está e a boca sincroniza com ele, mantendo a voz original. Os dois nunca vão juntos: o HeyGen recusa o disparo quando recebe texto e áudio na mesma chamada.',
        visual: (
          <Shot label="Famous Hey · a fala">
            <MRow>
              <MBtn tone="primary">Escrever o texto</MBtn>
              <MBtn tone="ghost">Usar um áudio</MBtn>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Espelhar voz — o que ela faz de verdade',
        text: 'Marcando "Espelhar voz" no modo áudio, a ferramenta transcreve o arquivo, mostra o texto pra VOCÊ REVISAR, e a voz escolhida fala. As palavras são as mesmas; a cadência passa a ser a da voz nova, não a do áudio original. O Mirror Voice speech-to-speech do HeyGen exige um avatar cadastrado — ele não alcança o modo imagem, e é justamente a ausência de avatar que faz esta ferramenta existir. Revise nomes próprios e números antes de gerar: é o texto que vai ao ar.',
        visual: (
          <Shot label="Famous Hey · espelhar voz">
            <MRow>
              <MBtn tone="ghost">Transcrever o áudio</MBtn>
              <MChip tone="amber">REVISE ANTES DE GERAR</MChip>
            </MRow>
          </Shot>
        ),
      },
      {
        title: 'Gere um por vez e acompanhe',
        text: 'A ferramenta gera UM vídeo por vez de propósito: a renovação do login do HeyGen não tolera disparos em paralelo — duas gerações juntas derrubam a sessão. Enquanto roda, o card mostra o tempo decorrido; pode trocar de aba, porque o relógio do acompanhamento roda em Worker e o navegador não o estrangula. F5 no meio também não perde nada: ao voltar, a ferramenta retoma o acompanhamento sozinha.',
        visual: (
          <Shot label="Famous Hey · gerando">
            <MStack>
              <MQueueItem name="AD77 · hook" status="gerando" pct={60} tone="amber" />
            </MStack>
          </Shot>
        ),
      },
      {
        title: 'Baixe, refaça, repita',
        text: 'Quando fica pronto, o vídeo é baixado pro seu navegador na hora — por isso "Baixar" continua funcionando depois, mesmo quando o link do HeyGen já saiu do ar. "Ver" abre o player ali mesmo. "Refazer" recarrega a ficha inteira no formulário (imagem inclusive) pra você corrigir o texto, trocar a voz ou só gerar de novo com outro ajuste.',
        visual: (
          <Shot label="Famous Hey · histórico">
            <MRow>
              <MBtn tone="lime">Baixar</MBtn>
              <MBtn tone="ghost">Ver</MBtn>
              <MBtn tone="dark">Refazer</MBtn>
            </MRow>
          </Shot>
        ),
      },
    ],
    tips: [
      'O histórico fica NESTE navegador (os 30 mais recentes). Trocou de máquina, não vai ver — baixe o que importa.',
      'A geração cobra do crédito do PLANO (login OAuth), não do saldo de API.',
      'O banner no topo avisa antes de disparar quando o login do HeyGen expirou ou quando as vozes e a geração estão em contas diferentes.',
    ],
  },
};

# DARKO LAB — HeyGen Auto (Chrome Extension)

Automacao da geracao de avatares HeyGen direto da sua conta logada.
Sem consumir API publica (usa sua mensalidade HeyGen).

## Como instalar

1. Baixa o ZIP da extensao no DARKO LAB → ferramenta HeyGen Auto Avatar → "Como instalar"
2. Descompacta a pasta no seu computador
3. Abre o Chrome e vai em `chrome://extensions`
4. Liga **Modo de desenvolvedor** (canto superior direito)
5. Clica **Carregar sem compactacao**
6. Seleciona a pasta descompactada
7. A extensao "DARKO LAB — HeyGen Auto" deve aparecer ativa
8. Faz login no HeyGen normalmente em outra aba (https://app.heygen.com)
9. Volta no DARKO LAB → ferramenta HeyGen Auto Avatar — deve detectar a extensao automaticamente

## Como usar

### Atualização 4.46.1 — integração StockFrame + Smart Stocks

O botão StockFrame fica ao lado do Google Flow no card do Pilot. Cada usuário
precisa ter a própria conta **paga e ativa** no StockFrame e gerar uma chave em
**Meu perfil e API**. A chave fica somente no `chrome.storage.local` da extensão;
ela nunca é salva no servidor do Auto Edit nem exposta à página.

A integração lista e baixa apenas o conteúdo que a conta já pode acessar. Ela
não libera vídeos fora do plano: os downloads descontam da cota diária normal do
StockFrame. O Pilot bloqueia a conexão quando a API informa plano inativo,
expirado ou sem cota contratada.

Na Biblioteca, escolha um trecho da copy e visualize o take antes de inserir.
O Smart Stocks analisa a copy localmente, sem API de IA paga, oferece cobertura
de 30%, 60% ou 100% e ritmo rápido, longo ou inteligente. A análise não consome
download; a cota só é usada depois de revisar o plano e clicar em aplicar.

### Atualização 4.44.3 — inserts do Google Flow

O módulo Flow usa arquivos, fila e aba de automação próprios. O funcionamento
do HeyGen permanece nos seus scripts existentes. O Pilot identifica uma única
instalação ativa antes de encaminhar cada pedido de geração.

Abra um projeto do Google Flow na conta desejada. No Pilot, abra **Inserts do
Flow**, confira nome, e-mail e saldo da conta, configure o insert e atualize a
previsão de créditos. A extensão lê os controles e o custo apresentados pelo
próprio Flow antes de enviar o pedido. Se a conta, o custo ou a configuração
não puderem ser confirmados, a geração é interrompida antes do envio.

O download solicita **1080p aprimorada** para vídeos e **2K aprimorada** para
imagens. O Pilot abre o arquivo recebido e confere suas dimensões antes de
inseri-lo na montagem. Quando o Flow não oferece a opção necessária, o módulo
preserva o resultado na galeria e informa o problema.

Uma geração já enviada ao Google pode continuar após cancelar o acompanhamento
no Pilot. Um pedido com resposta incerta nunca é enviado outra vez
automaticamente. Confira o projeto no Flow antes de iniciar uma nova geração.

Depois de atualizar a extensão, recarregue o Pilot. O novo módulo precisa de
permissão para acessar o Google Flow e seus arquivos de mídia. A extensão usa
a sessão Google já conectada no navegador e não solicita sua senha.

### Correção de sessão do Pilot — 4.41.2

As consultas e gerações usam o workspace ativo escolhido no HeyGen. Uma
recusa de autenticação permite uma única tentativa com a sessão da própria
aba. Nenhuma credencial sai do HeyGen para o Pilot ou para URLs de mídia.
Exigências de telefone, SSO e permissão recebem mensagens específicas;
o diagnóstico guarda somente os códigos da resposta e a versão da extensão.

### Atualização 4.41.1 — instalação e modo economia no Pilot

O Pilot mostra **Baixar extensão** quando ela está ausente e **Baixar atualização**
quando a versão é antiga. Com a versão atual conectada, o aviso fica oculto.
A verificação consulta o serviço ativo da extensão para não confundir um script
antigo da aba com uma instalação ativa depois de remover ou recarregar.

Baixe o ZIP atual e substitua os arquivos da pasta da extensão. Em
`chrome://extensions`, clique em **Recarregar** no card **Hey Auto** e depois
recarregue as abas do Pilot e do HeyGen. Espere as gerações atuais terminarem
antes de atualizar. Mantenha apenas uma instalação ativa da extensão.

O modo economia verifica a sessão e o workspace de cada conta antes de
renderizar. No primeiro uso, pode abrir o Studio para preparar a primeira
cena. Conclua eventuais avisos de entrada do próprio HeyGen.

O workspace precisa permitir **Render Scene**. O plano gratuito do HeyGen
recusa essa operação; liberar o Pilot não altera os recursos do plano HeyGen.

### Geração de avatares

1. Na ferramenta HeyGen Auto Avatar:
   - Escolhe o motor (Avatar III/IV/V)
   - Busca o avatar pelo nome (preview com thumbnail)
   - Cole a copy ou faz upload dos audios divididos
   - Clica "Gerar todas as partes via HeyGen"
2. A extensao automatiza o HeyGen no fundo, parte por parte
3. No final, baixa um ZIP com `parte1.mp4`, `parte2.mp4`, ... organizados na ordem certa

## Requisitos

- Google Chrome (ou navegador baseado em Chromium — Edge, Brave, etc)
- Conta HeyGen ativa com acesso à operação escolhida (Render Scene para o modo economia)
- Estar logado no HeyGen no momento de gerar

## Privacidade

A extensao:
- Acessa HeyGen, Google Flow, StockFrame, os arquivos de mídia e documentos
  Google usados pelo Pilot, além do site DARKO LAB
- NAO envia suas credenciais pra nenhum servidor (tudo roda local + sua sessao HeyGen)
- A automação do Flow usa uma aba própria e identifica a conta antes de gerar
- A chave StockFrame vai apenas para a API oficial e permanece no armazenamento local da extensão
- Codigo aberto — voce pode auditar todos os arquivos

## Troubleshooting

**"Extensao nao detectada"**
- Verifica se ela esta ativada em `chrome://extensions`
- Recarrega a pagina do DARKO LAB
- Se persistir, remove e reinstala

**"HeyGen rejeitou a request — login pode ter expirado"**
- Vai em https://app.heygen.com e re-loga
- Volta na ferramenta e tenta de novo

**"Aba HeyGen nao respondeu"**
- A extensao precisa de pelo menos 1 aba HeyGen aberta. Abre uma e tenta de novo.

## Versao

2.7.0 — generate: tenta endpoints .private (api2.heygen.com) primeiro com SIMPLE REQUEST sem Authorization/X-Requested-With (evita CORS preflight bloqueado). Logs detalhados de cada tentativa pro DevTools mostrar status code + body snippet. Mensagem de erro pede captura da URL real via Network tab pra confirmacao.
2.6.2 — push pattern: content script empurra HG_TAB_AVATARS_RESULT via runtime.sendMessage em vez de responder via sendResponse. Background fire-and-forget + listener correlado por requestId. Elimina o erro 'channel closed before a response was received' causado por SW background hibernando durante await chrome.tabs.sendMessage de operacoes longas (3s+).
2.6.1 — guard contra injecao dupla do heygen-content.js (window.__darkolab_heygen_loaded__). Quando o content script era injetado 2x (manifest + auto-inject), os 2 listeners retornavam true e o canal fechava com "channel closed before a response was received" mesmo apos sendResponse ter sido chamado pelo primeiro.
2.6.0 — hierarquia AVATAR (grupo) -> LOOKS espelhada da UI HeyGen "Choose an Avatar". Lista mostra os AVATARES (Emma, Johan, etc) com nome HeyGen exato + badge "N looks". Click abre drawer com todos os looks daquele avatar (Radiant Redhead, Photo Avatar, etc). Selecao retorna o look.id real usado pra geracao.
2.5.1 — restore truncated background.js + bridge.js (service worker registration failed).
2.5.0 — FIX CRITICO: campo `source` do payload (URL do endpoint HeyGen) sobrescrevia `source: 'darkolab-ext'` no envelope do postMessage. Page filtrava a msg fora silenciosamente -> timeout 90s. Fix em 2 lugares: (1) background renomeou `source` -> `apiSource` no payload; (2) bridge sendToPage agora poe `source: 'darkolab-ext'` DEPOIS do spread (defesa em profundidade pra qualquer payload futuro que tenha campo `source`).
2.4.0 — diagnostic full-chain logs (page <-> bridge <-> background <-> heygen-content) pra rastrear onde a mensagem morre + page timeout 30s -> 90s.
2.3.0 — looks em PARALELO (Promise.all) + skip v2 (sempre 404). Tempo de ~3min pra ~5s. 100 avatares carregam em segundos.
2.2.3 — desembrulha wrapper { look_type, look } (HeyGen aninha o objeto real em .look) + log SAMPLE look REAL.
2.2.2 — findIdField/findNameField/findThumbField (extrai de QUALQUER campo *_id/_key) + log SAMPLE look struct.
2.2.1 — looks fetch sequencial (evita deadlock) + logs STEP-by-STEP pra debug.
2.2.0 — fix listing: data.avatar_groups (plural) + busca avatar_look.private.list por grupo (mostra cada look individual igual UI HeyGen).
2.1.1 — simple request (sem headers customizados, evita CORS preflight) + log per-endpoint sempre.
2.1.0 — endpoints em PARALELO (5s max em vez de 30s seq) + log diagnostico de keys da resposta.
2.0.1 — icone do coelho DARKO LAB (16/32/48/128px).
2.0.0 — content script auto-injection (resolve "Could not establish connection") + PING handshake.
1.9.0 — endpoint REAL confirmado: api2.heygen.com/v2/avatar_group.private.list (subdominio correto).
1.8.0 — fetch com timeout 6s + auth headers expandidos + log diagnostico + erros detalhados.
1.7.0 — endpoints REAIS HeyGen confirmados (avatar_group.private.list + avatar_look.private.list).
1.6.0 — listMyVoices (mesmo padrao avatares), avatar_style fixo "normal", logging endpoint usado.
1.5.0 — fix 

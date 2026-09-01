#!/bin/bash
#
# Auto Edit - Motor do Downloader (macOS)
#
# Instala o motor local que baixa YouTube / Pinterest / TikTok-audio no
# proprio Mac do cliente. Equivalente do AutoEditDownloaderSetup.exe.
#
# POR QUE E UM COMANDO DE TERMINAL E NAO UM .pkg/.app:
#   A flag com.apple.quarantine (a que dispara o Gatekeeper "desenvolvedor
#   nao verificado") e posta pelo NAVEGADOR no arquivo baixado. Binario que
#   o curl baixa de dentro deste script NAO recebe quarantine. Resultado:
#   zero tela de bloqueio, zero notarizacao, zero conta Apple Developer.
#   E o mesmo caminho de Homebrew / nvm / rustup / Ollama.
#
# Uso:
#   curl -fsSL https://SITE/api/downloader-engine/mac | bash
#   curl -fsSL https://SITE/api/downloader-engine/mac | bash -s -- --uninstall
#
# Compatibilidade: escrito pro bash 3.2 que vem de fabrica no macOS.
# Nada de array associativo, ${var,,}, mapfile ou &>>.

set -u

SITE="${AUTOEDIT_SITE:-__SITE__}"
NODE_VER="v22.11.0"
FFMPEG_TAG="b6.1.1"
LABEL="com.autoedit.downloader"
BASE="$HOME/Library/Application Support/AutoEditDownloader"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$BASE/engine.log"
PORT_DEFAULT=47923

# ---------------------------------------------------------------- cores
if [ -t 1 ]; then
  B=$(printf '\033[1m'); DIM=$(printf '\033[2m'); R=$(printf '\033[0m')
  OK=$(printf '\033[32m'); ERR=$(printf '\033[31m'); WARN=$(printf '\033[33m')
  LIME=$(printf '\033[92m')
else
  B=""; DIM=""; R=""; OK=""; ERR=""; WARN=""; LIME=""
fi

say()  { printf '%s\n' "$*"; }
step() { printf '%s>%s %s\n' "$LIME" "$R" "$*"; }
good() { printf '  %sOK%s   %s\n' "$OK" "$R" "$*"; }
bad()  { printf '  %sFALHA%s %s\n' "$ERR" "$R" "$*"; }
warn() { printf '  %s!%s    %s\n' "$WARN" "$R" "$*"; }

fatal() {
  say ""
  bad "$1"
  say ""
  say "  Nada foi deixado pela metade - da pra rodar o comando de novo."
  say "  Se persistir, manda esta tela pro suporte do Auto Edit."
  say ""
  exit 1
}

# ------------------------------------------------------------ preflight
if [ "$(uname -s)" != "Darwin" ]; then
  fatal "Este instalador e do macOS. Neste sistema, use o instalador da pagina."
fi

# Apple Silicon x Intel. Rodando sob Rosetta o uname mente (diz x86_64),
# entao hw.optional.arm64 e quem decide de verdade.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
  ARCH="arm64"; CHIP="Apple Silicon"
else
  ARCH="x64"; CHIP="Intel"
fi

command -v curl >/dev/null 2>&1 || fatal "curl nao encontrado neste Mac."
command -v tar  >/dev/null 2>&1 || fatal "tar nao encontrado neste Mac."

# --------------------------------------------------------- desinstalar
uninstall() {
  say ""
  say "${B}Auto Edit - Removendo o Motor${R}"
  say ""
  step "Parando o motor..."
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 \
    || launchctl bootout "user/$(id -u)/$LABEL" >/dev/null 2>&1 \
    || launchctl unload -w "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  good "servico removido"

  step "Apagando arquivos..."
  rm -rf "$BASE"
  good "$BASE"

  # config.json fica em ~/.config/DarkoDownloader (configDir do server.ts)
  rm -rf "$HOME/.config/DarkoDownloader"
  good "configuracao removida"

  say ""
  say "  ${OK}Motor removido.${R} A extensao do Chrome continua instalada."
  say ""
  exit 0
}

if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "-u" ]; then
  uninstall
fi

# ------------------------------------------------------------- cabecalho
say ""
say "${B}  Auto Edit - Motor do Downloader${R}"
say "  ${DIM}macOS $(sw_vers -productVersion 2>/dev/null || echo '?') - $CHIP ($ARCH)${R}"
say ""

TMP="$(mktemp -d /tmp/autoedit-motor.XXXXXX)" || fatal "nao consegui criar pasta temporaria"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# Baixa com barra de progresso e falha em HTTP >=400 (-f). Sem -f, um 404
# vira arquivo de HTML salvo como se fosse binario - o bug classico.
fetch() {
  # $1 = url, $2 = destino, $3 = rotulo
  curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 900 \
       --progress-bar -o "$2" "$1"
}

# ------------------------------------------------- 1. parar motor antigo
step "Preparando..."
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 \
  || launchctl unload -w "$PLIST" >/dev/null 2>&1 || true
mkdir -p "$BASE/bin" "$BASE/node" "$HOME/Library/LaunchAgents" || fatal "sem permissao de escrita em $BASE"
good "pasta pronta"

# ------------------------------------------------------------ 2. Node
step "Baixando Node $NODE_VER ($ARCH)..."
NODE_TGZ="$TMP/node.tar.gz"
NODE_URL="https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-darwin-$ARCH.tar.gz"
fetch "$NODE_URL" "$NODE_TGZ" || fatal "nao consegui baixar o Node ($NODE_URL)"
# so o binario interessa - npm/lib nao sao usados pelo motor
tar -xzf "$NODE_TGZ" -C "$BASE/node" --strip-components=2 \
    "node-$NODE_VER-darwin-$ARCH/bin/node" 2>/dev/null \
  || fatal "o pacote do Node veio corrompido"
chmod +x "$BASE/node/node"
good "node"

# ----------------------------------------------------------- 3. yt-dlp
step "Baixando yt-dlp (standalone, sem Python)..."
fetch "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" \
      "$BASE/bin/yt-dlp" || fatal "nao consegui baixar o yt-dlp"
chmod +x "$BASE/bin/yt-dlp"
good "yt-dlp"

# ----------------------------------------------------------- 4. ffmpeg
step "Baixando ffmpeg ($ARCH)..."
FF_GZ="$TMP/ffmpeg.gz"
fetch "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_TAG/ffmpeg-darwin-$ARCH.gz" \
      "$FF_GZ" || fatal "nao consegui baixar o ffmpeg"
gunzip -c "$FF_GZ" > "$BASE/bin/ffmpeg" || fatal "ffmpeg veio corrompido"
chmod +x "$BASE/bin/ffmpeg"
good "ffmpeg"

# -------------------------------------------------------- 5. server.cjs
step "Baixando o motor..."
fetch "$SITE/api/downloader-engine/mac?part=server" "$BASE/server.cjs" \
  || fatal "nao consegui baixar o motor de $SITE"
# Guard honesto: tamanho sozinho mente (uma pagina de erro pode ser
# grande, e o bundle real tem so ~37KB). O identificador do motor nao.
SRV_SIZE=$(wc -c < "$BASE/server.cjs" | tr -d ' ')
if [ "$SRV_SIZE" -lt 10000 ] || ! grep -q 'darkolab-downloader-engine' "$BASE/server.cjs"; then
  fatal "o motor baixado veio invalido ($SRV_SIZE bytes) - tente de novo"
fi
good "server.cjs ($((SRV_SIZE / 1024)) KB)"

# ------------------------------------------- 6. assinatura ad-hoc + xattr
# No Apple Silicon o kernel recusa executar Mach-O sem NENHUMA assinatura.
# Node e yt-dlp ja vem assinados pelos projetos; o ffmpeg estatico nem
# sempre. Assinar ad-hoc (-s -) e local, gratuito e nao exige conta Apple.
step "Liberando os binarios no macOS..."
xattr -dr com.apple.quarantine "$BASE" >/dev/null 2>&1 || true
if command -v codesign >/dev/null 2>&1; then
  for b in "$BASE/node/node" "$BASE/bin/yt-dlp" "$BASE/bin/ffmpeg"; do
    codesign --force --sign - "$b" >/dev/null 2>&1 || true
  done
  good "assinados ad-hoc"
else
  warn "codesign ausente - se algum binario nao rodar, instale as Command Line Tools"
fi

# --------------------------------------------------------- 7. launcher
step "Instalando o servico..."
cat > "$BASE/run.sh" <<RUNSH
#!/bin/bash
# Launcher do Motor - chamado pelo launchd. Nao editar na mao.
HERE="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export YTDLP_PATH="\$HERE/bin/yt-dlp"
export FFMPEG_PATH="\$HERE/bin/ffmpeg"
export PATH="\$HERE/bin:\$PATH"
: "\${DARKO_ALLOW_ADULT:=1}"
export DARKO_ALLOW_ADULT
echo "[\$(date '+%Y-%m-%d %H:%M:%S')] start"
exec "\$HERE/node/node" "\$HERE/server.cjs"
RUNSH
chmod +x "$BASE/run.sh"

cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BASE/run.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLISTXML

# Tres tentativas, da mais moderna pra mais antiga:
#   gui/<uid>  - sessao grafica (o caso normal do cliente)
#   user/<uid> - sem sessao grafica (SSH, terminal remoto, runner de CI)
#   load -w    - legado, macOS antigo
# So gui/ falharia em Mac acessado por SSH; sem o user/ o instalador
# morreria ali por um motivo que nao tem nada a ver com o cliente.
launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 \
  || launchctl bootstrap "user/$(id -u)" "$PLIST" >/dev/null 2>&1 \
  || launchctl load -w "$PLIST" >/dev/null 2>&1 \
  || fatal "o launchd recusou o servico (veja $LOG)"
good "servico no ar (sobe sozinho no login)"

# ------------------------------------------------------- 8. AUTO-TESTE
say ""
step "Conferindo se ficou tudo funcionando..."
FAILED=0

# 8.1 binarios executam de verdade neste Mac
YTV="$("$BASE/bin/yt-dlp" --version 2>/dev/null | head -1)"
if [ -n "$YTV" ]; then good "yt-dlp executa (versao $YTV)"; else bad "yt-dlp nao executa"; FAILED=1; fi

if "$BASE/bin/ffmpeg" -version >/dev/null 2>&1; then
  good "ffmpeg executa"
else
  bad "ffmpeg nao executa"; FAILED=1
fi

if "$BASE/node/node" -e 'process.exit(0)' >/dev/null 2>&1; then
  good "node executa"
else
  bad "node nao executa"; FAILED=1
fi

# 8.2 o motor subiu e responde - o launchd pode levar alguns segundos
PORT=""
i=0
while [ $i -lt 30 ]; do
  p=$PORT_DEFAULT
  while [ $p -le 47931 ]; do
    # --connect-timeout 1: porta fechada em localhost recusa na hora, mas
    # porta ocupada por outro processo mudo penduraria a varredura e faria
    # o "30s" da mensagem virar minutos.
    if curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:$p/health" 2>/dev/null | grep -q 'darkolab-downloader-engine'; then
      PORT=$p; break
    fi
    p=$((p + 1))
  done
  [ -n "$PORT" ] && break
  sleep 1
  i=$((i + 1))
done

if [ -n "$PORT" ]; then
  good "motor respondendo na porta $PORT"
else
  bad "o motor nao respondeu em 30s"
  FAILED=1
fi

# 8.3 pareamento: e exatamente a chamada que a extensao faz
if [ -n "$PORT" ]; then
  PAIR="$(curl -fsS --max-time 5 -H 'Origin: chrome-extension://selftest' \
          "http://127.0.0.1:$PORT/pair" 2>/dev/null)"
  if printf '%s' "$PAIR" | grep -q '"token"'; then
    good "pareamento com a extensao"
  else
    bad "o motor nao entregou o token de pareamento"
    FAILED=1
  fi
fi

# ------------------------------------------------------------ resultado
say ""
if [ $FAILED -eq 0 ]; then
  say "  ${OK}${B}Motor instalado e funcionando.${R}"
  say ""
  say "  Agora abre o Downloader no site e confere o ${B}passo 1${R}:"
  say "  tem que aparecer a bolinha verde com ${B}motor online${R}."
  say ""
  say "  ${DIM}O motor sobe sozinho toda vez que voce liga o Mac.${R}"
  say "  ${DIM}Para remover:  curl -fsSL $SITE/api/downloader-engine/mac | bash -s -- --uninstall${R}"
  say ""
  exit 0
else
  say "  ${ERR}${B}A instalacao terminou com problema.${R}"
  say ""
  say "  Log do motor: ${B}$LOG${R}"
  say "  Ultimas linhas:"
  tail -n 15 "$LOG" 2>/dev/null | sed 's/^/    /' || say "    (log vazio)"
  say ""
  say "  Manda esta tela pro suporte do Auto Edit - ela diz exatamente"
  say "  qual peca falhou."
  say ""
  exit 1
fi

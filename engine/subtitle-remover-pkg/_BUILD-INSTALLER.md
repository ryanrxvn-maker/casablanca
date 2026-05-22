# Build do DarkoLab-SubtitleRemover-Installer.exe

O instalador EXE eh um **7-Zip SFX self-extracting** que:
1. Extrai todos os arquivos do pacote num diretorio temporario.
2. Executa automaticamente `INSTALAR.cmd` (que dispara a GUI Darko).

Tamanho: ~230 KB (SFX module ~210 KB + 7z compactado ~20 KB).

## Pre-requisitos

- 7-Zip instalado (`C:\Program Files\7-Zip\7z.exe` + `7z.sfx`)
- cmd.exe (pra concat binario)

## Passos

```bash
# 1. Compactar todos os arquivos do pacote num .7z
cd engine/subtitle-remover-pkg
"C:/Program Files/7-Zip/7z.exe" a -t7z -mx=9 darko-content.7z \
  INSTALAR.cmd Instalar.ps1 \
  DESINSTALAR.cmd Desinstalar.ps1 \
  CODIGO.cmd Codigo.ps1 \
  DarkoSubtitleRemover.cmd \
  server.py pipeline.py \
  LEIA-ME.txt

# 2. Copiar o SFX module localmente (cmd nao gosta de path com espaco)
cp "C:/Program Files/7-Zip/7z.sfx" sfx.bin

# 3. Criar config do SFX (sfx_config.txt) — ja existe no repo
# Conteudo:
#   ;!@Install@!UTF-8!
#   Title="DarkoLab Subtitle Remover"
#   BeginPrompt="Instalar o motor?"
#   RunProgram="INSTALAR.cmd"
#   ;!@InstallEnd@!

# 4. Concatenar: SFX + config + 7z = EXE
cmd /c "copy /b sfx.bin + sfx_config.txt + darko-content.7z DarkoLab-SubtitleRemover-Installer.exe"

# 5. Limpar
rm sfx.bin darko-content.7z
```

## Quando rebuild

Sempre que algum arquivo do pacote mudar (`Instalar.ps1`, `server.py`,
`pipeline.py`, etc), rebuilda o EXE pra empacotar a versao atual.

## UX final

Usuario clica em "Baixar Instalador" no DarkoLab → baixa o .exe →
duplo-clique → caixa de confirmacao "Instalar?" → "Sim" → extrai +
roda Instalar.ps1 → GUI Darko aparece com barra de progresso.

Sem zip, sem extract manual, sem ver arquivos avulsos.

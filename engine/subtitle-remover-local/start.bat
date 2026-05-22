@echo off
REM ===========================================================
REM DarkoLab - Subtitle Remover Local
REM ===========================================================
REM Inicializa o servidor Python local na porta 8765.
REM Apenas a conta admin do DarkoLab consegue chamar a UI desta
REM ferramenta — o backend aqui escuta so em 127.0.0.1.
REM
REM Primeira vez:
REM   python -m venv .venv
REM   .venv\Scripts\activate
REM   pip install -r requirements.txt
REM   (espere ~5 min — paddlepaddle + torch sao grandes)
REM   start.bat
REM ===========================================================

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [darko] Virtual env nao encontrado.
    echo [darko] Rode primeiro:
    echo         python -m venv .venv
    echo         .venv\Scripts\activate
    echo         pip install -r requirements.txt
    pause
    exit /b 1
)

REM Verifica se ffmpeg esta no PATH
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo [darko] AVISO: ffmpeg nao encontrado no PATH.
    echo [darko] Instale via: winget install Gyan.FFmpeg
    echo [darko] (ou baixe de https://www.gyan.dev/ffmpeg/builds/)
    pause
)

echo [darko] Iniciando server local em http://127.0.0.1:8765 ...
echo [darko] Mantenha esta janela aberta enquanto usar a ferramenta.
echo.

".venv\Scripts\python.exe" server.py

pause

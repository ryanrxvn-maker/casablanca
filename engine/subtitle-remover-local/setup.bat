@echo off
REM ===========================================================
REM DarkoLab - Subtitle Remover Local - SETUP (primeira vez)
REM ===========================================================
REM Cria o venv .venv e instala todas as dependencias.
REM Roda uma vez so. Depois use start.bat pra iniciar o server.
REM
REM Tempo estimado: 5-10 min (paddlepaddle + torch sao grandes).
REM Espaco em disco: ~2.5 GB.
REM ===========================================================

cd /d "%~dp0"

REM Localiza um Python 3.10 ou 3.11 (ideal pra paddlepaddle 2.6).
set "PYEXE="
for %%P in (python3.11.exe python311.exe py.exe python.exe) do (
    if not defined PYEXE (
        where %%P >nul 2>&1
        if not errorlevel 1 set "PYEXE=%%P"
    )
)

if not defined PYEXE (
    echo [darko] ERRO: Python nao encontrado no PATH.
    echo [darko] Instale Python 3.11 de https://python.org
    pause
    exit /b 1
)

echo [darko] Usando %PYEXE%
echo [darko] Criando venv em .venv ...
"%PYEXE%" -m venv .venv
if errorlevel 1 (
    echo [darko] Falha ao criar venv.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
echo [darko] Atualizando pip ...
python -m pip install --upgrade pip wheel

echo [darko] Instalando dependencias (5-10 min, paciencia) ...
pip install -r requirements.txt
if errorlevel 1 (
    echo [darko] Falha ao instalar. Verifique a saida acima.
    pause
    exit /b 1
)

echo [darko] Verificando ffmpeg ...
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo [darko] AVISO: ffmpeg nao no PATH. Instale com:
    echo         winget install Gyan.FFmpeg
)

echo.
echo [darko] === SETUP COMPLETO ===
echo [darko] Agora rode: start.bat
echo.
pause

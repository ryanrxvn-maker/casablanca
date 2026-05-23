@echo off
title Auto Edit Downloader - Instalar
rem ============================================================
rem  Auto Edit Downloader - Instalador
rem  Janela VISIVEL (sem -WindowStyle Hidden) pra reduzir trigger
rem  de antivirus. Tudo o que rola fica em log no LOCALAPPDATA.
rem ============================================================
echo.
echo   AUTO EDIT - INSTALAR DOWNLOADER
echo   --------------------------------
echo   Aguarde... pode levar 1-3 min na primeira vez.
echo   Janela continua aberta enquanto roda.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"
set EC=%ERRORLEVEL%

echo.
if "%EC%"=="0" (
  echo   [OK] Instalado e vinculado.
) else (
  echo   [ERRO] Algo falhou. Codigo: %EC%
  echo   Log: %LOCALAPPDATA%\AutoEditDownloader\engine.log
)
echo.
pause

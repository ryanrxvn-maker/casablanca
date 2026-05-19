@echo off
title DarkoLab Downloader - Instalador
echo.
echo  Instalando o DarkoLab Downloader...
echo  (baixa as dependencias na 1a vez, ~1-2 min)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"
echo.
echo  Pode fechar esta janela.
pause >nul

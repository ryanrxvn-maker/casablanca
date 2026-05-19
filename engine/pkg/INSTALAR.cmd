@echo off
rem abre a janela do instalador (UI DARKO) sem mostrar console
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Instalar.ps1"
exit

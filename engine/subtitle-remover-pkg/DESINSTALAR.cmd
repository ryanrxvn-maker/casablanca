@echo off
rem abre o desinstalador (UI DARKO) sem mostrar console
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Desinstalar.ps1"
exit

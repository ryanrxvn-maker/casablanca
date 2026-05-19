@echo off
rem mostra o codigo de pareamento numa janela DARKO
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Codigo.ps1"
exit

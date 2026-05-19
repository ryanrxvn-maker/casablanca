@echo off
setlocal
set "HERE=%~dp0"
cd /d "%HERE%"
set "YTDLP_PATH=%HERE%bin\yt-dlp.exe"
set "FFMPEG_PATH=%HERE%bin\ffmpeg.exe"
set "PLAYWRIGHT_BROWSERS_PATH=%HERE%ms-playwright"
if not defined DARKO_ALLOW_ADULT set "DARKO_ALLOW_ADULT=1"
echo [%DATE% %TIME%] start >> "%HERE%engine.log"
"%HERE%node\node.exe" "%HERE%server.cjs" >> "%HERE%engine.log" 2>&1
echo [%DATE% %TIME%] exit %ERRORLEVEL% >> "%HERE%engine.log"

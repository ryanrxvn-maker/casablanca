@echo off
setlocal
set "HERE=%~dp0"
cd /d "%HERE%"
set "PATH=%HERE%bin;%HERE%python;%HERE%python\Scripts;%PATH%"
echo [%DATE% %TIME%] start >> "%HERE%engine.log"
"%HERE%python\python.exe" "%HERE%server.py" >> "%HERE%engine.log" 2>&1
echo [%DATE% %TIME%] exit %ERRORLEVEL% >> "%HERE%engine.log"

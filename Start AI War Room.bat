@echo off
setlocal
cd /d "%~dp0"

set "PROXY_DIR=%~dp0..\CLI ProxyApi"
set "PROXY_EXE=%PROXY_DIR%\cli-proxy-api.exe"
set "PROXY_CFG=%PROXY_DIR%\config.yaml"

echo === AI War Room ===
echo.

REM --- Sync Gemini key from Resablic .env into proxy config (if Node available) ---
where node >nul 2>&1
if not errorlevel 1 (
  if exist "%PROXY_DIR%\scripts\sync-gemini-from-resablic.mjs" (
    echo Syncing Gemini API key from Resablic .env ...
    pushd "%PROXY_DIR%"
    node scripts\sync-gemini-from-resablic.mjs
    popd
  )
)

REM --- CLIProxyAPI on 8317 (needed for live models) ---
netstat -ano | findstr ":8317" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  if exist "%PROXY_EXE%" (
    echo Starting CLIProxyAPI on :8317 ...
    start "CLIProxyAPI" /D "%PROXY_DIR%" "%PROXY_EXE%" -config "%PROXY_CFG%"
    timeout /t 3 /nobreak >nul
  ) else (
    echo WARNING: CLIProxyAPI not found at:
    echo   %PROXY_EXE%
    echo War Room will run in MOCK mode only.
    echo.
  )
) else (
  echo CLIProxyAPI already listening on :8317
)

REM --- War Room host on 8787 ---
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo Starting AI War Room on :8787 ...
  start "AI War Room" cmd /k "cd /d "%~dp0" && node server\index.js"
  timeout /t 2 /nobreak >nul
) else (
  echo AI War Room already listening on :8787
)

echo.
echo Opening browser...
start "" "http://127.0.0.1:8787/"
echo.
echo Top badge should say "CLIProxy OK" after a second or two.
echo Keep the CLIProxyAPI window open for live agents.
echo.
pause

@echo off
setlocal EnableExtensions
chcp 65001 >nul
title dsh web

rem Explorer-spawned cmd windows can miss npm's per-user executable directory.
set "PATH=%PATH%;%APPDATA%\npm"

cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "LOG=%~dp0run.log"
set "PORT=3080"

echo === dsh web launcher ===
echo Output is also written to %LOG%
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found even after adding %%APPDATA%%\npm to PATH.
  echo Install it with: npm install -g pnpm
  pause
  exit /b 9009
)

echo Checking web port %PORT% before install and build ...
powershell -NoProfile -Command "try { $owners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq ([int]$env:PORT) | Select-Object -ExpandProperty OwningProcess -Unique); if ($owners.Count -gt 0) { throw ('Port is already occupied by pid(s) ' + ($owners -join ', ') + '. If this is an existing dsh session, press Ctrl+C in its console and wait for it to exit, then rerun RUN.bat. Otherwise stop the owning application yourself.') } } catch { $message = 'Cannot start dsh web on port ' + $env:PORT + ': ' + $_.Exception.Message; Write-Host $message; Add-Content -LiteralPath $env:LOG -Value $message -Encoding UTF8; exit 1 }"
if errorlevel 1 goto :fail
echo [1/3] pnpm install ...
powershell -NoProfile -Command "& $env:ComSpec /d /c 'pnpm install' 2>&1 | ForEach-Object { $line = $_.ToString(); Write-Host $line; Add-Content -LiteralPath $env:LOG -Value $line -Encoding UTF8 }; exit $LASTEXITCODE"
if errorlevel 1 goto :fail

echo Installing and checking custom plugins ...
rem Standalone custom plugins are not members of the root pnpm workspace.
powershell -NoProfile -Command "& $env:ComSpec /d /c 'pnpm run install:custom-plugins' 2>&1 | ForEach-Object { $line = $_.ToString(); Write-Host $line; Add-Content -LiteralPath $env:LOG -Value $line -Encoding UTF8 }; exit $LASTEXITCODE"
if errorlevel 1 goto :fail

echo [2/3] pnpm run build (takes several minutes) ...
powershell -NoProfile -Command "& $env:ComSpec /d /c 'pnpm run build' 2>&1 | ForEach-Object { $line = $_.ToString(); Write-Host $line; Add-Content -LiteralPath $env:LOG -Value $line -Encoding UTF8 }; exit $LASTEXITCODE"
if errorlevel 1 goto :fail

echo [3/3] starting dsh web (leave this window open; Ctrl+C to stop) ...
echo When you see a http://127.0.0.1:%PORT%/?token=... line, open it in your browser.
echo Session MCP endpoint: http://127.0.0.1:%PORT%/mcp
call pnpm dsh web
set EC=%errorlevel%
echo.
echo dsh web exited with code %EC%
pause
exit /b %EC%

:fail
echo.
echo FAILED - see %LOG% for details (last 40 lines below)
echo ----------------------------------------------
powershell -NoProfile -Command "Get-Content -LiteralPath $env:LOG -Encoding UTF8 -Tail 40"
echo ----------------------------------------------
pause
exit /b 1

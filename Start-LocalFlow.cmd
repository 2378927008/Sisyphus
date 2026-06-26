@echo off
setlocal

cd /d "%~dp0"

if not exist "package.json" (
  echo Local Flow package.json was not found.
  echo This launcher must stay in the Local Flow project folder.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing Local Flow desktop runtime...
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  npm.cmd install
  if errorlevel 1 (
    echo.
    echo npm install failed. Check your network, then run this launcher again.
    pause
    exit /b 1
  )
)

npm.cmd start
if errorlevel 1 (
  echo.
  echo Local Flow failed to start.
  pause
  exit /b 1
)

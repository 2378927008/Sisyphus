@echo off
setlocal

cd /d "%~dp0"

if not exist "package.json" (
  echo Local Flow package.json was not found.
  echo This launcher must stay in the Local Flow project folder.
  pause
  exit /b 1
)

npm.cmd start
if not errorlevel 1 (
  exit /b 0
)

echo.
echo Local Flow did not start. Installing desktop runtime, then trying again...
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
npm.cmd install
if errorlevel 1 (
  echo.
  echo npm install failed. The npm cache or node_modules folder may be locked by another process.
  echo Close other Local Flow/Electron windows, then run this launcher again.
  pause
  exit /b 1
)

npm.cmd start
if errorlevel 1 (
  echo.
  echo Local Flow failed to start.
  pause
  exit /b 1
)

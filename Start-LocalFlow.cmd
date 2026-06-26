@echo off
setlocal

set "TARGET=%~dp0.worktrees\windows-usable-mvp-onboarding\Start-LocalFlow.cmd"

if not exist "%TARGET%" (
  echo Local Flow launcher was not found:
  echo %TARGET%
  echo.
  echo Make sure the windows-usable-mvp-onboarding worktree exists.
  pause
  exit /b 1
)

call "%TARGET%"

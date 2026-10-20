@echo off
setlocal
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install Node.js and retry.
  if "%~1"=="" pause
  exit /b 1
)
node "%~dp0scripts\setup-web.mjs" %*
set "setup_exit=%errorlevel%"
if "%~1"=="" pause
exit /b %setup_exit%

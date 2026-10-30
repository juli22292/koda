@echo off
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\Programs\KodaApp\Koda.exe" (
  start "" "%LOCALAPPDATA%\Programs\KodaApp\Koda.exe"
) else if exist "%ProgramFiles%\KodaApp\Koda.exe" (
  start "" "%ProgramFiles%\KodaApp\Koda.exe"
) else (
  for /f "delims=" %%F in ('dir /b /a-d /o-d "release\Koda-Setup-*-x64.exe" 2^>nul') do (
    start "" "release\%%F"
    exit /b 0
  )
  if not exist "out\main\index.js" (
    call npm run build
    if errorlevel 1 (
      pause
      exit /b 1
    )
  )
  set ELECTRON_RUN_AS_NODE=
  call npm start
)

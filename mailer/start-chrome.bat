@echo off
REM start-chrome.bat — запуск Chrome для INSTA-EBASHER v2 (клиентский режим, без Anty).
REM Отдельный профиль в папке проекта (chrome-profile\) + CDP-порт 9222.
REM Первый запуск: в открывшемся окне войдите в свой Instagram один раз — дальше сессия сохраняется.

setlocal
set PORT=9222
set PROFILE_DIR=%~dp0chrome-profile

set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe

if not defined CHROME (
  echo Chrome не найден. Установите Google Chrome: https://www.google.com/chrome/
  pause
  exit /b 1
)

echo Запускаю Chrome (профиль: %PROFILE_DIR%, порт %PORT%)...
start "" "%CHROME%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE_DIR%" --no-first-run --no-default-browser-check https://www.instagram.com/
echo.
echo Если это первый запуск — войдите в Instagram в открывшемся окне.
echo Это окно Chrome используется ТОЛЬКО для рассылки, ваш основной Chrome не трогается.
echo Не закрывайте это окно во время рассылки.

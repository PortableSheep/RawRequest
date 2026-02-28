@echo off
setlocal EnableDelayedExpansion

:: RawRequest CLI Setup
:: Adds rawrequest to your PATH so you can use:
::   rawrequest run api.http -n login
::   rawrequest mcp
::   rawrequest service

set "INSTALL_DIR=%LOCALAPPDATA%\RawRequest"
set "EXE_SRC=%~dp0RawRequest.exe"
set "EXE_DST=%INSTALL_DIR%\rawrequest.exe"
set "SERVICE_CMD=%INSTALL_DIR%\rawrequest-service.cmd"

if not exist "%EXE_SRC%" (
    echo Error: RawRequest.exe not found next to this script.
    echo Run this script from the same folder as RawRequest.exe.
    pause
    exit /b 1
)

echo Installing RawRequest CLI...

:: Create install directory
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Copy executable as rawrequest.exe
echo Copying to %INSTALL_DIR%...
copy /Y "%EXE_SRC%" "%EXE_DST%" >nul
if errorlevel 1 (
    echo Error: Failed to copy RawRequest.exe.
    pause
    exit /b 1
)

:: Create service launcher command
(
echo @echo off
echo "%%~dp0rawrequest.exe" service %%*
) > "%SERVICE_CMD%"

:: Check if already on PATH
echo %PATH% | findstr /I /C:"%INSTALL_DIR%" >nul 2>&1
if %errorlevel%==0 (
    echo rawrequest is already on your PATH.
    goto :done
)

:: Add to user PATH
echo Adding %INSTALL_DIR% to your PATH...
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"

if defined USER_PATH (
    reg add "HKCU\Environment" /v Path /t REG_EXPAND_SZ /d "%USER_PATH%;%INSTALL_DIR%" /f >nul
) else (
    reg add "HKCU\Environment" /v Path /t REG_EXPAND_SZ /d "%INSTALL_DIR%" /f >nul
)

:: Notify the system of the environment change
powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User'), 'User')" >nul 2>&1

:done
echo.
echo Done! rawrequest is now available on your PATH.
echo.
echo Open a NEW terminal and try:
echo   rawrequest --help
echo   rawrequest mcp
echo   rawrequest-service
echo.
pause

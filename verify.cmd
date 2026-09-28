@echo off
setlocal
rem Use npm.cmd so this also works when PowerShell blocks npm.ps1.
pushd "%~dp0backend" || exit /b 1
call :verify
if errorlevel 1 goto failed
popd
pushd "%~dp0frontend" || exit /b 1
call :verify
if errorlevel 1 goto failed
popd
echo Backend and frontend build, lint, and unit tests passed.
exit /b 0

:verify
call npm.cmd run build
if errorlevel 1 exit /b 1
call npm.cmd run lint
if errorlevel 1 exit /b 1
call npm.cmd test
if errorlevel 1 exit /b 1
exit /b 0

:failed
popd
echo Verification failed. Review the error above.
exit /b 1

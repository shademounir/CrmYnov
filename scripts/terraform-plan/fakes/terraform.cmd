@echo off
node "%~dp0fake-terraform.mjs" %*
exit /b %errorlevel%

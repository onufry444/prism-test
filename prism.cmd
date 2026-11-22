@echo off
rem Prism engine from a source checkout (the installed version adds `prism` to PATH)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\prism.ps1" %*

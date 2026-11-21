@echo off
rem Prism: uruchamia installer\prism.ps1 bez zmiany polityki wykonywania skryptow w systemie
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\prism.ps1" %*

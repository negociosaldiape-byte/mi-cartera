@echo off
title Panel de Inversiones - NO CERRAR mientras lo usas
cd /d "%~dp0"
echo.
echo   Iniciando tu panel de inversiones...
echo   (Se abrira solo en tu navegador en unos segundos)
echo.
node server.js
echo.
echo   El panel se cerro. Ya puedes cerrar esta ventana.
pause

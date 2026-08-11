@echo off
rem Arranca el servidor y abre la ventana del widget.
rem Para que arranque con Windows: Win+R -> shell:startup -> pega un acceso directo a este .bat

cd /d "%~dp0"

start "" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul

start "" msedge --app="http://127.0.0.1:47600" --window-size=520,360 --disable-features=Translate
exit

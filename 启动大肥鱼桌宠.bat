@echo off
set "ELECTRON_RUN_AS_NODE="
setlocal
set "BASE=%~dp0"
set "BASE=%BASE:~0,-1%"
start "" "%BASE%\node_modules\electron\dist\electron.exe" "%BASE%" --no-sandbox --user-data-dir="%BASE%\data\profile"
endlocal

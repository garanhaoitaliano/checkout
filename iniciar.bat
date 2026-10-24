@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
echo.
echo  Checkout:  http://localhost:3000/c/demo
echo  Admin:     http://localhost:3000/admin/
echo.
node server/index.js
pause

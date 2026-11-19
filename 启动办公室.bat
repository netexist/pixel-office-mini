@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Trae 办公室 · 2.5D 等距插画 · 一键启动
echo   页面：http://127.0.0.1:8899/
echo   后台监听由页面托管，可随时「停止 / 继续」
echo ============================================
echo.

echo [1/2] 启动服务（会自动拉起 15 个项目的目录监听）...
start "Trae Office - Server" cmd /k node server.js

timeout /t 3 >nul

echo [2/2] 打开浏览器...
start "" "http://127.0.0.1:8899/"

echo.
echo 已启动。关掉那个黑色窗口即可彻底停止（会连带结束后台监听）。
echo.
pause

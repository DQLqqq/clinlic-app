@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo 临床研究数据采集 APP - 本机识别服务启动
echo 地址：127.0.0.1:8766
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ocr-service.ps1" -Port 8766
echo.
pause
endlocal

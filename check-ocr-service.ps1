param(
  [int]$Port = 8766
)

$ErrorActionPreference = "Stop"
$HostAddress = "127.0.0.1"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Checker = Join-Path $Root "tools\check-paddle-ocr-deployment.py"

function Find-Python {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) { return $python.Source }
  $python3 = Get-Command python3 -ErrorAction SilentlyContinue
  if ($python3) { return $python3.Source }
  throw "没有找到 Python。请联系信息科安装离线识别运行环境。"
}

Write-Host "正在检查本机识别服务..."
Write-Host "地址：$HostAddress`:$Port"
Write-Host "说明：检查只访问本机，不会联网，不会上传，不会保存图片。"

try {
  $Python = Find-Python
  & $Python $Checker --host $HostAddress --port $Port
  Write-Host ""
  Write-Host "如果 APP 仍显示未启动，请回到 APP 点击“重新检查”。"
  Read-Host "按回车关闭"
}
catch {
  Write-Host ""
  Write-Host ("检查失败：" + $_.Exception.Message)
  Write-Host "可以先回到 APP，选择“继续手动粘贴文字”。"
  Read-Host "按回车关闭"
  exit 1
}

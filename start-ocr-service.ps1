param(
  [int]$Port = 8766
)

$ErrorActionPreference = "Stop"
$HostAddress = "127.0.0.1"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Server = Join-Path $Root "tools\paddle-ocr-server.py"
$Checker = Join-Path $Root "tools\check-paddle-ocr-deployment.py"

function Write-Step($Message) {
  Write-Host ""
  Write-Host $Message
}

function Find-Python {
  $bundledPython = Join-Path $Root "runtime\python\python.exe"
  if (Test-Path $bundledPython) { return $bundledPython }
  $embeddedPython = Join-Path $Root "runtime\python-embed\python.exe"
  if (Test-Path $embeddedPython) { return $embeddedPython }
  if ($env:CLINICAL_OCR_PYTHON -and (Test-Path $env:CLINICAL_OCR_PYTHON)) { return $env:CLINICAL_OCR_PYTHON }
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) { return $python.Source }
  $python3 = Get-Command python3 -ErrorAction SilentlyContinue
  if ($python3) { return $python3.Source }
  throw "离线识别运行包不完整：缺少 runtime\python\python.exe。请联系信息科补齐软件自带运行包；医院电脑不需要联网下载。"
}

Write-Host "临床研究数据采集 APP - 本机识别服务启动"
Write-Host "地址：$HostAddress`:$Port"
Write-Host "说明：本服务只在本机运行，不会联网，不会上传，不会保存图片。"
Write-Host "运行环境：优先使用软件自带 runtime\python\python.exe；医院电脑不需要单独安装 Python。"

try {
  $Python = Find-Python
  Write-Step "正在检查识别环境..."
  $CheckJson = & $Python $Checker --host $HostAddress --port $Port --json
  $Check = $CheckJson | ConvertFrom-Json
  Write-Host ("识别服务状态：" + $Check.doctor_status.status_label)
  Write-Host $Check.doctor_status.doctor_message

  if ($Check.doctor_status.status_key -eq "available") {
    Write-Host ""
    Write-Host "识别服务已经可用。可以回到 APP 点击“重新检查”。"
    Read-Host "按回车关闭"
    exit 0
  }

  if ($Check.doctor_status.status_key -eq "missing_dependencies" -or $Check.doctor_status.status_key -eq "missing_models") {
    Write-Host ""
    Write-Host "当前不能启动识别服务。请按上面的提示处理；在 APP 里仍可继续手动粘贴文字。"
    Read-Host "按回车关闭"
    exit 1
  }

  if ($Check.doctor_status.status_key -eq "port_occupied") {
    Write-Host ""
    Write-Host "端口 $Port 已被占用。请关闭其他识别服务窗口后重试；也可先手动粘贴文字。"
    Read-Host "按回车关闭"
    exit 1
  }

  Write-Step "正在启动识别服务..."
  Write-Host "启动后请保持这个窗口打开。需要停止时，关闭窗口即可。"
  & $Python $Server --host $HostAddress --port $Port --allow-file-origin
}
catch {
  Write-Host ""
  Write-Host ("启动失败：" + $_.Exception.Message)
  Write-Host "可以先回到 APP，选择“继续手动粘贴文字”。"
  Read-Host "按回车关闭"
  exit 1
}

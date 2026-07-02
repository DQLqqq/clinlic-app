# 离线识别运行包位置

这个目录用于随软件一起携带 Windows 本机 OCR 运行环境。

推荐结构：

```text
runtime/
  python/
    python.exe
    Lib/
    Scripts/
    ...
  models/
    official_models/
      PP-LCNet_x1_0_textline_ori/
      PP-OCRv6_medium_det/
      PP-OCRv6_medium_rec/
```

临床电脑不需要联网下载，也不需要医生手动安装 Python。`start-ocr-service.ps1` 和 `check-ocr-service.ps1` 会优先使用 `runtime\python\python.exe`。

如果这个目录缺失或不完整，请联系信息科补齐离线运行包；APP 仍可继续手动粘贴识别文字。

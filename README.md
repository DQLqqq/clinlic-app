# 临床研究数据采集系统静态原型

这是一个离线 Windows 临床研究数据采集 APP 的 HTML/JS 原型。当前重点是先跑通本机录入、截图/OCR 候选、人工确认、字段自选导出、U 盘包校验导入和冲突预览流程，后续再迁移到 WinUI 桌面版。

## 本地打开

直接用浏览器打开：

```text
file:///Users/yukizz/Documents/%E6%94%B6%E6%95%B0%E6%8D%AEAPP/index.html
```

也可以在项目目录临时启动静态服务器：

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

## 当前边界

- 默认离线运行，不依赖云服务。
- AI/OCR 只生成候选，必须人工确认后入库。
- 影像/病理图片不入库，只保存报告文字、摘要和来源追溯。
- U 盘 JSON 包保留 CSV、manifest 和 checksum；界面可单独导出真正多 sheet `.xlsx`。

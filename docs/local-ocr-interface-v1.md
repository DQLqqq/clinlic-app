# 本机 OCR 接口契约 v1

本接口只用于离线临床电脑或同机桥接服务。当前 HTML 版和后续 WinUI 版本都按同一数据形状发送请求，OCR 只返回候选文本，候选结果必须人工确认后才能入库。

## 传输边界

- HTTP 服务地址必须是 `localhost`、`127.0.0.1`、`[::1]` 或 `*.localhost`。
- 默认端点为 `http://127.0.0.1:8766/ocr`，请求超时建议 15 秒，可配置为 1-60 秒。
- 服务端必须禁止重定向外联；APP 也会把重定向作为错误处理。
- 不向外网发送图片、报告文本或患者信息。
- 截图只作为本次 OCR 输入临时传递，APP 不保存原图。

## 本机 mock 服务

用于端到端验证：

```bash
node tools/local-ocr-mock-server.mjs
```

默认监听 `127.0.0.1:8766`，只处理 `POST /ocr` 和 `GET /health`，不会保存图片。它返回固定化验文本，便于验证“本机 OCR -> 候选抽取 -> 人工确认入库”。

默认只允许本机 HTTP 页面调用，不允许 `Origin: null`。如果必须从 `file://` 页面临时调试，可显式运行：

```bash
OCR_MOCK_ALLOW_NULL_ORIGIN=1 node tools/local-ocr-mock-server.mjs
```

完成调试后应关闭该开关。

## 请求

```json
{
  "request_id": "ocr_xxx",
  "schema_version": "local-ocr-v1",
  "app_schema_version": "v3",
  "created_at": "2026-06-22T00:00:00.000Z",
  "task": "lab_table_ocr",
  "image": {
    "name": "lis.png",
    "size": 123456,
    "type": "image/png",
    "data_url": "data:image/png;base64,...",
    "retain_image": false
  },
  "manual_text": "",
  "options": {
    "language": "zh-CN",
    "table_hint": true,
    "return_text": true,
    "return_boxes": false
  },
  "patient_context": {
    "patient_uid": "patient_xxx",
    "research_id": "PCC-2026-001",
    "image_name": "lis.png"
  },
  "privacy": {
    "offline_only": true,
    "store_image": false,
    "human_confirm_required": true
  }
}
```

## 响应

推荐返回：

```json
{
  "text": "项目 结果 单位 参考范围\nCA19-9 856.4 U/mL 0-37",
  "engine": "paddleocr-local",
  "confidence": 0.91
}
```

兼容字段：`text`、`ocr_text`、`result`、`full_text`，或 `lines[]`。如果返回 `{ "error": "..." }`，APP 会显示失败原因。

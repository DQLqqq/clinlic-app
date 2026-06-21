# 临床数据采集系统 WinUI 迁移计划

## 当前阶段

当前先保留 HTML/JS 本地原型，目标是把临床数据录入流程、字段结构、截图/OCR候选、人工确认、导出报告和 U 盘导入导出闭环跑通。

当前原型验证重点：

- 病例、住院次、多诊断、化验长表、报告文本、随访记录是否够用。
- HIS/LIS 化验截图是否能进入“截图导入 -> OCR文本 -> 候选字段 -> 人工确认 -> 化验长表”的闭环。
- Excel/CSV 导出是否满足“自选患者、自选字段、一行一个患者、化验列带单位”。
- U 盘包是否能被另一台同款 APP 导入。
- 界面是否足够实用，不放流程图、方案说明和无交互装饰。

## 后续 WinUI 阶段

流程定稿后再迁移为 C# WinUI 3 / Windows App SDK 桌面版。

建议项目结构：

- `Pages/`：病例列表、病例总览、检查化验、报告文本、导出导入、模型配置。
- `ViewModels/`：病例状态、导出配置、OCR工作台、AI候选确认。
- `Services/`：SQLite、本地文件、U盘导入导出、OCR、模型推理、审计日志。
- `Styles/`：主题资源、表格和表单样式。
- `Assets/`：应用图标和必要静态资源。

包装模型暂定：

- 院内试点优先考虑 unpackaged，便于离线电脑直接运行和排查。
- 如果医院信息科要求签名、受控部署、MSIX 更新，再改 packaged。

WinUI 迁移时的核心控件选择：

- 主壳使用 `NavigationView` 或简化的左侧病例列表 + 中央内容 + 右侧候选区。
- 页面操作优先用 `CommandBar`，避免自制无交互工具条。
- 表单使用 `TextBox`、`NumberBox`、`ComboBox`、`DatePicker`。
- 导入/导出确认使用 `ContentDialog`。
- 长列表和化验表格需要虚拟化或分页，避免普通临床电脑卡顿。

## OCR 接口约定

HTML 原型保留三种入口：手动粘贴、桌面桥接、本机 HTTP OCR 服务。WinUI 版可复用同一结构：

- 请求：`request_id`、`task=lab_table_ocr`、`image{name,size,type,data_url}`、`manual_text`、`options{language,table_hint,return_text,return_boxes}`、`patient_context{patient_uid,research_id,image_name}`。
- 桥接：注入 `window.clinicalOcrBridge.recognizeLabImage(request)` 或 `recognizeImage(request)`。
- 本机服务：`POST http://127.0.0.1:8766/ocr`，返回 JSON 或纯文本。
- 响应：`text` 或 `ocr_text` 为识别文本，`engine/provider` 标记引擎，`confidence` 可选。
- 图片只作为临时输入，不进入正式数据库和 U 盘导出包。

## 迁移前不做

- 不急着创建 WinUI 工程。
- 不先接复杂后端。
- 不把 OCR、大模型、预测模型做成必需依赖。
- 不保存影像/病理原图。

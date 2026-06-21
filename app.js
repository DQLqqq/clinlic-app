const STORAGE_KEY = "pancreas-clinical-app-v01";

const exportFieldCatalog = [
  { key: "research_id", group: "基本信息", label: "研究编号", defaultSelected: true },
  { key: "inpatient_no", group: "基本信息", label: "住院号", defaultSelected: false },
  { key: "medical_record_no", group: "基本信息", label: "病案号", defaultSelected: false },
  { key: "sex", group: "基本信息", label: "性别", defaultSelected: true },
  { key: "age_at_admission", group: "基本信息", label: "入院年龄", unit: "岁", defaultSelected: true },
  { key: "admission_date", group: "入院信息", label: "入院时间", defaultSelected: true },
  { key: "discharge_date", group: "入院信息", label: "出院时间", defaultSelected: true },
  { key: "length_of_stay_days", group: "入院信息", label: "住院天数", unit: "天", defaultSelected: true },
  { key: "department", group: "入院信息", label: "科室", defaultSelected: false },
  { key: "primary_diagnosis", group: "诊断记录", label: "主诊断", defaultSelected: true },
  { key: "all_diagnoses", group: "诊断记录", label: "全部诊断", defaultSelected: true },
  { key: "diagnosis_count", group: "诊断记录", label: "诊断条数", defaultSelected: false },
  { key: "lab_wide", group: "检查化验", label: "化验宽表", defaultSelected: true, dynamic: true },
  { key: "report_summary", group: "报告内容", label: "报告摘要", defaultSelected: true },
  { key: "report_count", group: "报告内容", label: "报告条数", defaultSelected: false },
  { key: "last_followup_date", group: "术后随访", label: "末次随访时间", defaultSelected: true },
  { key: "survival_status", group: "术后随访", label: "生存状态", defaultSelected: true },
  { key: "recurrence_status", group: "术后随访", label: "复发状态", defaultSelected: false }
];

const defaultExportFieldKeys = exportFieldCatalog.filter((field) => field.defaultSelected).map((field) => field.key);

const exportTemplates = [
  {
    key: "minimal",
    label: "最小模板",
    fields: ["research_id", "sex", "age_at_admission", "admission_date", "primary_diagnosis"]
  },
  {
    key: "clinical",
    label: "临床研究模板",
    fields: defaultExportFieldKeys
  },
  {
    key: "lab",
    label: "化验分析模板",
    fields: ["research_id", "sex", "age_at_admission", "admission_date", "primary_diagnosis", "lab_wide"]
  },
  {
    key: "followup",
    label: "随访结局模板",
    fields: ["research_id", "primary_diagnosis", "last_followup_date", "survival_status", "recurrence_status"]
  }
];

let labScreenshotPreviewUrl = "";
let labScreenshotOcrPayload = null;
let pendingImportPackage = null;
let pendingImportPreview = null;
let pendingImportInProgress = false;

const sampleLabOcrText = `申请日期: 2026-01-03 10:52:53
报告名称: 血细胞分析(血常规)
WBC\t白细胞\t4.63\t\t10^9/L\t3.69-9.16
NEUT%\t中性粒细胞百分率\t84.90\tH\t%\t50-70
NEUT#\t中性粒细胞绝对值\t3.93\t\t10^9/L\t2-7
LYMPH%\t淋巴细胞百分率\t5.80\tL\t%\t20-40
LYMPH#\t淋巴细胞绝对值\t0.27\tL\t10^9/L\t0.8-4
MONO%\t单核细胞百分率\t7.60\t\t%\t3-10
MONO#\t单核细胞绝对值\t0.35\t\t10^9/L\t0.12-1
EO%\t嗜酸性粒细胞百分率\t0.00\tL\t%\t0.5-5
EO#\t嗜酸性粒细胞绝对值\t0.00\tL\t10^9/L\t0.02-0.5
BASO%\t嗜碱性粒细胞百分率\t0.60\t\t%\t0-1
BASO#\t嗜碱性粒细胞绝对值\t0.03\t\t10^9/L\t0-1
RBC\t红细胞\t2.98\tL\t10^12/L\t3.68-5.13
HGB\t血红蛋白\t91.00\tL\tg/L\t113-151
HCT\t红细胞比积\t27.70\tL\t%\t33.5-45
MCV\t平均红细胞体积\t93.00\t\tfl\t82.6-99.1
MCH\t平均红细胞血红蛋白含量\t30.50\t\tpg\t26.9-33.3
MCHC\t平均红细胞血红蛋白浓度\t329.00\t\tg/L\t322-362
RDW-SD\t红细胞体积分布宽度标准差\t49.40\t\tfl\t
RDW-CV\t红细胞体积分布宽度变异系数\t15.20\t\t%\t
PLT\t血小板\t44.00\tL\t10^9/L\t98-300`;

const state = {
  patients: [],
  activePatientId: null,
  activeTab: "overview",
  activeAiTab: "capture",
  capturePreviewUrl: "",
  activeExportPanel: "patients",
  listFilter: "all",
  search: "",
  exportConfig: {
    selectedPatients: [],
    diagnosisInclude: "",
    diagnosisAnd: "",
    diagnosisOr: "",
    diagnosisExclude: "",
    selectedGroups: ["基本信息", "入院信息", "诊断记录", "检查化验", "报告内容", "术后随访"],
    selectedFields: defaultExportFieldKeys,
    labRule: "入院首次",
    indexEncounter: "首次相关住院"
  },
  modelConfig: {
    mode: "规则助手",
    runner: "llama.cpp",
    model: "Qwen/Qwen3-1.7B-GGUF",
    contextTokens: 2048,
    maxOutputTokens: 512,
    status: "未启用",
    enabled: false,
    modelFileName: "",
    modelFileSize: "",
    modelFileHash: "",
    lastTestResult: "未测试"
  },
  ocrConfig: {
    mode: "manual",
    endpoint: "http://127.0.0.1:8766/ocr",
    timeoutMs: 15000,
    lastStatus: "未运行",
    lastEngine: "手动粘贴"
  },
  chat: [
    {
      role: "assistant",
      text: "我是离线助手。可以解释字段、检查缺失项、说明导出导入流程；不会联网，也不会给出诊断或治疗建议。"
    }
  ]
};

const knowledgeBase = [
  {
    keys: ["住院天数", "入院", "出院"],
    answer: "住院天数为自动派生字段，默认按“出院日期 - 入院日期 + 1”计算。同日入出院为 1 天；如果缺少出院日期显示“待出院”；出院早于入院会阻止保存。"
  },
  {
    keys: ["导出", "excel", "一行一个患者", "一列"],
    answer: "自选 Excel 的患者主表固定为一行一个患者、一列一个数据种类。多诊断和多次化验不会硬塞进主表，完整明细进入诊断明细、化验长表和报告明细。"
  },
  {
    keys: ["u盘", "导入", "另一台", "checksum", "manifest"],
    answer: "U 盘包包含 export_manifest.json、checksum.sha256、excel/患者主表.csv 和 data/*.csv。另一台 APP 导入时先校验 SHA-256，再进入 staging，按 record_uuid + content_hash 去重。正式桌面版可生成真正的 .xlsx。"
  },
  {
    keys: ["ca19", "ca199", "CA19-9"],
    answer: "CA19-9 建议保留原始单位和值。导出宽表表头必须带单位，例如 CA19-9_入院首次 (U/mL)。胆道梗阻明显时建议在备注中提示可能影响解释。"
  },
  {
    keys: ["白蛋白", "albumin", "单位"],
    answer: "白蛋白常用单位为 g/L。若原始报告出现其他单位，不应静默换算；应保留 unit_raw，可靠换算后再写 unit_std 和换算说明。"
  },
  {
    keys: ["报告", "影像", "病理", "图片", "dicom"],
    answer: "首版只保存影像/病理报告文字、报告号、结构化摘要和来源定位，不保存 DICOM、病理切片或大截图，以降低存储压力和转移风险。"
  },
  {
    keys: ["AI", "助手", "聊天", "大模型"],
    answer: "首版离线助手使用本地知识库和规则质控。它能解释软件使用、字段口径和错误提示，不能诊断、不能给治疗建议、不能绕过人工确认修改数据库。"
  },
  {
    keys: ["开源", "模型", "llama", "qwen", "gemma", "ollama"],
    answer: "正式桌面版建议默认规则助手，可选 llama.cpp + GGUF 小模型。选择模型文件后要校验 SHA-256，再启用；低配电脑优先小模型并限制上下文 2K-4K。"
  },
  {
    keys: ["截图", "ocr", "化验截图", "检验截图", "图片导入"],
    answer: "截图导入的闭环是：选择 HIS/LIS 截图，只临时预览；本机 OCR 得到文字；解析出化验候选；人工确认后写入检查化验长表；原图不入库。浏览器原型支持粘贴 OCR 文字解析，桌面版接 Windows OCR 或 PaddleOCR 自动识别。"
  }
];

const exportGroups = ["基本信息", "入院信息", "诊断记录", "检查化验", "报告内容", "治疗手术", "术后随访"];
const labRules = ["每一次", "入院首次", "最后一次", "术前最近一次", "术后首次", "指定日期范围"];
const ocrEngineModes = [
  { key: "manual", label: "手动粘贴文本" },
  { key: "desktopBridge", label: "桌面OCR桥接" },
  { key: "localHttp", label: "本机HTTP OCR服务" }
];
const importTableDefinitions = [
  { path: "data/patient_master.csv", label: "患者主表" },
  { path: "data/encounter.csv", label: "住院次" },
  { path: "data/diagnosis.csv", label: "诊断记录" },
  { path: "data/lab_result.csv", label: "化验结果" },
  { path: "data/report_record.csv", label: "报告文本" },
  { path: "data/followup.csv", label: "随访记录" }
];
const requiredImportFiles = [...importTableDefinitions.map((item) => item.path), "data/lab_report.csv", "data/treatment.csv"];
const importMergeDefinitions = [
  { key: "encounters", path: "data/encounter.csv", label: "住院次", idField: "encounter_id", hydrate: hydrateEncounter },
  { key: "diagnoses", path: "data/diagnosis.csv", label: "诊断记录", idField: "diagnosis_id", hydrate: hydrateDiagnosis },
  { key: "labs", path: "data/lab_result.csv", label: "化验结果", idField: "lab_result_id", hydrate: hydrateLab },
  { key: "reports", path: "data/report_record.csv", label: "报告文本", idField: "report_id", hydrate: hydrateReport },
  { key: "followup", path: "data/followup.csv", label: "随访记录", idField: "followup_id", hydrate: hydrateFollowup }
];
const importPatientCoreFields = [
  { key: "record_uuid", label: "记录UUID" },
  { key: "patient_uid", label: "患者内部ID" },
  { key: "research_id", label: "研究编号" },
  { key: "inpatient_no", label: "住院号" },
  { key: "medical_record_no", label: "病案号" },
  { key: "sex", label: "性别" },
  { key: "age_at_admission", label: "入院年龄" }
];

const labItemDictionary = [
  { aliases: ["WBC", "白细胞"], name: "白细胞", unit: "10^9/L" },
  { aliases: ["NEUT%", "中性粒细胞百分率"], name: "中性粒细胞百分率", unit: "%" },
  { aliases: ["NEUT#", "中性粒细胞绝对值"], name: "中性粒细胞绝对值", unit: "10^9/L" },
  { aliases: ["LYMPH%", "淋巴细胞百分率"], name: "淋巴细胞百分率", unit: "%" },
  { aliases: ["LYMPH#", "淋巴细胞绝对值"], name: "淋巴细胞绝对值", unit: "10^9/L" },
  { aliases: ["MONO%", "单核细胞百分率"], name: "单核细胞百分率", unit: "%" },
  { aliases: ["MONO#", "单核细胞绝对值"], name: "单核细胞绝对值", unit: "10^9/L" },
  { aliases: ["EO%", "嗜酸性粒细胞百分率"], name: "嗜酸性粒细胞百分率", unit: "%" },
  { aliases: ["EO#", "嗜酸性粒细胞绝对值"], name: "嗜酸性粒细胞绝对值", unit: "10^9/L" },
  { aliases: ["BASO%", "嗜碱性粒细胞百分率"], name: "嗜碱性粒细胞百分率", unit: "%" },
  { aliases: ["BASO#", "嗜碱性粒细胞绝对值"], name: "嗜碱性粒细胞绝对值", unit: "10^9/L" },
  { aliases: ["RBC", "红细胞"], name: "红细胞", unit: "10^12/L" },
  { aliases: ["HGB", "血红蛋白"], name: "血红蛋白", unit: "g/L" },
  { aliases: ["HCT", "红细胞比积"], name: "红细胞比积", unit: "%" },
  { aliases: ["MCV", "平均红细胞体积"], name: "平均红细胞体积", unit: "fL" },
  { aliases: ["MCH", "平均红细胞血红蛋白含量"], name: "平均红细胞血红蛋白含量", unit: "pg" },
  { aliases: ["MCHC", "平均红细胞血红蛋白浓度"], name: "平均红细胞血红蛋白浓度", unit: "g/L" },
  { aliases: ["RDW-SD", "红细胞体积分布宽度标准差"], name: "红细胞体积分布宽度标准差", unit: "fL" },
  { aliases: ["RDW-CV", "红细胞体积分布宽度变异系数"], name: "红细胞体积分布宽度变异系数", unit: "%" },
  { aliases: ["PLT", "血小板"], name: "血小板", unit: "10^9/L" },
  { aliases: ["CA19-9", "CA199", "糖类抗原19-9"], name: "CA19-9", unit: "U/mL" },
  { aliases: ["CEA", "癌胚抗原"], name: "CEA", unit: "ng/mL" },
  { aliases: ["白蛋白", "ALB"], name: "白蛋白", unit: "g/L" },
  { aliases: ["总胆红素", "TBIL"], name: "总胆红素", unit: "μmol/L" },
  { aliases: ["CRP", "C反应蛋白"], name: "CRP", unit: "mg/L" },
  { aliases: ["血糖", "GLU"], name: "血糖", unit: "mmol/L" }
];

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  bindShellEvents();
  render();
});

function bindShellEvents() {
  document.getElementById("addPatientBtn").addEventListener("click", () => {
    const patient = createPatient();
    state.patients.unshift(patient);
    state.activePatientId = patient.patient_uid;
    saveState();
    render();
    toast("已新建脱敏病例");
  });

  document.getElementById("patientSearch").addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    renderPatientList();
  });

  document.querySelectorAll("[data-list-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.listFilter = button.dataset.listFilter;
      document.querySelectorAll("[data-list-filter]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderPatientList();
    });
  });

  document.getElementById("mainTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    state.activeTab = tab.dataset.tab;
    renderTabs();
    renderActiveTab();
  });

  document.getElementById("aiTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-ai-tab]");
    if (!tab) return;
    state.activeAiTab = tab.dataset.aiTab;
    renderAiTabs();
    renderAiContent();
  });

  document.getElementById("importPackageInput").addEventListener("change", handleImportFile);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.patients = parsed.patients?.length ? parsed.patients : seedPatients();
      state.activePatientId = parsed.activePatientId || state.patients[0]?.patient_uid || null;
      if (!state.patients.some((patient) => patient.patient_uid === state.activePatientId)) {
        state.activePatientId = state.patients[0]?.patient_uid || null;
      }
      state.exportConfig = { ...state.exportConfig, ...(parsed.exportConfig || {}) };
      state.modelConfig = { ...state.modelConfig, ...(parsed.modelConfig || {}) };
      state.ocrConfig = { ...state.ocrConfig, ...(parsed.ocrConfig || {}) };
      state.activeExportPanel = parsed.activeExportPanel || state.activeExportPanel;
      state.activeAiTab = parsed.activeAiTab || state.activeAiTab;
      if (!["capture", "candidates", "chat", "trace"].includes(state.activeAiTab)) state.activeAiTab = "capture";
      state.chat = parsed.chat || state.chat;
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  state.patients = seedPatients();
  state.activePatientId = state.patients[0].patient_uid;
  saveState();
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      patients: state.patients,
      activePatientId: state.activePatientId,
      exportConfig: state.exportConfig,
      modelConfig: state.modelConfig,
      ocrConfig: state.ocrConfig,
      activeExportPanel: state.activeExportPanel,
      activeAiTab: state.activeAiTab,
      chat: state.chat.slice(-20)
    })
  );
}

function render() {
  renderSystemStrip();
  renderPatientList();
  renderHeader();
  renderMetrics();
  renderTabs();
  renderActiveTab();
  renderAiTabs();
  renderAiContent();
}

function renderSystemStrip() {
  const usedBytes = new Blob([localStorage.getItem(STORAGE_KEY) || ""]).size;
  const usedKb = Math.max(1, Math.round(usedBytes / 1024));
  const storage = navigator.storage?.estimate ? "浏览器存储" : "本地存储";
  const dataLevel = usedBytes > 4 * 1024 * 1024 ? "warn" : "good";
  const modelLevel = state.modelConfig.enabled ? "good" : "warn";
  const pills = [
    statusPill("离线运行", "good"),
    statusPill("本地库", "good"),
    statusPill(`${storage} ${usedKb}KB`, dataLevel),
    statusPill("桌面版显示磁盘剩余", "warn"),
    statusPill("U盘待选择", "warn"),
    statusPill(`AI ${state.modelConfig.mode}`, modelLevel)
  ];
  document.getElementById("systemStrip").innerHTML = pills.join("");
  document.getElementById("bottomStatus").innerHTML = `
    <span><strong>本地状态</strong> 离线运行 · 浏览器存储 ${usedKb}KB · 最近保存 ${formatDateTime(getActivePatient()?.updated_at)}</span>
    <span><strong>安全边界</strong> 不联网 · 不上传 · AI候选需人工确认 · 影像/病理只存报告文字 · ${escapeHtml(state.modelConfig.runner)}</span>
  `;
}

function statusPill(text, level) {
  return `<span class="status-pill ${level}">${escapeHtml(text)}</span>`;
}

function renderPatientList() {
  const container = document.getElementById("patientList");
  const search = state.search.toLowerCase();
  const patients = state.patients.filter((patient) => {
    const matchesFilter = state.listFilter === "all" || patient.qc_status === state.listFilter;
    const haystack = [
      patient.research_id,
      patient.inpatient_no,
      patient.qc_status,
      patient.diagnoses.map((item) => item.diagnosis_text_raw).join(" ")
    ]
      .join(" ")
      .toLowerCase();
    return matchesFilter && (!search || haystack.includes(search));
  });

  if (!patients.length) {
    container.innerHTML = `<div class="empty">没有匹配病例</div>`;
    return;
  }

  container.innerHTML = patients
    .map((patient) => {
      const qc = getQcIssues(patient);
      const primaryDiagnosis = getPrimaryDiagnosis(patient)?.diagnosis_text_raw || "未确认诊断";
      const active = patient.patient_uid === state.activePatientId ? " active" : "";
      return `
        <button class="patient-card${active}" data-patient-id="${patient.patient_uid}" type="button">
          <strong>${escapeHtml(patient.research_id)}</strong>
          <span>${escapeHtml(primaryDiagnosis)} · ${escapeHtml(patient.qc_status)}</span>
          <span>AI候选 ${getCandidates(patient).length} · 缺失/提醒 ${qc.length}</span>
          <span>最近保存 ${formatDateTime(patient.updated_at)}</span>
        </button>
      `;
    })
    .join("");

  container.querySelectorAll("[data-patient-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePatientId = button.dataset.patientId;
      saveState();
      render();
    });
  });
}

function renderHeader() {
  const patient = getActivePatient();
  document.getElementById("caseHeader").innerHTML = `
    <div class="case-title">
      <h2>${escapeHtml(patient.research_id)} · ${escapeHtml(patient.sex)} ${patient.age_at_admission || "--"}岁</h2>
      <p>索引住院次：${escapeHtml(state.exportConfig.indexEncounter)} · 住院号：${escapeHtml(patient.inpatient_no)} · ${escapeHtml(patient.qc_status)}</p>
    </div>
    <div class="header-actions">
      <button class="secondary" type="button" id="runQcBtn">运行质控</button>
      <button class="ghost" type="button" id="saveBtn">保存当前病例</button>
      <button class="danger" type="button" id="deletePatientBtn">删除病例</button>
    </div>
  `;

  document.getElementById("runQcBtn").addEventListener("click", () => {
    state.activeAiTab = "chat";
    state.chat.push({ role: "assistant", text: buildQcAnswer(patient) });
    renderAiTabs();
    renderAiContent();
    toast("已生成本地质控提示");
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    patient.updated_at = new Date().toISOString();
    saveState();
    render();
    toast("已保存到本地浏览器存储");
  });

  document.getElementById("deletePatientBtn").addEventListener("click", () => {
    if (!confirm(`删除 ${patient.research_id}？此操作只影响当前原型本地数据。`)) return;
    state.patients = state.patients.filter((item) => item.patient_uid !== patient.patient_uid);
    if (!state.patients.length) state.patients.push(createPatient());
    state.activePatientId = state.patients[0].patient_uid;
    saveState();
    render();
  });
}

function renderMetrics() {
  const patient = getActivePatient();
  const confirmedDiagnoses = patient.diagnoses.filter((item) => item.confirm_status === "人工确认").length;
  const qcIssues = getQcIssues(patient).length;
  document.getElementById("caseMetrics").innerHTML = `
    ${metric(patient.encounters.length, "住院次")}
    ${metric(confirmedDiagnoses, "已确认诊断")}
    ${metric(patient.labs.length, "化验/检查记录")}
    ${metric(patient.reports.length, "报告文本")}
    ${metric(qcIssues, "质控提醒")}
  `;
}

function metric(value, label) {
  return `<div class="metric"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`;
}

function renderTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  });
}

function renderAiTabs() {
  document.querySelectorAll("[data-ai-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.aiTab === state.activeAiTab);
  });
}

function renderActiveTab() {
  const panel = document.getElementById("tabPanel");
  const patient = getActivePatient();
  const renderers = {
    overview: renderOverview,
    encounter: renderEncounter,
    diagnosis: renderDiagnosis,
    labs: renderLabs,
    reports: renderReports,
    export: renderExport,
    model: renderModelConfig
  };
  panel.innerHTML = renderers[state.activeTab](patient);
  bindActiveTabEvents(patient);
}

function renderOverview(patient) {
  const qc = getQcIssues(patient);
  return `
    <div class="section-grid">
      <section class="section-card full">
        <h3>病例摘要 <span class="badge ${qc.length ? "warn" : "good"}">${qc.length ? "需复核" : "可导出"}</span></h3>
        <div class="form-grid">
          ${inputField("研究编号", "research_id", patient.research_id)}
          ${inputField("住院号", "inpatient_no", patient.inpatient_no)}
          ${inputField("病案号", "medical_record_no", patient.medical_record_no)}
          ${selectField("性别", "sex", patient.sex, ["男", "女", "未知"])}
          ${numberField("年龄", "age_at_admission", patient.age_at_admission)}
          ${selectField("质控状态", "qc_status", patient.qc_status, ["待确认", "已质控", "随访中", "缺失项过多"])}
        </div>
      </section>
      <section class="section-card full">
        <h3>本地质控提醒 <button class="mini-btn" type="button" data-action="go-ai-qc">发送到AI助手</button></h3>
        ${qc.length ? qc.map((item) => `<div class="qc-item"><p>${escapeHtml(item)}</p></div>`).join("") : `<div class="empty">当前病例没有严重质控提醒。</div>`}
      </section>
    </div>
  `;
}

function renderEncounter(patient) {
  const encounter = getIndexEncounter(patient);
  return `
    <section class="section-card full">
      <h3>入院信息与住院天数 <span class="badge">自动计算</span></h3>
      <div class="form-grid">
        ${inputField("入院时间", "admission_date", encounter.admission_date, "date")}
        ${inputField("出院时间", "discharge_date", encounter.discharge_date, "date")}
        ${readonlyField("住院天数", encounter.length_of_stay_display)}
        ${readonlyField("计算规则", "出院日期 - 入院日期 + 1")}
        ${inputField("科室", "department", encounter.department)}
        ${selectField("就诊类型", "visit_type", encounter.visit_type, ["住院", "门诊", "急诊", "随访", "其他"])}
      </div>
      <div class="inline-row" style="margin-top:12px">
        <span class="badge ${encounter.length_of_stay_status === "日期错误" ? "bad" : "good"}">${escapeHtml(encounter.length_of_stay_status)}</span>
        <span class="badge">索引住院次：${escapeHtml(state.exportConfig.indexEncounter)}</span>
      </div>
    </section>
  `;
}

function renderDiagnosis(patient) {
  return `
    <section class="section-card full">
      <h3>多诊断记录 <button class="mini-btn" type="button" data-action="add-diagnosis">新增诊断</button></h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>诊断名称</th><th>角色</th><th>状态</th><th>主诊断</th><th>日期</th><th>来源</th><th>确认</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${patient.diagnoses.map((diagnosis) => diagnosisRow(diagnosis)).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function diagnosisRow(diagnosis) {
  return `
    <tr data-diagnosis-id="${diagnosis.diagnosis_id}">
      <td><input data-diagnosis-field="diagnosis_text_raw" value="${escapeAttr(diagnosis.diagnosis_text_raw)}" /></td>
      <td>${smallSelect("diagnosis_role", diagnosis.diagnosis_role, ["主诊断", "伴随诊断", "入院诊断", "出院诊断", "病理诊断", "复发诊断", "合并症"])}</td>
      <td>${smallSelect("diagnosis_status", diagnosis.diagnosis_status, ["疑似", "临床诊断", "影像提示", "病理证实", "术后证实", "排除", "不详"])}</td>
      <td><button class="mini-btn" data-action="set-primary-diagnosis" type="button">${diagnosis.is_primary_for_model ? "主诊断" : "设为主"}</button></td>
      <td><input type="date" data-diagnosis-field="diagnosis_date" value="${escapeAttr(diagnosis.diagnosis_date || "")}" /></td>
      <td><input data-diagnosis-field="source_doc" value="${escapeAttr(diagnosis.source_doc || "")}" /></td>
      <td><span class="badge ${diagnosis.confirm_status === "人工确认" ? "good" : "warn"}">${escapeHtml(diagnosis.confirm_status)}</span></td>
      <td><button class="mini-btn warn" data-action="delete-diagnosis" type="button">删除</button></td>
    </tr>
  `;
}

function renderLabs(patient) {
  const rule = state.exportConfig.labRule;
  const preview = buildLabWidePreview(patient, rule);
  return `
    ${renderLabScreenshotImport(patient)}
    <section class="section-card full">
      <h3>检查化验长表 <button class="mini-btn" type="button" data-action="add-lab">新增记录</button></h3>
      <div class="table-tools">
        <div class="inline-row">
          <label class="badge">时间规则</label>
          <select id="labRuleSelect">${labRules.map((item) => `<option ${item === rule ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select>
        </div>
        <span class="badge">宽表表头带单位</span>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>项目</th><th>结果</th><th>单位</th><th>采样时间</th><th>报告时间</th><th>异常</th><th>确认</th><th>操作</th></tr>
        </thead>
        <tbody>${patient.labs.map((lab) => labRow(lab)).join("")}</tbody>
      </table>
    </section>
    <section class="section-card full">
      <h3>按“${escapeHtml(rule)}”生成的患者主表宽列预览</h3>
      ${preview.length ? `<table class="data-table"><tbody>${preview.map((row) => `<tr><th>${escapeHtml(row.column)}</th><td>${escapeHtml(row.value)}</td><td>${escapeHtml(row.source)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">当前规则下没有可展开的化验列。</div>`}
    </section>
  `;
}

function renderLabScreenshotImport(patient) {
  const workbench = getOcrWorkbench(patient);
  const cfg = state.ocrConfig;
  return `
    <section class="section-card full">
      <h3>化验截图导入 <span class="badge">图片不入库</span></h3>
      <div class="ocr-grid">
        <div class="upload-box">
          <label class="upload-zone">
            <input data-lab-screenshot-input type="file" accept="image/*" />
            <strong>选择 HIS/LIS 化验截图</strong>
            <span>${workbench.image_name ? escapeHtml(workbench.image_name) : "支持截图、拍照图片；只保存识别文本和确认后的结构化结果"}</span>
          </label>
          ${labScreenshotPreviewUrl ? `<img class="ocr-preview" src="${escapeAttr(labScreenshotPreviewUrl)}" alt="化验截图预览" />` : `<div class="ocr-placeholder">截图预览</div>`}
        </div>
        <div class="ocr-work">
          <div class="ocr-controls">
            <div class="field">
              <label>OCR接口</label>
              <select data-ocr-config="mode">
                ${ocrEngineModes.map((mode) => `<option value="${escapeAttr(mode.key)}" ${cfg.mode === mode.key ? "selected" : ""}>${escapeHtml(mode.label)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>本机服务地址</label>
              <input data-ocr-config="endpoint" value="${escapeAttr(cfg.endpoint)}" />
            </div>
          </div>
          <div class="field">
            <label>OCR识别文本</label>
            <textarea data-ocr-text placeholder="桌面版会自动OCR；浏览器原型可先粘贴本机OCR文字或复制的化验表文本。">${escapeHtml(workbench.ocr_text || "")}</textarea>
          </div>
          <div class="inline-row" style="margin-top:10px">
            <button class="secondary" data-action="run-workbench-ocr" type="button">运行本机OCR</button>
            <button class="secondary" data-action="run-lab-ocr" type="button">解析文本生成候选</button>
            <button class="primary" data-action="confirm-all-lab-candidates" type="button">确认候选入库</button>
            <span class="badge">${escapeHtml(workbench.parsed_at ? `上次识别 ${formatDateTime(workbench.parsed_at)}` : "等待识别")}</span>
            ${workbench.ocr_engine ? `<span class="badge warn">${escapeHtml(workbench.ocr_engine)}</span>` : ""}
            <span class="badge ${cfg.lastStatus === "通过" ? "good" : "warn"}">${escapeHtml(cfg.lastStatus)}</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

function labRow(lab) {
  return `
    <tr data-lab-id="${lab.lab_result_id}">
      <td><input data-lab-field="item_name_raw" value="${escapeAttr(lab.item_name_raw)}" /></td>
      <td><input data-lab-field="value_raw" value="${escapeAttr(lab.value_raw)}" /></td>
      <td><input data-lab-field="unit_raw" value="${escapeAttr(lab.unit_raw)}" /></td>
      <td><input type="date" data-lab-field="specimen_time" value="${escapeAttr(lab.specimen_time)}" /></td>
      <td><input type="date" data-lab-field="report_time" value="${escapeAttr(lab.report_time)}" /></td>
      <td>${smallSelect("abnormal_flag", lab.abnormal_flag, ["正常", "高", "低", "异常", "不详"])}</td>
      <td><span class="badge ${lab.confirm_status === "人工确认" ? "good" : "warn"}">${escapeHtml(lab.confirm_status)}</span></td>
      <td><button class="mini-btn warn" data-action="delete-lab" type="button">删除</button></td>
    </tr>
  `;
}

function renderReports(patient) {
  return `
    <section class="section-card full">
      <h3>报告文本 <button class="mini-btn" type="button" data-action="add-report">新增报告</button></h3>
      <p class="badge">仅保存报告文字/结构化摘要，不保存影像、DICOM、病理切片或大截图</p>
      <table class="data-table" style="margin-top:10px">
        <thead><tr><th>类型</th><th>日期</th><th>标题</th><th>报告号/来源</th><th>摘要</th><th>操作</th></tr></thead>
        <tbody>${patient.reports.map((report) => reportRow(report)).join("")}</tbody>
      </table>
    </section>
    <section class="section-card full">
      <h3>粘贴报告原文，生成本地 AI 候选</h3>
      <div class="field">
        <label>报告原文</label>
        <textarea id="reportScratch" placeholder="可粘贴 HIS/PACS/病理报告文本；首版只做本地规则抽取。">${escapeHtml(patient.report_scratch || "")}</textarea>
      </div>
      <div class="inline-row" style="margin-top:10px">
        <button class="secondary" type="button" data-action="extract-candidates">生成候选字段</button>
        <span class="badge">候选需人工确认后才入库</span>
      </div>
    </section>
  `;
}

function reportRow(report) {
  return `
    <tr data-report-id="${report.report_id}">
      <td>${smallSelect("report_type", report.report_type, ["影像报告", "病理报告", "检查报告", "手术记录", "出院记录", "随访记录", "其他"])}</td>
      <td><input type="date" data-report-field="report_date" value="${escapeAttr(report.report_date || "")}" /></td>
      <td><input data-report-field="report_title" value="${escapeAttr(report.report_title || "")}" /></td>
      <td><input data-report-field="source_ref" value="${escapeAttr(report.source_ref || "")}" /></td>
      <td><textarea data-report-field="structured_summary">${escapeHtml(report.structured_summary || "")}</textarea></td>
      <td><button class="mini-btn warn" data-action="delete-report" type="button">删除</button></td>
    </tr>
  `;
}

function renderExport(patient) {
  const selected = new Set(state.exportConfig.selectedPatients.length ? state.exportConfig.selectedPatients : [patient.patient_uid]);
  const filtered = getExportPatients();
  const preview = buildPatientMasterPreview(filtered);
  const selectedFields = new Set(getSelectedExportFields().map((field) => field.key));
  const preflight = buildExportPreflight(filtered, preview);
  const report = buildExportReport(filtered, preview);
  return `
    <div class="export-stack">
        ${renderImportPreviewPanel()}
        <section class="section-card">
          <h3>自选导出配置</h3>
          <div class="form-grid">
            ${inputField("诊断包含", "export_diagnosisInclude", state.exportConfig.diagnosisInclude)}
            ${inputField("AND 诊断", "export_diagnosisAnd", state.exportConfig.diagnosisAnd)}
            ${inputField("OR 诊断", "export_diagnosisOr", state.exportConfig.diagnosisOr)}
            ${inputField("排除诊断", "export_diagnosisExclude", state.exportConfig.diagnosisExclude)}
            ${selectField("化验时间规则", "export_labRule", state.exportConfig.labRule, labRules)}
            ${selectField("索引住院次", "export_indexEncounter", state.exportConfig.indexEncounter, ["首次相关住院", "手术住院", "最近一次住院", "手动指定住院次"])}
          </div>
          <div class="filter-row">
            ${exportTemplates.map((template) => `<button class="chip" data-export-template="${escapeAttr(template.key)}" type="button">${escapeHtml(template.label)}</button>`).join("")}
          </div>
          <div class="filter-row">
            ${exportGroups.map((group) => `<button class="chip ${state.exportConfig.selectedGroups.includes(group) ? "active" : ""}" data-export-group="${escapeAttr(group)}" type="button">${escapeHtml(group)}</button>`).join("")}
          </div>
          <div class="field-picker">
            ${exportFieldCatalog.map((field) => `
              <label class="chip ${selectedFields.has(field.key) ? "active" : ""}">
                <input type="checkbox" data-export-field="${escapeAttr(field.key)}" ${selectedFields.has(field.key) ? "checked" : ""} />
                ${escapeHtml(field.label)}${field.unit ? ` (${escapeHtml(field.unit)})` : ""}
              </label>
            `).join("")}
          </div>
          <div class="inline-row">
            <button class="primary" type="button" data-action="download-package">生成U盘导出包</button>
            <button class="secondary" type="button" data-action="download-patient-xlsx">导出多Sheet XLSX</button>
            <button class="secondary" type="button" data-action="download-patient-csv">导出患者主表CSV</button>
            <button class="ghost" type="button" data-action="download-export-report">导出报告TXT</button>
            <span class="badge">预计 ${filtered.length} 例 · ${preview.columns.length} 列</span>
          </div>
        </section>
        <section class="section-card" style="margin-top:12px">
          <h3>患者选择</h3>
          <div class="filter-row">
            ${state.patients.map((item) => `<label class="chip ${selected.has(item.patient_uid) ? "active" : ""}"><input type="checkbox" data-export-patient="${item.patient_uid}" ${selected.has(item.patient_uid) ? "checked" : ""} /> ${escapeHtml(item.research_id)}</label>`).join("")}
          </div>
        </section>
        <section class="section-card" style="margin-top:12px">
          <h3>导出前预检</h3>
          <div class="preflight-grid">
            ${preflight.items.map((item) => `<span class="status-pill ${item.level}">${escapeHtml(item.text)}</span>`).join("")}
          </div>
        </section>
        <section class="section-card" style="margin-top:12px">
          <h3>导出报告预览 <span class="badge">随U盘包保存</span></h3>
          <table class="data-table compact-table">
            <tbody>${report.items.map((item) => `<tr><th>${escapeHtml(item.label)}</th><td>${escapeHtml(item.value)}</td></tr>`).join("")}</tbody>
          </table>
        </section>
        <section class="section-card" style="margin-top:12px">
          <h3>患者主表预览 <span class="badge">一行一个患者，一列一个数据种类</span></h3>
          <div class="preview-scroll">${renderPreviewTable(preview)}</div>
        </section>
    </div>
  `;
}

function renderImportPreviewPanel() {
  if (!pendingImportPreview) {
    return `
      <section class="section-card import-panel">
        <h3>导入U盘数据包 <span class="badge">先预览再合并</span></h3>
        <div class="import-empty">
          <label class="file-picker">
            <input data-import-package-input type="file" accept=".json,application/json" />
            <strong>选择 U盘 JSON 导出包</strong>
            <span>APP 会先校验 checksum，再显示新增、重复、冲突、字段清单和数据表计数。</span>
          </label>
        </div>
      </section>
    `;
  }

  const preview = pendingImportPreview;
  const fieldLabels = preview.fieldLabels.length ? preview.fieldLabels : preview.patientColumns;
  return `
    <section class="section-card import-panel">
      <h3>待导入包预览 <span class="badge ${preview.conflictCount ? "bad" : "good"}">${preview.checksumStatus}</span></h3>
      <div class="import-summary">
        ${statusPill(`新增 ${preview.newCount} 例`, preview.newCount ? "good" : "warn")}
        ${statusPill(`新增明细 ${preview.detailNewCount} 条`, preview.detailNewCount ? "good" : "warn")}
        ${statusPill(`重复 ${preview.duplicateCount} 例`, preview.duplicateCount ? "warn" : "good")}
        ${statusPill(`冲突 ${preview.conflictCount} 例`, preview.conflictCount ? "bad" : "good")}
        ${statusPill(`明细冲突 ${preview.detailConflictCount || 0} 条`, preview.detailConflictCount ? "bad" : "good")}
        ${statusPill(`字段 ${fieldLabels.length} 个`, fieldLabels.length ? "good" : "warn")}
      </div>
      <table class="data-table compact-table import-meta">
        <tbody>
          <tr><th>导出批次</th><td>${escapeHtml(preview.exportId)}</td><th>来源设备</th><td>${escapeHtml(preview.sourceDevice)}</td></tr>
          <tr><th>导出时间</th><td>${escapeHtml(formatDateTime(preview.createdAt))}</td><th>病例数</th><td>${escapeHtml(String(preview.patientCount))}</td></tr>
        </tbody>
      </table>
      <div class="import-counts">
        ${preview.tableCounts.map((item) => `<span class="status-pill ${item.count ? "good" : "warn"}">${escapeHtml(item.label)} ${item.count}</span>`).join("")}
      </div>
      <h4 class="subheading">字段清单</h4>
      <div class="field-picker import-fields">
        ${fieldLabels.map((label) => `<span class="chip active">${escapeHtml(label)}</span>`).join("") || `<span class="badge warn">未读取到字段清单</span>`}
      </div>
      <h4 class="subheading">患者导入状态</h4>
      <div class="preview-scroll import-preview-scroll">
        <table class="data-table">
          <thead><tr><th>研究编号</th><th>住院号</th><th>状态</th><th>原因</th><th>详情</th></tr></thead>
          <tbody>
            ${preview.patientRows.map((row) => `
              <tr>
                <td>${escapeHtml(row.research_id || "--")}</td>
                <td>${escapeHtml(row.inpatient_no || "--")}</td>
                <td><span class="badge ${row.level}">${escapeHtml(row.statusText)}</span></td>
                <td>${escapeHtml(row.reason)}</td>
                <td>${renderImportConflictDetails(row)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="inline-row import-actions">
        <button class="primary" data-action="confirm-import-package" type="button" ${preview.newCount || preview.detailNewCount ? "" : "disabled"} ${pendingImportInProgress ? "disabled" : ""}>${pendingImportInProgress ? "正在导入..." : "确认合并数据"}</button>
        <button class="ghost" data-action="cancel-import-package" type="button">取消导入</button>
        <span class="badge">重复病例可合并新增明细，冲突记录不会自动覆盖</span>
      </div>
    </section>
  `;
}

function renderImportConflictDetails(row) {
  const details = row.conflictDetails || [];
  if (!details.length) return `<span class="badge good">无冲突</span>`;
  return `
    <details class="import-conflict-details">
      <summary>${escapeHtml(details.length)} 项</summary>
      ${details.map((detail) => `
        <div class="conflict-block">
          <strong>${escapeHtml(detail.scope)} · ${escapeHtml(detail.title)}</strong>
          <p>${escapeHtml(detail.reason)}</p>
          <table class="conflict-table">
            <tbody>
              ${detail.fields.map((field) => `
                <tr>
                  <th>${escapeHtml(field.label)}</th>
                  <td><span>本机</span>${escapeHtml(field.local || "--")}</td>
                  <td><span>导入包</span>${escapeHtml(field.incoming || "--")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `).join("")}
    </details>
  `;
}

function renderModelConfig() {
  const cfg = state.modelConfig;
  return `
    <div class="section-grid compact-grid">
      <section class="section-card full">
        <h3>AI模型配置 <span class="badge ${cfg.enabled ? "good" : "warn"}">${escapeHtml(cfg.status)}</span></h3>
        <div class="form-grid">
          ${selectField("运行模式", "model_mode", cfg.mode, ["规则助手", "本地小模型", "禁用AI"])}
          ${selectField("推理后端", "model_runner", cfg.runner, ["llama.cpp", "Ollama", "Transformers/Python"])}
          ${selectField("推荐模型", "model_model", cfg.model, ["规则助手内置知识库", "Qwen/Qwen3-0.6B", "Qwen/Qwen3-1.7B-GGUF", "Qwen/Qwen3-4B-GGUF", "ggml-org/gemma-4-E2B-it-GGUF", "ggml-org/gemma-4-E4B-it-GGUF"])}
          ${numberField("上下文长度", "model_contextTokens", cfg.contextTokens)}
          ${numberField("最大输出", "model_maxOutputTokens", cfg.maxOutputTokens)}
          ${readonlyField("部署状态", cfg.status)}
          ${readonlyField("文件大小", cfg.modelFileSize || "未选择")}
          ${readonlyField("自检结果", cfg.lastTestResult || "未测试")}
          <div class="field full">
            <label>离线模型文件</label>
            <label class="file-picker">
              <input id="modelFileInput" type="file" accept=".gguf,.bin,.onnx,.safetensors" />
              <span>${escapeHtml(cfg.modelFileName || "选择本机或U盘中的模型文件")}</span>
            </label>
          </div>
          ${readonlyField("模型SHA-256", cfg.modelFileHash || "未校验")}
        </div>
        <div class="inline-row" style="margin-top:12px">
          <button class="secondary" data-action="save-model-config" type="button">保存模型配置</button>
          <button class="primary" data-action="enable-model" type="button">启用AI</button>
          <button class="danger" data-action="disable-model" type="button">停用AI</button>
          <button class="ghost" data-action="test-model" type="button">自检</button>
        </div>
      </section>
    </div>
  `;
}

function bindActiveTabEvents(patient) {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action, button));
  });

  document.querySelectorAll(".field [data-field]").forEach((input) => {
    input.addEventListener("input", () => updatePatientField(patient, input.dataset.field, input.value));
  });

  document.querySelectorAll("[data-diagnosis-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const row = input.closest("[data-diagnosis-id]");
      const item = patient.diagnoses.find((diagnosis) => diagnosis.diagnosis_id === row.dataset.diagnosisId);
      item[input.dataset.diagnosisField] = input.value;
      item.confirm_status = "人工确认";
      touch(patient);
    });
  });

  document.querySelectorAll("[data-lab-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const row = input.closest("[data-lab-id]");
      const item = patient.labs.find((lab) => lab.lab_result_id === row.dataset.labId);
      item[input.dataset.labField] = input.value;
      item.confirm_status = "人工确认";
      touch(patient);
    });
  });

  document.querySelectorAll("[data-report-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const row = input.closest("[data-report-id]");
      const item = patient.reports.find((report) => report.report_id === row.dataset.reportId);
      item[input.dataset.reportField] = input.value;
      item.confirm_status = "人工确认";
      touch(patient);
    });
  });

  const labRule = document.getElementById("labRuleSelect");
  if (labRule) {
    labRule.addEventListener("change", () => {
      state.exportConfig.labRule = labRule.value;
      saveState();
      renderActiveTab();
    });
  }

  const scratch = document.getElementById("reportScratch");
  if (scratch) {
    scratch.addEventListener("input", () => {
      patient.report_scratch = scratch.value;
      touch(patient, false);
    });
  }

  bindOcrEvents(patient);

  document.querySelectorAll("[data-export-patient]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.exportPatient;
      const set = new Set(state.exportConfig.selectedPatients);
      if (input.checked) set.add(id);
      else set.delete(id);
      state.exportConfig.selectedPatients = [...set];
      saveState();
      renderActiveTab();
    });
  });

  document.querySelectorAll("[data-export-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.dataset.exportGroup;
      const set = new Set(state.exportConfig.selectedGroups);
      const fieldSet = new Set(state.exportConfig.selectedFields || defaultExportFieldKeys);
      const groupFields = exportFieldCatalog.filter((field) => field.group === group).map((field) => field.key);
      if (set.has(group)) {
        set.delete(group);
        groupFields.forEach((key) => fieldSet.delete(key));
      } else {
        set.add(group);
        groupFields.forEach((key) => fieldSet.add(key));
      }
      state.exportConfig.selectedGroups = [...set];
      state.exportConfig.selectedFields = [...fieldSet];
      saveState();
      renderActiveTab();
    });
  });

  document.querySelectorAll("[data-export-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const fieldKey = input.dataset.exportField;
      const set = new Set(state.exportConfig.selectedFields || defaultExportFieldKeys);
      if (input.checked) set.add(fieldKey);
      else set.delete(fieldKey);
      state.exportConfig.selectedFields = [...set];
      state.exportConfig.selectedGroups = [
        ...new Set(
          exportFieldCatalog
            .filter((field) => set.has(field.key))
            .map((field) => field.group)
        )
      ];
      saveState();
      renderActiveTab();
    });
  });

  document.querySelectorAll("[data-export-template]").forEach((button) => {
    button.addEventListener("click", () => {
      const template = exportTemplates.find((item) => item.key === button.dataset.exportTemplate);
      if (!template) return;
      state.exportConfig.selectedFields = [...template.fields];
      state.exportConfig.selectedGroups = [
        ...new Set(exportFieldCatalog.filter((field) => template.fields.includes(field.key)).map((field) => field.group))
      ];
      saveState();
      renderActiveTab();
      toast(`已应用${template.label}`);
    });
  });

  ["export_diagnosisInclude", "export_diagnosisAnd", "export_diagnosisOr", "export_diagnosisExclude", "export_labRule", "export_indexEncounter"].forEach((id) => {
    const input = document.querySelector(`[data-field="${id}"]`);
    if (!input) return;
    input.addEventListener("input", () => {
      const key = id.replace("export_", "");
      state.exportConfig[key] = input.value;
      saveState();
      renderActiveTab();
    });
  });

  ["model_mode", "model_runner", "model_model", "model_contextTokens", "model_maxOutputTokens"].forEach((id) => {
    const input = document.querySelector(`[data-field="${id}"]`);
    if (!input) return;
    input.addEventListener("input", () => {
      const key = id.replace("model_", "");
      state.modelConfig[key] = input.type === "number" ? Number(input.value) : input.value;
      saveState();
    });
  });

  const modelFileInput = document.getElementById("modelFileInput");
  if (modelFileInput) {
    modelFileInput.addEventListener("change", () => handleModelFile(modelFileInput.files?.[0]));
  }

  document.querySelectorAll("[data-import-package-input]").forEach((input) => {
    input.addEventListener("change", handleImportFile);
  });
}

async function handleAction(action, button) {
  const patient = getActivePatient();
  if (action === "go-ai-qc") {
    state.activeAiTab = "chat";
    state.chat.push({ role: "assistant", text: buildQcAnswer(patient) });
    renderAiTabs();
    renderAiContent();
    return;
  }
  if (action === "add-diagnosis") {
    patient.diagnoses.push(createDiagnosis({ diagnosis_text_raw: "待填写诊断", diagnosis_role: "伴随诊断" }));
  }
  if (action === "delete-diagnosis") {
    const id = button.closest("[data-diagnosis-id]").dataset.diagnosisId;
    patient.diagnoses = patient.diagnoses.filter((item) => item.diagnosis_id !== id);
  }
  if (action === "set-primary-diagnosis") {
    const id = button.closest("[data-diagnosis-id]").dataset.diagnosisId;
    patient.diagnoses.forEach((item) => {
      item.is_primary_for_model = item.diagnosis_id === id;
      if (item.is_primary_for_model) item.diagnosis_role = "主诊断";
    });
  }
  if (action === "add-lab") {
    patient.labs.push(createLab({ item_name_raw: "白蛋白", value_raw: "", unit_raw: "g/L" }));
  }
  if (action === "delete-lab") {
    const id = button.closest("[data-lab-id]").dataset.labId;
    patient.labs = patient.labs.filter((item) => item.lab_result_id !== id);
  }
  if (action === "add-report") {
    patient.reports.push(createReport({ report_type: "影像报告", report_title: "CT报告" }));
  }
  if (action === "delete-report") {
    const id = button.closest("[data-report-id]").dataset.reportId;
    patient.reports = patient.reports.filter((item) => item.report_id !== id);
  }
  if (action === "extract-candidates") {
    patient.candidates = extractCandidates(patient.report_scratch || "");
    state.activeAiTab = "candidates";
    toast(`已生成 ${patient.candidates.length} 条候选`);
  }
  if (action === "run-lab-ocr") {
    const count = runLabOcrForPatient(patient, { allowSampleFallback: true });
    toast(`已生成 ${count} 条化验候选`);
    render();
    return;
  }
  if (action === "run-workbench-ocr") {
    try {
      const count = await runWorkbenchOcrForPatient(patient);
      toast(`OCR完成，已生成 ${count} 条化验候选`);
    } catch (error) {
      toast(`OCR失败：${error.message}`);
    }
    render();
    return;
  }
  if (action === "confirm-all-lab-candidates") {
    const labCandidates = getCandidates(patient).filter((item) => item.field?.startsWith("lab:"));
    labCandidates.forEach((candidate) => applyCandidate(patient, candidate));
    patient.candidates = (patient.candidates || []).filter((item) => !item.field?.startsWith("lab:"));
    touch(patient);
    toast(`已确认入库 ${labCandidates.length} 条化验记录`);
    render();
    return;
  }
  if (action === "download-package") {
    downloadPackage();
    return;
  }
  if (action === "download-patient-csv") {
    downloadPatientCsv();
    return;
  }
  if (action === "download-patient-xlsx") {
    downloadPatientXlsx();
    return;
  }
  if (action === "download-export-report") {
    downloadExportReport();
    return;
  }
  if (action === "confirm-import-package") {
    confirmPendingImport();
    return;
  }
  if (action === "cancel-import-package") {
    clearPendingImport();
    toast("已取消导入预览");
    render();
    return;
  }
  if (action === "save-model-config") {
    state.modelConfig.status =
      state.modelConfig.mode === "禁用AI" ? "已禁用" : state.modelConfig.mode === "规则助手" ? "规则助手已保存" : "等待模型文件";
    saveState();
    toast("模型配置已保存");
    render();
    return;
  }
  if (action === "enable-model") {
    if (state.modelConfig.mode === "禁用AI") {
      state.modelConfig.enabled = false;
      state.modelConfig.status = "已禁用";
      saveState();
      toast("当前运行模式为禁用AI");
      render();
      return;
    }
    if (state.modelConfig.mode === "本地小模型" && !state.modelConfig.modelFileName) {
      state.modelConfig.enabled = false;
      state.modelConfig.status = "等待模型文件";
      saveState();
      toast("请先选择离线模型文件");
      render();
      return;
    }
    state.modelConfig.enabled = true;
    state.modelConfig.status = state.modelConfig.mode === "本地小模型" ? "本地模型已启用" : "规则助手已启用";
    saveState();
    toast("AI 已启用");
    render();
    return;
  }
  if (action === "disable-model") {
    state.modelConfig.enabled = false;
    state.modelConfig.status = "未启用";
    saveState();
    toast("AI 已停用");
    render();
    return;
  }
  if (action === "test-model") {
    state.modelConfig.lastTestResult = state.modelConfig.enabled ? "通过" : "未运行";
    state.modelConfig.status = state.modelConfig.enabled ? "自检通过" : "未启用";
    saveState();
    toast(state.modelConfig.enabled ? "模型自检通过" : "请先启用AI");
    render();
    return;
  }
  if (action === "model-help") {
    state.activeAiTab = "chat";
    state.chat.push({
      role: "assistant",
      text: "推荐先用规则助手跑通流程；需要真实本地模型时，用 llama.cpp + GGUF 小模型。开发阶段可用 Ollama 测试，正式离线部署时固定模型文件、版本和 SHA-256。"
    });
    renderAiTabs();
    renderAiContent();
    return;
  }
  touch(patient);
  render();
}

function updatePatientField(patient, field, value) {
  if (field.startsWith("export_")) return;
  if (["admission_date", "discharge_date", "department", "visit_type"].includes(field)) {
    const encounter = getIndexEncounter(patient);
    encounter[field] = value;
    computeLengthOfStay(encounter);
  } else if (field === "age_at_admission") {
    patient[field] = value ? Number(value) : "";
  } else {
    patient[field] = value;
  }
  touch(patient);
  renderHeader();
  renderMetrics();
  renderPatientList();
  renderAiContent();
}

function renderAiContent() {
  const patient = getActivePatient();
  const content = document.getElementById("aiContent");
  if (state.activeAiTab === "capture") content.innerHTML = renderLabScreenshotImport(patient);
  if (state.activeAiTab === "candidates") content.innerHTML = renderCandidates(patient);
  if (state.activeAiTab === "chat") content.innerHTML = renderChat(patient);
  if (state.activeAiTab === "trace") content.innerHTML = renderTrace(patient);
  bindAiEvents(patient);
}

function renderCandidates(patient) {
  const candidates = getCandidates(patient);
  if (!candidates.length) {
    return `
      ${renderLabScreenshotImport(patient)}
      <div class="empty">暂无候选。上传化验截图或粘贴报告文字后，点击识别生成候选字段。</div>
    `;
  }
  return `
    ${renderLabScreenshotImport(patient)}
    <div class="inline-row candidate-toolbar">
      <button class="primary" data-action="confirm-all-lab-candidates" type="button">确认全部化验候选入库</button>
      <span class="badge">候选需人工确认</span>
    </div>
    ${candidates
    .map((candidate) => `
      <article class="candidate-card" data-candidate-id="${candidate.id}">
        <h4>${escapeHtml(candidate.label)} <span class="badge">${Math.round(candidate.confidence * 100)}%</span></h4>
        <p><b>候选值：</b>${escapeHtml(candidate.value)}</p>
        <p><b>来源：</b>${escapeHtml(candidate.source)} · ${escapeHtml(candidate.snippet)}</p>
        <div class="candidate-actions">
          <button class="mini-btn" data-ai-action="confirm-candidate" type="button">确认</button>
          <button class="mini-btn" data-ai-action="edit-candidate" type="button">编辑后确认</button>
          <button class="mini-btn warn" data-ai-action="reject-candidate" type="button">忽略</button>
        </div>
      </article>
    `)
    .join("")}
  `;
}

function renderChat(patient) {
  return `
    <div class="assistant-log">
      ${state.chat.map((message) => `<div class="chat-message ${message.role === "user" ? "user" : "assistant"}"><b>${message.role === "user" ? "用户" : "离线助手"}</b><p>${escapeHtml(message.text)}</p></div>`).join("")}
    </div>
    <div class="assistant-input">
      <input id="assistantQuestion" placeholder="问：如何导出一行一个患者的 Excel？" />
      <button class="primary" id="assistantSend" type="button">发送</button>
    </div>
    <div class="quick-questions">
      ${["住院天数怎么算？", "如何导出到U盘？", "CA19-9单位怎么处理？", "导出前检查缺失项"].map((question) => `<button class="chip" data-question="${escapeAttr(question)}" type="button">${escapeHtml(question)}</button>`).join("")}
    </div>
    <div class="qc-item"><p>边界：不联网、不诊断、不提供治疗建议、不自动覆盖人工确认数据。</p></div>
  `;
}

function renderTrace(patient) {
  const traces = [
    ...patient.labs.map((lab) => ({
      title: `${lab.item_name_raw} ${lab.value_raw}${lab.unit_raw || ""}`,
      body: lab.source_text || "来源：检验报告文本。"
    })),
    ...patient.reports.map((report) => ({
      title: `${report.report_type} · ${report.report_title}`,
      body: report.report_text_raw || report.structured_summary || "报告文本未录入。"
    }))
  ];
  if (!traces.length) return `<div class="empty">暂无来源记录。</div>`;
  return traces
    .map((trace) => `<article class="trace-card"><h4>${escapeHtml(trace.title)}</h4><p>${escapeHtml(trace.body).slice(0, 260)}</p></article>`)
    .join("");
}

function bindAiEvents(patient) {
  bindOcrEvents(patient);

  document.querySelectorAll("#aiContent [data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action, button));
  });

  document.querySelectorAll("[data-ai-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.closest("[data-candidate-id]").dataset.candidateId;
      const candidate = patient.candidates.find((item) => item.id === id);
      if (!candidate) return;
      if (button.dataset.aiAction === "reject-candidate") {
        candidate.status = "忽略";
        patient.candidates = patient.candidates.filter((item) => item.id !== id);
        toast("已忽略候选");
      } else {
        applyCandidate(patient, candidate);
        patient.candidates = patient.candidates.filter((item) => item.id !== id);
        toast("候选已人工确认入库");
      }
      touch(patient);
      render();
    });
  });

  document.querySelectorAll("[data-question]").forEach((button) => {
    button.addEventListener("click", () => askAssistant(button.dataset.question));
  });

  const send = document.getElementById("assistantSend");
  if (send) {
    send.addEventListener("click", () => {
      const input = document.getElementById("assistantQuestion");
      askAssistant(input.value);
      input.value = "";
    });
  }
}

function bindOcrEvents(patient) {
  document.querySelectorAll("[data-lab-screenshot-input]").forEach((input) => {
    input.addEventListener("change", () => handleLabScreenshotFile(input.files?.[0], patient));
  });

  document.querySelectorAll("[data-ocr-text]").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const workbench = getOcrWorkbench(patient);
      workbench.ocr_text = textarea.value;
      touch(patient, false);
    });
  });

  document.querySelectorAll("[data-ocr-config]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.ocrConfig;
      state.ocrConfig[key] = key === "timeoutMs" ? Number(input.value) : input.value;
      saveState();
    });
  });
}

function askAssistant(question) {
  const trimmed = question.trim();
  if (!trimmed) return;
  state.chat.push({ role: "user", text: trimmed });
  state.chat.push({ role: "assistant", text: answerQuestion(trimmed, getActivePatient()) });
  state.chat = state.chat.slice(-20);
  saveState();
  renderAiContent();
}

function answerQuestion(question, patient) {
  if (/缺失|质控|检查/.test(question)) return buildQcAnswer(patient);
  const lower = question.toLowerCase();
  const hit = knowledgeBase.find((item) => item.keys.some((key) => lower.includes(key.toLowerCase())));
  if (hit) return `${hit.answer}\n\n依据：本地知识库。`;
  return "我可以回答软件使用、字段填写、导出导入、单位和本地质控问题。这个问题没有命中本地知识库，建议查看字段字典或缩小到具体字段。";
}

function buildQcAnswer(patient) {
  const issues = getQcIssues(patient);
  if (!issues.length) return `${patient.research_id} 当前未发现严重缺失或逻辑冲突，可继续导出前预览。`;
  return `${patient.research_id} 当前建议复核：\n${issues.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
}

function getQcIssues(patient) {
  const issues = [];
  const encounter = getIndexEncounter(patient);
  if (!patient.sex || patient.sex === "未知") issues.push("性别未确认。");
  if (!patient.age_at_admission) issues.push("入院年龄未填写。");
  if (!getPrimaryDiagnosis(patient)) issues.push("未设置本研究主诊断。");
  if (!encounter.admission_date) issues.push("入院时间未填写。");
  if (encounter.length_of_stay_status === "日期错误") issues.push("出院时间早于入院时间，请复核。");
  if (!patient.reports.length) issues.push("尚未录入影像/病理/出院等报告文本。");
  if (!patient.labs.length) issues.push("尚未录入化验或检查记录。");
  if (patient.candidates?.length) issues.push(`仍有 ${patient.candidates.length} 条 AI 候选字段待确认。`);
  const deathFollowup = patient.followup?.find((item) => item.survival_status === "死亡" && !item.death_date);
  if (deathFollowup) issues.push("生存状态为死亡，但死亡日期为空。");
  return issues;
}

function getCandidates(patient) {
  return (patient.candidates || []).filter((item) => item.status !== "忽略");
}

function extractCandidates(text) {
  if (!text.trim()) return [];
  const candidates = [];
  const add = (label, field, value, source = "报告原文", confidence = 0.86) => {
    if (!value) return;
    candidates.push({
      id: uid("cand"),
      label,
      field,
      value: String(value).trim(),
      source,
      snippet: text.slice(0, 72),
      confidence,
      status: "待确认"
    });
  };
  add("诊断", "diagnosis", matchText(text, /(胰腺癌|胰腺导管腺癌|胰头癌|胰体尾癌)/));
  add("CA19-9", "lab:CA19-9:U/mL", matchText(text, /CA\s*19-?9[:：]?\s*([<>]?\s*\d+\.?\d*)/i));
  add("白蛋白", "lab:白蛋白:g/L", matchText(text, /白蛋白[:：]?\s*([<>]?\s*\d+\.?\d*)/));
  add("总胆红素", "lab:总胆红素:μmol/L", matchText(text, /总胆红素[:：]?\s*([<>]?\s*\d+\.?\d*)/));
  add("病理类型", "reportSummary", matchText(text, /(导管腺癌|腺癌|神经内分泌肿瘤)/));
  add("报告日期", "reportDate", matchText(text, /(20\d{2}[-/年]\d{1,2}[-/月]\d{1,2})/));
  return candidates;
}

function extractLabCandidatesFromText(text, sourceName) {
  const sourceDate = normalizeDate(matchText(text, /(20\d{2}[-/年]\d{1,2}[-/月]\d{1,2})/)) || new Date().toISOString().slice(0, 10);
  return text
    .split(/\r?\n/)
    .map(parseLabOcrLine)
    .filter(Boolean)
    .map((lab) => ({
      id: uid("cand"),
      label: `${lab.code} ${lab.name}`,
      field: `lab:${lab.name}:${lab.unit}`,
      value: lab.value,
      source: `化验截图OCR · ${sourceName}`,
      snippet: `${lab.code} ${lab.name} ${lab.value} ${lab.unit} ${lab.flag || ""}`,
      confidence: lab.confidence,
      status: "待确认",
      payload: {
        item_name_raw: lab.name,
        item_name_std: lab.code,
        value_raw: lab.value,
        unit_raw: lab.unit,
        reference_range: lab.reference,
        abnormal_flag: lab.flag || "正常",
        specimen_time: sourceDate,
        report_time: sourceDate,
        source_text: `${sourceName}: ${lab.raw}`
      }
    }));
}

function parseLabOcrLine(line) {
  const raw = line.trim();
  if (!raw || /申请日期|报告名称|项目名称|参考范围/.test(raw)) return null;
  const cells = raw.includes("\t") ? raw.split("\t").map((item) => item.trim()) : raw.split(/\s{2,}|\s(?=[HL高低]\s)|\s(?=\d+(?:\.\d+)?)/).map((item) => item.trim());
  if (cells.length < 4) return parseLabOcrLineByDictionary(raw);
  const code = cells[0].replace(/^★/, "");
  const valueIndex = cells.findIndex((item, index) => index > 0 && /^[<>]?\d+(?:\.\d+)?$/.test(item));
  if (valueIndex < 2) return parseLabOcrLineByDictionary(raw);
  const dictionaryHit = findLabDictionaryEntry(raw);
  const name = cells.slice(1, valueIndex).join("").replace(/^★/, "") || dictionaryHit?.name || code;
  const value = cells[valueIndex];
  const flagCell = cells[valueIndex + 1] || "";
  const hasFlag = /^[HL高低]$/.test(flagCell);
  const hasEmptyFlagCell = flagCell === "" && cells[valueIndex + 2];
  const unitOffset = hasFlag || hasEmptyFlagCell ? 2 : 1;
  const unit = cells[valueIndex + unitOffset] || dictionaryHit?.unit || "";
  const reference = cells[valueIndex + unitOffset + 1] || "";
  if (!name || !unit) return parseLabOcrLineByDictionary(raw);
  return {
    raw,
    code,
    name,
    value,
    flag: normalizeAbnormalFlag(flagCell),
    unit: normalizeUnit(unit),
    reference,
    confidence: raw.includes("\t") ? 0.94 : 0.82
  };
}

function parseLabOcrLineByDictionary(raw) {
  const entry = findLabDictionaryEntry(raw);
  if (!entry) return null;
  const alias = entry.aliases.find((item) => raw.toLowerCase().includes(item.toLowerCase())) || entry.aliases[0];
  const start = raw.toLowerCase().indexOf(alias.toLowerCase());
  const afterAlias = raw.slice(Math.max(0, start + alias.length)).replace(/^★/, "");
  const match = afterAlias.match(/([<>]?\d+(?:\.\d+)?)(?:\s*([HL高低]))?(?:\s*([%a-zA-Zμµ^~0-9/.-]+))?(?:\s+([\d.]+[-–~][\d.]+))?/);
  if (!match) return null;
  return {
    raw,
    code: entry.aliases[0],
    name: entry.name,
    value: match[1],
    flag: normalizeAbnormalFlag(match[2] || ""),
    unit: normalizeUnit(match[3] || entry.unit),
    reference: match[4] || "",
    confidence: 0.78
  };
}

function findLabDictionaryEntry(text) {
  const compact = String(text).replace(/\s+/g, "").toLowerCase();
  return labItemDictionary.find((entry) => entry.aliases.some((alias) => compact.includes(alias.replace(/\s+/g, "").toLowerCase())));
}

function normalizeAbnormalFlag(flag) {
  if (flag === "H" || flag === "高") return "高";
  if (flag === "L" || flag === "低") return "低";
  return "";
}

function normalizeUnit(unit) {
  return unit.replace(/10[~^](\d+)/g, "10^$1").replace("／", "/");
}

function normalizeDate(value) {
  if (!value) return "";
  const match = String(value).match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function getOcrWorkbench(patient) {
  if (!patient.ocr_workbench) {
    patient.ocr_workbench = {
      image_name: "",
      image_size: "",
      ocr_text: "",
      parsed_at: "",
      source_type: "化验截图"
    };
  }
  return patient.ocr_workbench;
}

async function handleLabScreenshotFile(file, patient) {
  if (!file) return;
  const workbench = getOcrWorkbench(patient);
  workbench.image_name = file.name;
  workbench.image_size = `${Math.max(1, Math.round(file.size / 1024))}KB`;
  workbench.source_type = "化验截图";
  labScreenshotPreviewUrl = await readFileAsDataUrl(file);
  labScreenshotOcrPayload = {
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    dataUrl: labScreenshotPreviewUrl
  };
  const count = state.ocrConfig.mode === "manual" ? runLabOcrForPatient(patient, { allowSampleFallback: true }) : 0;
  touch(patient);
  render();
  toast(count ? `截图已载入，已生成 ${count} 条候选；图片本身不入库` : "截图已载入，可运行本机OCR；图片本身不入库");
}

async function runWorkbenchOcrForPatient(patient) {
  const workbench = getOcrWorkbench(patient);
  try {
    const response = await requestOcrText(buildOcrRequest(patient, workbench));
    if (response.text) {
      workbench.ocr_text = response.text;
      workbench.ocr_engine = response.engine || state.ocrConfig.lastEngine || "本机OCR";
    }
    state.ocrConfig.lastStatus = "通过";
    state.ocrConfig.lastEngine = workbench.ocr_engine || state.ocrConfig.lastEngine;
    const count = runLabOcrForPatient(patient, { allowSampleFallback: state.ocrConfig.mode === "manual" });
    saveState();
    return count;
  } catch (error) {
    state.ocrConfig.lastStatus = `失败：${error.message}`;
    saveState();
    throw error;
  }
}

function buildOcrRequest(patient, workbench) {
  return {
    request_id: uid("ocr"),
    app_schema_version: "v3",
    task: "lab_table_ocr",
    image: labScreenshotOcrPayload
      ? {
        name: labScreenshotOcrPayload.name,
        size: labScreenshotOcrPayload.size,
        type: labScreenshotOcrPayload.type,
        data_url: labScreenshotOcrPayload.dataUrl
      }
      : null,
    manual_text: workbench.ocr_text || "",
    options: {
      language: "zh-CN",
      table_hint: true,
      return_text: true,
      return_boxes: false
    },
    patient_context: {
      patient_uid: patient.patient_uid,
      research_id: patient.research_id,
      image_name: workbench.image_name || ""
    }
  };
}

async function requestOcrText(request) {
  const cfg = state.ocrConfig;
  if (cfg.mode === "manual") {
    return {
      text: request.manual_text || sampleLabOcrText,
      engine: request.manual_text ? "手动粘贴文本" : "浏览器原型模拟OCR"
    };
  }
  if (cfg.mode === "desktopBridge") {
    const bridge = window.clinicalOcrBridge;
    const recognize = bridge?.recognizeLabImage || bridge?.recognizeImage;
    if (!recognize) throw new Error("未检测到桌面OCR桥接");
    return normalizeOcrResponse(await recognize(request));
  }
  if (cfg.mode === "localHttp") {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), Number(cfg.timeoutMs) || 15000);
    try {
      const response = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      return normalizeOcrResponse(payload);
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw new Error("未知OCR接口");
}

function normalizeOcrResponse(payload) {
  if (typeof payload === "string") return { text: payload, engine: state.ocrConfig.mode };
  return {
    text: payload.text || payload.ocr_text || payload.result || "",
    engine: payload.engine || payload.provider || state.ocrConfig.mode,
    confidence: payload.confidence || ""
  };
}

function runLabOcrForPatient(patient, options = {}) {
  const workbench = getOcrWorkbench(patient);
  if (!workbench.ocr_text.trim() && options.allowSampleFallback) {
    workbench.ocr_text = sampleLabOcrText;
    workbench.ocr_engine = "浏览器原型模拟OCR";
  }
  if (!workbench.ocr_text.trim()) return 0;
  const candidates = extractLabCandidatesFromText(workbench.ocr_text, workbench.image_name || "化验截图");
  patient.candidates = [
    ...(patient.candidates || []).filter((item) => !item.field?.startsWith("lab:")),
    ...candidates
  ];
  workbench.parsed_at = new Date().toISOString();
  state.activeAiTab = "candidates";
  touch(patient);
  return candidates.length;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleModelFile(file) {
  if (!file) return;
  state.modelConfig.modelFileName = file.name;
  state.modelConfig.modelFileSize = `${Math.max(1, Math.round(file.size / 1024 / 1024))}MB`;
  if (file.size <= 100 * 1024 * 1024) {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    state.modelConfig.modelFileHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    state.modelConfig.status = "模型文件已校验";
  } else {
    state.modelConfig.modelFileHash = "大文件将在桌面版流式校验";
    state.modelConfig.status = "模型文件已选择";
  }
  saveState();
  toast("模型文件已选择");
  render();
}

function applyCandidate(patient, candidate) {
  if (candidate.field === "diagnosis") {
    patient.diagnoses.push(
      createDiagnosis({
        diagnosis_text_raw: candidate.value,
        diagnosis_role: patient.diagnoses.some((item) => item.is_primary_for_model) ? "伴随诊断" : "主诊断",
        diagnosis_status: /导管腺癌|病理/.test(candidate.value) ? "病理证实" : "临床诊断",
        is_primary_for_model: !patient.diagnoses.some((item) => item.is_primary_for_model),
        source_doc: candidate.source
      })
    );
  } else if (candidate.field.startsWith("lab:")) {
    const [, itemName, unit] = candidate.field.split(":");
    patient.labs.push(createLab({ item_name_raw: itemName, value_raw: candidate.value, unit_raw: unit, source_text: candidate.snippet, ...(candidate.payload || {}) }));
  } else if (candidate.field === "reportSummary") {
    patient.reports.push(createReport({ report_type: "病理报告", report_title: "AI候选病理摘要", structured_summary: candidate.value, report_text_raw: patient.report_scratch || "" }));
  }
}

async function downloadPackage() {
  const patients = getExportPatients();
  const exportId = uid("export");
  const generatedAt = new Date().toISOString();
  const files = buildExportFiles(patients, exportId, generatedAt);
  const checksums = {};
  for (const [path, content] of Object.entries(files)) checksums[path] = await sha256(content);
  files["checksum.sha256"] = Object.entries(checksums)
    .map(([path, hash]) => `${hash}  ${path}`)
    .join("\n");
  const manifest = {
    export_id: exportId,
    app_version: "0.1-static",
    schema_version: "v3",
    source_site: "demo-offline",
    source_device: "clinical-pc-demo",
    created_at: generatedAt,
    patient_count: patients.length,
    field_selection: {
      groups: state.exportConfig.selectedGroups,
      fields: getSelectedExportFields().map((field) => ({ key: field.key, label: field.label, group: field.group }))
    },
    diagnosis_filter: {
      include: state.exportConfig.diagnosisInclude,
      and: state.exportConfig.diagnosisAnd,
      or: state.exportConfig.diagnosisOr,
      exclude: state.exportConfig.diagnosisExclude
    },
    lab_time_rule: state.exportConfig.labRule,
    file_checksums: checksums
  };
  files["export_manifest.json"] = JSON.stringify(manifest, null, 2);
  const packageFile = { package_type: "ClinicalDataExport", template: "pancreatic_cancer_v1", manifest, files };
  downloadBlob(JSON.stringify(packageFile, null, 2), `ClinicalDataExport_${exportId}.json`, "application/json");
  toast(`已生成 U盘导出包：${patients.length} 例`);
}

function downloadPatientCsv() {
  const preview = buildPatientMasterPreview(getExportPatients());
  const csv = toCsv([preview.columns, ...preview.rows]);
  downloadBlob(csv, `患者主表_${dateStamp()}.csv`, "text/csv;charset=utf-8");
  toast("已导出患者主表 CSV");
}

function downloadPatientXlsx() {
  const patients = getExportPatients();
  const tables = buildExportTables(patients);
  const workbook = createXlsxWorkbookBlob(tables.workbookSheets);
  downloadBlob(workbook, `临床研究导出_${dateStamp()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  toast(`已导出多Sheet XLSX：${patients.length} 例`);
}

function downloadExportReport() {
  const patients = getExportPatients();
  const preview = buildPatientMasterPreview(patients);
  const report = buildExportReport(patients, preview);
  downloadBlob(report.text, `导出报告_${dateStamp()}.txt`, "text/plain;charset=utf-8");
  toast("已导出报告 TXT");
}

function buildExportReport(patients, preview) {
  const diagnosisRows = patients.flatMap((patient) => patient.diagnoses || []);
  const labRows = patients.flatMap((patient) => patient.labs || []);
  const reportRows = patients.flatMap((patient) => patient.reports || []);
  const qcIssues = patients.flatMap((patient) => getQcIssues(patient));
  const pendingCandidates = patients.reduce((sum, patient) => sum + getCandidates(patient).length, 0);
  const selectedFieldLabels = getSelectedExportFields().map((field) => field.label).join("、") || "未选择";
  const diagnosisFilter = [
    state.exportConfig.diagnosisInclude && `包含=${state.exportConfig.diagnosisInclude}`,
    state.exportConfig.diagnosisAnd && `AND=${state.exportConfig.diagnosisAnd}`,
    state.exportConfig.diagnosisOr && `OR=${state.exportConfig.diagnosisOr}`,
    state.exportConfig.diagnosisExclude && `排除=${state.exportConfig.diagnosisExclude}`
  ].filter(Boolean).join("；") || "无";
  const items = [
    { label: "导出病例数", value: `${patients.length} 例` },
    { label: "患者主表列数", value: `${preview.columns.length} 列` },
    { label: "诊断记录数", value: `${diagnosisRows.length} 条` },
    { label: "化验记录数", value: `${labRows.length} 条` },
    { label: "报告记录数", value: `${reportRows.length} 条` },
    { label: "待确认AI候选", value: `${pendingCandidates} 条` },
    { label: "缺失/逻辑提醒", value: `${qcIssues.length} 项` },
    { label: "诊断筛选", value: diagnosisFilter },
    { label: "化验时间规则", value: state.exportConfig.labRule },
    { label: "字段选择", value: selectedFieldLabels }
  ];
  const text = [
    "临床研究数据采集系统导出报告",
    `生成时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    ...items.map((item) => `${item.label}: ${item.value}`)
  ].join("\n");
  return { items, text };
}

function buildExportPreflight(patients, preview) {
  const qcIssues = patients.flatMap((patient) => getQcIssues(patient));
  const pendingCandidates = patients.reduce((sum, patient) => sum + getCandidates(patient).length, 0);
  const roughFiles = buildExportFiles(patients, "preview", new Date().toISOString());
  const estimatedKb = Math.max(1, Math.round(new Blob(Object.values(roughFiles)).size / 1024));
  return {
    items: [
      { text: `${patients.length} 例患者`, level: patients.length ? "good" : "bad" },
      { text: `${preview.columns.length} 个主表字段`, level: preview.columns.length ? "good" : "bad" },
      { text: `预计包 ${estimatedKb}KB`, level: estimatedKb > 1024 ? "warn" : "good" },
      { text: `缺失/逻辑提醒 ${qcIssues.length} 项`, level: qcIssues.length ? "warn" : "good" },
      { text: `AI候选待确认 ${pendingCandidates} 条`, level: pendingCandidates ? "warn" : "good" },
      { text: "正式桌面版导出前复核U盘空间", level: "warn" }
    ]
  };
}

function buildExportFiles(patients, exportId, generatedAt) {
  const tables = buildExportTables(patients);
  const exportReport = buildExportReport(patients, tables.preview);
  const files = {
    "excel/README.txt": "U盘JSON包内保留CSV便于校验和跨版本导入；界面上的“导出多Sheet XLSX”会生成真正Excel工作簿。",
    "excel/患者主表.csv": toCsv(tables.patientMasterRows),
    "excel/诊断明细.csv": objectsToCsv(tables.diagnosisRows),
    "excel/化验长表.csv": objectsToCsv(tables.labRows),
    "excel/检查报告明细.csv": objectsToCsv(tables.reportRows),
    "data/patient_master.csv": objectsToCsv(tables.patientRows),
    "data/encounter.csv": objectsToCsv(tables.encounterRows),
    "data/diagnosis.csv": objectsToCsv(tables.diagnosisRows),
    "data/lab_report.csv": objectsToCsv([]),
    "data/lab_result.csv": objectsToCsv(tables.labRows),
    "data/report_record.csv": objectsToCsv(tables.reportRows),
    "data/treatment.csv": objectsToCsv([]),
    "data/followup.csv": objectsToCsv(tables.followupRows),
    "dict/field_dictionary.csv": toCsv([
      ["field", "label", "type", "derived"],
      ["length_of_stay_days", "住院天数", "number", "yes"],
      ["lab_wide", "化验宽表列", "dynamic", "yes"]
    ]),
    "dict/unit_dictionary.csv": toCsv([
      ["item", "preferred_unit", "note"],
      ["CA19-9", "U/mL", "保留原始单位"],
      ["白蛋白", "g/L", "保留原始单位"]
    ]),
    "export_report.txt": `导出时间: ${generatedAt}\n导出批次: ${exportId}\n${exportReport.text}\n`
  };
  return files;
}

function buildExportTables(patients) {
  const patientRows = patients.map((patient) => patientRecord(patient));
  const encounterRows = patients.flatMap((patient) => patient.encounters.map((item) => ({ ...item, patient_uid: patient.patient_uid })));
  const diagnosisRows = patients.flatMap((patient) => patient.diagnoses.map((item) => ({ ...item, patient_uid: patient.patient_uid })));
  const labRows = patients.flatMap((patient) => patient.labs.map((item) => ({ ...item, patient_uid: patient.patient_uid })));
  const reportRows = patients.flatMap((patient) => patient.reports.map((item) => ({ ...item, patient_uid: patient.patient_uid, store_image_flag: "否" })));
  const followupRows = patients.flatMap((patient) => (patient.followup || []).map((item) => ({ ...item, patient_uid: patient.patient_uid })));
  const preview = buildPatientMasterPreview(patients);
  const patientMasterRows = [preview.columns, ...preview.rows];
  const workbookSheets = [
    { name: "患者主表", rows: patientMasterRows },
    { name: "住院次", rows: objectsToTableRows(encounterRows) },
    { name: "诊断明细", rows: objectsToTableRows(diagnosisRows) },
    { name: "化验长表", rows: objectsToTableRows(labRows) },
    { name: "报告明细", rows: objectsToTableRows(reportRows) },
    { name: "随访记录", rows: objectsToTableRows(followupRows) },
    { name: "字段字典", rows: exportFieldCatalog.map((field) => [field.key, field.group, field.label, field.unit || "", field.dynamic ? "是" : "否"]) }
  ];
  workbookSheets[6].rows.unshift(["字段", "分组", "显示名", "单位", "是否派生"]);
  return { patientRows, encounterRows, diagnosisRows, labRows, reportRows, followupRows, preview, patientMasterRows, workbookSheets };
}

function createXlsxWorkbookBlob(sheets) {
  const normalizedSheets = sheets.map((sheet, index) => ({
    name: normalizeSheetName(sheet.name, index, sheets),
    rows: sheet.rows?.length ? sheet.rows : [["无记录"]]
  }));
  const files = {
    "[Content_Types].xml": buildContentTypesXml(normalizedSheets),
    "_rels/.rels": buildRootRelsXml(),
    "docProps/core.xml": buildCorePropsXml(),
    "docProps/app.xml": buildAppPropsXml(normalizedSheets),
    "xl/workbook.xml": buildWorkbookXml(normalizedSheets),
    "xl/_rels/workbook.xml.rels": buildWorkbookRelsXml(normalizedSheets),
    "xl/styles.xml": buildStylesXml()
  };
  normalizedSheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = buildWorksheetXml(sheet.rows);
  });
  return createZipBlob(files, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function normalizeSheetName(name, index, sheets) {
  const base = String(name || `Sheet${index + 1}`).replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Sheet${index + 1}`;
  const previous = new Set(sheets.slice(0, index).map((sheet, itemIndex) => normalizeSheetName(sheet.name, itemIndex, sheets.slice(0, index))));
  if (!previous.has(base)) return base;
  const suffix = `_${index + 1}`;
  return `${base.slice(0, 31 - suffix.length)}${suffix}`;
}

function buildContentTypesXml(sheets) {
  return xmlDeclaration(`\
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n  ")}
</Types>`);
}

function buildRootRelsXml() {
  return xmlDeclaration(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
}

function buildCorePropsXml() {
  const now = new Date().toISOString();
  return xmlDeclaration(`\
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Clinical Data App</dc:creator>
  <cp:lastModifiedBy>Clinical Data App</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`);
}

function buildAppPropsXml(sheets) {
  return xmlDeclaration(`\
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Clinical Data App Static Prototype</Application>
  <TitlesOfParts>
    <vt:vector size="${sheets.length}" baseType="lpstr">
      ${sheets.map((sheet) => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`).join("\n      ")}
    </vt:vector>
  </TitlesOfParts>
</Properties>`);
}

function buildWorkbookXml(sheets) {
  return xmlDeclaration(`\
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets.map((sheet, index) => `<sheet name="${escapeXmlAttr(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("\n    ")}
  </sheets>
</workbook>`);
}

function buildWorkbookRelsXml(sheets) {
  return xmlDeclaration(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("\n  ")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
}

function buildStylesXml() {
  return xmlDeclaration(`\
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
}

function buildWorksheetXml(rows) {
  const safeRows = rows.map((row) => (Array.isArray(row) ? row : [row]));
  const maxColumns = Math.max(1, ...safeRows.map((row) => row.length));
  return xmlDeclaration(`\
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${columnName(maxColumns)}${Math.max(1, safeRows.length)}"/>
  <sheetData>
    ${safeRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, colIndex) => worksheetCellXml(cell, rowIndex + 1, colIndex + 1)).join("")}</row>`).join("\n    ")}
  </sheetData>
</worksheet>`);
}

function worksheetCellXml(value, rowIndex, colIndex) {
  const ref = `${columnName(colIndex)}${rowIndex}`;
  const text = String(value ?? "");
  return `<c r="${ref}" t="inlineStr"><is><t${/^\s|\s$/.test(text) ? ' xml:space="preserve"' : ""}>${escapeXml(text)}</t></is></c>`;
}

function columnName(index) {
  let name = "";
  let value = index;
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function xmlDeclaration(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
}

function createZipBlob(files, type) {
  const encoder = new TextEncoder();
  const entries = Object.entries(files).map(([path, content]) => {
    const data = content instanceof Uint8Array ? content : encoder.encode(String(content));
    return { path, nameBytes: encoder.encode(path), data, crc: crc32(data) };
  });
  let offset = 0;
  const localParts = [];
  const centralParts = [];
  entries.forEach((entry) => {
    const localHeader = zipLocalHeader(entry);
    localParts.push(localHeader, entry.nameBytes, entry.data);
    centralParts.push(zipCentralHeader(entry, offset), entry.nameBytes);
    offset += localHeader.length + entry.nameBytes.length + entry.data.length;
  });
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = zipEndRecord(entries.length, centralSize, centralOffset);
  return new Blob([...localParts, ...centralParts, end], { type });
}

function zipLocalHeader(entry) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.data.length, true);
  view.setUint32(22, entry.data.length, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
  return header;
}

function zipCentralHeader(entry, offset) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.data.length, true);
  view.setUint32(24, entry.data.length, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  return header;
}

function zipEndRecord(count, centralSize, centralOffset) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return record;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crc32Table()[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

let cachedCrc32Table = null;
function crc32Table() {
  if (cachedCrc32Table) return cachedCrc32Table;
  cachedCrc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    cachedCrc32Table[i] = value >>> 0;
  }
  return cachedCrc32Table;
}

async function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (!["ClinicalDataExport", "PancreasClinicalDataExport"].includes(data.package_type)) throw new Error("不是本系统导出包");
    const preview = await previewImportPackage(data);
    pendingImportPackage = data;
    pendingImportPreview = preview;
    state.activeTab = "export";
    toast(`已生成导入预览：新增 ${preview.newCount} 例，重复 ${preview.duplicateCount} 例，冲突 ${preview.conflictCount} 例`);
    render();
  } catch (error) {
    clearPendingImport();
    toast(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

async function previewImportPackage(pkg) {
  await verifyPackage(pkg);
  const manifest = pkg.manifest || {};
  const files = pkg.files || {};
  const incomingPatients = parseCsvObjects(files["data/patient_master.csv"] || "");
  const patientColumns = getCsvHeaders(files["data/patient_master.csv"] || "");
  const relatedRows = parseImportRelatedRows(files);
  const patientRows = incomingPatients.map((row) => classifyImportPatient(row, relatedRows));
  const newCount = patientRows.filter((row) => row.status === "new").length;
  const duplicateCount = patientRows.filter((row) => row.status === "duplicate").length;
  const conflictCount = patientRows.filter((row) => row.status === "conflict").length;
  const detailNewCount = patientRows.reduce((sum, row) => sum + (row.detailNewCount || 0), 0);
  const detailConflictCount = patientRows.reduce((sum, row) => sum + (row.detailConflictCount || 0), 0);
  const fieldLabels = (manifest.field_selection?.fields || []).map((field) => field.label || field.key).filter(Boolean);
  const tableCounts = importTableDefinitions.map((item) => ({
    ...item,
    count: parseCsvObjects(files[item.path] || "").length
  }));
  return {
    exportId: manifest.export_id || "未知",
    sourceDevice: manifest.source_device || "未知",
    createdAt: manifest.created_at || "",
    patientCount: incomingPatients.length,
    newCount,
    duplicateCount,
    conflictCount,
    detailNewCount,
    detailConflictCount,
    importable: newCount + detailNewCount,
    checksumStatus: "校验通过",
    fieldLabels,
    patientColumns,
    tableCounts,
    patientRows
  };
}

function parseImportRelatedRows(files) {
  return Object.fromEntries(
    importMergeDefinitions.map((definition) => [
      definition.key,
      groupRowsByPatient(parseCsvObjects(files[definition.path] || ""))
    ])
  );
}

function classifyImportPatient(row, relatedRows = null) {
  const byUuid = state.patients.find((patient) => patient.record_uuid && patient.record_uuid === row.record_uuid);
  const byPatientUid = state.patients.find((patient) => patient.patient_uid && patient.patient_uid === row.patient_uid);
  const byResearchId = state.patients.find((patient) => patient.research_id && patient.research_id === row.research_id);
  const existing = byUuid || byPatientUid || byResearchId;
  if (!existing) {
    return {
      ...row,
      status: "new",
      statusText: "新增",
      level: "good",
      reason: "本机未发现相同病例"
    };
  }
  if (byUuid && row.content_hash && byUuid.content_hash && byUuid.content_hash !== row.content_hash && patientCoreDiffers(byUuid, row)) {
    return {
      ...row,
      status: "conflict",
      statusText: "冲突",
      level: "bad",
      reason: "同一病例UUID的基础信息已不同",
      conflictDetails: buildPatientConflictDetails(byUuid, row, "同一病例UUID的基础信息不同")
    };
  }
  if (byResearchId && row.record_uuid && byResearchId.record_uuid !== row.record_uuid) {
    return {
      ...row,
      status: "conflict",
      statusText: "冲突",
      level: "bad",
      reason: "研究编号已存在，但记录UUID不同",
      conflictDetails: buildPatientConflictDetails(byResearchId, row, "研究编号相同但记录UUID不同")
    };
  }
  if (byPatientUid && row.record_uuid && byPatientUid.record_uuid !== row.record_uuid) {
    return {
      ...row,
      status: "conflict",
      statusText: "冲突",
      level: "bad",
      reason: "患者内部ID已存在，但记录UUID不同",
      conflictDetails: buildPatientConflictDetails(byPatientUid, row, "患者内部ID相同但记录UUID不同")
    };
  }
  const detailPreview = relatedRows ? previewRelatedMerge(existing, row, relatedRows) : { newRecords: 0, conflicts: 0 };
  if (detailPreview.newRecords) {
    return {
      ...row,
      status: "duplicate",
      statusText: "可合并明细",
      level: "good",
      reason: `本机已有病例，可新增 ${detailPreview.newRecords} 条明细${detailPreview.conflicts ? `，${detailPreview.conflicts} 条冲突待处理` : ""}`,
      detailNewCount: detailPreview.newRecords,
      detailConflictCount: detailPreview.conflicts,
      conflictDetails: detailPreview.conflictDetails
    };
  }
  return {
    ...row,
    status: "duplicate",
    statusText: "重复",
    level: "warn",
    reason: "本机已有相同病例和明细，导入时跳过",
    detailNewCount: 0,
    detailConflictCount: detailPreview.conflicts,
    conflictDetails: detailPreview.conflictDetails
  };
}

function patientCoreDiffers(existing, incoming) {
  return ["research_id", "inpatient_no", "medical_record_no", "sex", "age_at_admission"].some((field) => String(existing[field] ?? "") !== String(incoming[field] ?? ""));
}

function previewRelatedMerge(existing, row, relatedRows) {
  return importMergeDefinitions.reduce(
    (summary, definition) => {
      const rows = relatedRows[definition.key]?.get(row.patient_uid) || [];
      rows.forEach((incomingRow) => {
        const collection = existing[definition.key] || [];
        const status = classifyRelatedRecord(collection, incomingRow, definition);
        if (status === "new") summary.newRecords += 1;
        if (status === "conflict") {
          summary.conflicts += 1;
          summary.conflictDetails.push(buildRelatedConflictDetail(collection, incomingRow, definition));
        }
      });
      return summary;
    },
    { newRecords: 0, conflicts: 0, conflictDetails: [] }
  );
}

function buildPatientConflictDetails(existing, incoming, reason) {
  const fields = importPatientCoreFields
    .map((field) => ({
      label: field.label,
      local: String(existing[field.key] ?? ""),
      incoming: String(incoming[field.key] ?? "")
    }))
    .filter((field) => field.local !== field.incoming);
  return [
    {
      scope: "患者主表",
      title: incoming.research_id || existing.research_id || "未命名病例",
      reason,
      fields: fields.length ? fields : [{ label: "content_hash", local: existing.content_hash || "", incoming: incoming.content_hash || "" }]
    }
  ];
}

function buildRelatedConflictDetail(collection, incomingRow, definition) {
  const existing = findMatchingRelatedRecord(collection, incomingRow, definition) || {};
  const ignored = new Set(["patient_uid", "content_hash", "updated_at"]);
  const fields = [...new Set([...Object.keys(existing), ...Object.keys(incomingRow)])]
    .filter((key) => !ignored.has(key))
    .map((key) => ({
      label: key,
      local: String(existing[key] ?? ""),
      incoming: String(incomingRow[key] ?? "")
    }))
    .filter((field) => field.local !== field.incoming);
  return {
    scope: definition.label,
    title: incomingRow[definition.idField] || incomingRow.record_uuid || "未命名记录",
    reason: "本机已有同ID明细，但字段内容不同",
    fields: fields.length ? fields : [{ label: "content_hash", local: existing.content_hash || "", incoming: incomingRow.content_hash || "" }]
  };
}

function classifyRelatedRecord(collection, incomingRow, definition) {
  const existing = findMatchingRelatedRecord(collection, incomingRow, definition);
  if (!existing) return "new";
  return recordsEquivalent(existing, incomingRow) ? "duplicate" : "conflict";
}

function findMatchingRelatedRecord(collection, incomingRow, definition) {
  return (
    collection.find((item) => item.record_uuid && incomingRow.record_uuid && item.record_uuid === incomingRow.record_uuid) ||
    collection.find((item) => incomingRow[definition.idField] && item[definition.idField] === incomingRow[definition.idField])
  );
}

function recordsEquivalent(existing, incomingRow) {
  if (existing.record_uuid && incomingRow.record_uuid && existing.record_uuid === incomingRow.record_uuid && existing.content_hash && incomingRow.content_hash) {
    return existing.content_hash === incomingRow.content_hash;
  }
  return comparableRecordString(existing, incomingRow) === comparableRecordString(incomingRow, incomingRow);
}

function recordContentHash(record) {
  return simpleHash(stableRecordString(record));
}

function stableRecordString(record) {
  const ignored = new Set(["patient_uid", "content_hash", "updated_at"]);
  return JSON.stringify(
    Object.keys(record)
      .filter((key) => !ignored.has(key))
      .sort()
      .reduce((obj, key) => {
        obj[key] = String(record[key] ?? "");
        return obj;
      }, {})
  );
}

function comparableRecordString(record, keySource) {
  const ignored = new Set(["patient_uid", "content_hash", "updated_at"]);
  return JSON.stringify(
    Object.keys(keySource)
      .filter((key) => !ignored.has(key))
      .sort()
      .reduce((obj, key) => {
        obj[key] = String(record[key] ?? "");
        return obj;
      }, {})
  );
}

function withRecordMetadata(record) {
  record.record_uuid = record.record_uuid || uid("rec");
  record.content_hash = record.content_hash || recordContentHash(record);
  return record;
}

async function confirmPendingImport() {
  if (!pendingImportPackage || !pendingImportPreview) {
    toast("没有待导入的数据包");
    return;
  }
  if (pendingImportInProgress) return;
  pendingImportInProgress = true;
  renderActiveTab();
  try {
    const result = await importPackage(pendingImportPackage);
    const summary = `导入完成：新增病例 ${result.imported} 例，新增明细 ${result.detailImported} 条，重复跳过 ${result.skipped} 例，冲突 ${result.conflicts + result.detailConflicts} 条`;
    clearPendingImport();
    toast(summary);
    render();
  } catch (error) {
    toast(`导入失败：${error.message}`);
    pendingImportInProgress = false;
    renderActiveTab();
  }
}

function clearPendingImport() {
  pendingImportPackage = null;
  pendingImportPreview = null;
  pendingImportInProgress = false;
}

async function importPackage(pkg) {
  await verifyPackage(pkg);
  const files = pkg.files || {};
  const incomingPatients = parseCsvObjects(files["data/patient_master.csv"] || "");
  const relatedRows = parseImportRelatedRows(files);
  let imported = 0;
  let skipped = 0;
  let conflicts = 0;
  let detailImported = 0;
  let detailConflicts = 0;
  const importedIds = [];
  incomingPatients.forEach((row) => {
    const status = classifyImportPatient(row, relatedRows);
    if (status.status === "conflict") {
      conflicts += 1;
      return;
    }
    if (status.status === "duplicate") {
      const existing = findExistingImportPatient(row);
      const result = existing ? mergeRelatedRecords(existing, row, relatedRows) : { imported: 0, conflicts: 0 };
      detailImported += result.imported;
      detailConflicts += result.conflicts;
      if (result.imported && existing) touch(existing, false);
      if (!result.imported) skipped += 1;
      return;
    }
    const patient = hydrateImportedPatient(row, {
      encounters: relatedRows.encounters.get(row.patient_uid) || [],
      diagnoses: relatedRows.diagnoses.get(row.patient_uid) || [],
      labs: relatedRows.labs.get(row.patient_uid) || [],
      reports: relatedRows.reports.get(row.patient_uid) || [],
      followups: relatedRows.followup.get(row.patient_uid) || []
    });
    state.patients.push(patient);
    importedIds.push(patient.patient_uid);
    imported += 1;
  });
  if (importedIds.length) state.activePatientId = importedIds[0];
  saveState();
  return { imported, skipped, conflicts, detailImported, detailConflicts, importedIds };
}

function findExistingImportPatient(row) {
  return (
    state.patients.find((patient) => patient.record_uuid && patient.record_uuid === row.record_uuid) ||
    state.patients.find((patient) => patient.patient_uid && patient.patient_uid === row.patient_uid) ||
    state.patients.find((patient) => patient.research_id && patient.research_id === row.research_id)
  );
}

function mergeRelatedRecords(existingPatient, row, relatedRows) {
  return importMergeDefinitions.reduce(
    (summary, definition) => {
      const rows = relatedRows[definition.key]?.get(row.patient_uid) || [];
      const collection = existingPatient[definition.key] || [];
      rows.forEach((incomingRow) => {
        const status = classifyRelatedRecord(collection, incomingRow, definition);
        if (status === "new") {
          collection.push(definition.hydrate(incomingRow));
          summary.imported += 1;
        } else if (status === "conflict") {
          summary.conflicts += 1;
        }
      });
      existingPatient[definition.key] = collection;
      return summary;
    },
    { imported: 0, conflicts: 0 }
  );
}

function groupRowsByPatient(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!row.patient_uid) return;
    if (!map.has(row.patient_uid)) map.set(row.patient_uid, []);
    map.get(row.patient_uid).push(row);
  });
  return map;
}

function hydrateImportedPatient(row, related) {
  const patient = createPatient();
  patient.record_uuid = row.record_uuid || uid("rec");
  patient.content_hash = row.content_hash || "";
  patient.patient_uid = row.patient_uid || uid("patient");
  patient.research_id = row.research_id || `PCC-${new Date().getFullYear()}-${String(state.patients.length + 1).padStart(3, "0")}`;
  patient.inpatient_no = row.inpatient_no || "";
  patient.medical_record_no = row.medical_record_no || "";
  patient.sex = row.sex || "未知";
  patient.age_at_admission = row.age_at_admission ? Number(row.age_at_admission) || row.age_at_admission : "";
  patient.qc_status = "待确认";
  patient.encounters = related.encounters.length ? related.encounters.map(hydrateEncounter) : [];
  patient.diagnoses = related.diagnoses.length ? related.diagnoses.map(hydrateDiagnosis) : [];
  patient.labs = related.labs.length ? related.labs.map(hydrateLab) : [];
  patient.reports = related.reports.length ? related.reports.map(hydrateReport) : [];
  patient.followup = related.followups.length ? related.followups.map(hydrateFollowup) : [];
  patient.candidates = [];
  patient.report_scratch = "";
  patient.updated_at = new Date().toISOString();
  patient.content_hash = row.content_hash || simpleHash(JSON.stringify(patient));
  return patient;
}

function hydrateEncounter(row) {
  const encounter = withRecordMetadata({ ...createEncounter(), ...row });
  computeLengthOfStay(encounter);
  return encounter;
}

function hydrateDiagnosis(row) {
  return withRecordMetadata({
    ...createDiagnosis(),
    ...row,
    is_primary_for_model: row.is_primary_for_model === true || row.is_primary_for_model === "true"
  });
}

function hydrateLab(row) {
  return withRecordMetadata({
    ...createLab(),
    ...row,
    ai_confidence: row.ai_confidence ? Number(row.ai_confidence) || row.ai_confidence : ""
  });
}

function hydrateReport(row) {
  return withRecordMetadata({ ...createReport(), ...row, store_image_flag: "否" });
}

function hydrateFollowup(row) {
  return withRecordMetadata({
    record_uuid: row.record_uuid || uid("rec"),
    content_hash: row.content_hash || "",
    followup_id: row.followup_id || uid("follow"),
    followup_date: row.followup_date || "",
    survival_status: row.survival_status || "不详",
    recurrence_status: row.recurrence_status || "不详",
    recurrence_site: row.recurrence_site || "",
    death_date: row.death_date || "",
    source_doc: row.source_doc || "",
    ...row
  });
}

async function verifyPackage(pkg) {
  const files = pkg.files || {};
  const manifest = pkg.manifest || {};
  const recorded = manifest.file_checksums || {};
  if (!Object.keys(recorded).length) throw new Error("导入包缺少 manifest.file_checksums");
  if (!files["checksum.sha256"]) throw new Error("导入包缺少 checksum.sha256");
  const checksumFile = parseChecksumFile(files["checksum.sha256"]);
  requiredImportFiles.forEach((path) => {
    if (!(path in files)) throw new Error(`缺少必需文件 ${path}`);
    if (!recorded[path]) throw new Error(`manifest 未记录 ${path} 校验值`);
    if (!checksumFile[path]) throw new Error(`checksum.sha256 未记录 ${path}`);
  });
  for (const [path, expected] of Object.entries(recorded)) {
    if (!(path in files)) throw new Error(`缺少文件 ${path}`);
    if (checksumFile[path] !== expected) throw new Error(`checksum.sha256 与 manifest 不一致 ${path}`);
    const actual = await sha256(files[path]);
    if (actual !== expected) throw new Error(`校验失败 ${path}`);
  }
}

function parseChecksumFile(text) {
  return Object.fromEntries(
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
        if (!match) throw new Error("checksum.sha256 格式错误");
        return [match[2].trim(), match[1].toLowerCase()];
      })
  );
}

function getExportPatients() {
  const selected = new Set(state.exportConfig.selectedPatients.length ? state.exportConfig.selectedPatients : [state.activePatientId]);
  return state.patients.filter((patient) => {
    if (!selected.has(patient.patient_uid)) return false;
    const diagnoses = patient.diagnoses.map((item) => item.diagnosis_text_raw).join(" ");
    if (state.exportConfig.diagnosisInclude && !diagnoses.includes(state.exportConfig.diagnosisInclude)) return false;
    if (state.exportConfig.diagnosisAnd && !diagnoses.includes(state.exportConfig.diagnosisAnd)) return false;
    if (state.exportConfig.diagnosisOr) {
      const terms = state.exportConfig.diagnosisOr.split(/[|,，;；、\s]+/).filter(Boolean);
      if (terms.length && !terms.some((term) => diagnoses.includes(term))) return false;
    }
    if (state.exportConfig.diagnosisExclude && diagnoses.includes(state.exportConfig.diagnosisExclude)) return false;
    return true;
  });
}

function getSelectedExportFields() {
  if (!Array.isArray(state.exportConfig.selectedFields)) {
    state.exportConfig.selectedFields = [...defaultExportFieldKeys];
  }
  const keys = state.exportConfig.selectedFields.length ? state.exportConfig.selectedFields : ["research_id"];
  const selected = exportFieldCatalog.filter((field) => keys.includes(field.key));
  return selected.length ? selected : exportFieldCatalog.filter((field) => field.key === "research_id");
}

function buildPatientMasterPreview(patients) {
  const fields = getSelectedExportFields();
  const labColumns = fields.some((field) => field.key === "lab_wide") ? buildLabWideColumns(patients, state.exportConfig.labRule) : [];
  const columns = fields.flatMap((field) => {
    if (field.key === "lab_wide") return labColumns.map((item) => item.column);
    return [formatExportColumnLabel(field)];
  });
  const rows = patients.map((patient) => {
    const encounter = getIndexEncounter(patient);
    const labs = new Map(buildLabWidePreview(patient, state.exportConfig.labRule).map((item) => [item.column, item.value]));
    return fields.flatMap((field) => {
      if (field.key === "lab_wide") return labColumns.map((item) => labs.get(item.column) || "");
      return [getExportFieldValue(field.key, patient, encounter)];
    });
  });
  return { columns, rows };
}

function formatExportColumnLabel(field) {
  return field.unit ? `${field.label} (${field.unit})` : field.label;
}

function getExportFieldValue(fieldKey, patient, encounter) {
  const latestFollowup = getLatestFollowup(patient);
  const reportSummary = patient.reports
    .map((report) => report.structured_summary || report.report_title)
    .filter(Boolean)
    .join("; ");
  const values = {
    research_id: patient.research_id,
    inpatient_no: patient.inpatient_no,
    medical_record_no: patient.medical_record_no,
    sex: patient.sex,
    age_at_admission: patient.age_at_admission || "",
    admission_date: encounter.admission_date || "",
    discharge_date: encounter.discharge_date || "",
    length_of_stay_days: encounter.length_of_stay_days || encounter.length_of_stay_display || "",
    department: encounter.department || "",
    primary_diagnosis: getPrimaryDiagnosis(patient)?.diagnosis_text_raw || "",
    all_diagnoses: patient.diagnoses.map((item) => item.diagnosis_text_raw).join("; "),
    diagnosis_count: patient.diagnoses.length,
    report_summary: reportSummary,
    report_count: patient.reports.length,
    last_followup_date: latestFollowup?.followup_date || "",
    survival_status: latestFollowup?.survival_status || "",
    recurrence_status: latestFollowup?.recurrence_status || ""
  };
  return values[fieldKey] ?? "";
}

function getLatestFollowup(patient) {
  return [...(patient.followup || [])].sort((a, b) => dateValue(b.followup_date) - dateValue(a.followup_date))[0];
}

function buildLabWideColumns(patients, rule) {
  const columns = new Map();
  patients.forEach((patient) => {
    buildLabWidePreview(patient, rule).forEach((item) => columns.set(item.column, item));
  });
  return [...columns.values()];
}

function buildLabWidePreview(patient, rule) {
  if (rule === "每一次") return [];
  const grouped = new Map();
  patient.labs.forEach((lab) => {
    const key = `${lab.item_name_raw}__${lab.unit_raw}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(lab);
  });
  return [...grouped.entries()].map(([, labs]) => {
    const lab = pickLabByRule(labs, rule, getIndexEncounter(patient));
    return {
      column: `${lab.item_name_raw}_${rule} (${lab.unit_raw || "本行单位"})`,
      value: lab.value_raw,
      source: `${lab.specimen_time || lab.report_time || "无日期"} · ${lab.lab_result_id}`
    };
  });
}

function pickLabByRule(labs, rule, encounter) {
  const sorted = [...labs].sort((a, b) => dateValue(a.specimen_time || a.report_time) - dateValue(b.specimen_time || b.report_time));
  if (rule === "最后一次") return sorted.at(-1);
  if (rule === "术前最近一次") return sorted.at(-1);
  if (rule === "术后首次") return sorted[0];
  if (rule === "入院首次" && encounter.admission_date) {
    return sorted.find((lab) => dateValue(lab.specimen_time || lab.report_time) >= dateValue(encounter.admission_date)) || sorted[0];
  }
  return sorted[0];
}

function renderPreviewTable(preview) {
  if (!preview.rows.length) return `<div class="empty">当前筛选条件下没有患者。</div>`;
  return `
    <table class="data-table">
      <thead><tr>${preview.columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr></thead>
      <tbody>${preview.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function patientRecord(patient) {
  return {
    record_uuid: patient.record_uuid,
    content_hash: patient.content_hash,
    patient_uid: patient.patient_uid,
    research_id: patient.research_id,
    inpatient_no: patient.inpatient_no,
    medical_record_no: patient.medical_record_no,
    sex: patient.sex,
    age_at_admission: patient.age_at_admission,
    qc_status: patient.qc_status
  };
}

function getActivePatient() {
  return state.patients.find((patient) => patient.patient_uid === state.activePatientId) || state.patients[0];
}

function getPrimaryDiagnosis(patient) {
  return patient.diagnoses.find((item) => item.is_primary_for_model) || patient.diagnoses.find((item) => item.diagnosis_role === "主诊断");
}

function getIndexEncounter(patient) {
  const encounter = patient.encounters[0] || createEncounter();
  if (!patient.encounters.length) patient.encounters.push(encounter);
  computeLengthOfStay(encounter);
  return encounter;
}

function computeLengthOfStay(encounter) {
  encounter.length_of_stay_calc_method = "出院日期-入院日期+1";
  encounter.length_of_stay_source = "admission_date+discharge_date";
  if (!encounter.admission_date) {
    encounter.length_of_stay_days = "";
    encounter.length_of_stay_display = "缺失入院时间";
    encounter.length_of_stay_status = "缺失";
    return;
  }
  if (!encounter.discharge_date) {
    encounter.length_of_stay_days = "";
    encounter.length_of_stay_display = "待出院";
    encounter.length_of_stay_status = "待出院";
    return;
  }
  const start = dateValue(encounter.admission_date);
  const end = dateValue(encounter.discharge_date);
  if (end < start) {
    encounter.length_of_stay_days = "";
    encounter.length_of_stay_display = "日期错误";
    encounter.length_of_stay_status = "日期错误";
    return;
  }
  const days = Math.floor((end - start) / 86400000) + 1;
  encounter.length_of_stay_days = days;
  encounter.length_of_stay_display = `${days} 天`;
  encounter.length_of_stay_status = "已计算";
}

function touch(patient, persist = true) {
  patient.updated_at = new Date().toISOString();
  patient.content_hash = simpleHash(JSON.stringify(patient));
  if (persist) saveState();
}

function createPatient() {
  const index = state.patients.length + 1;
  const patient = {
    record_uuid: uid("rec"),
    content_hash: "",
    patient_uid: uid("patient"),
    research_id: `PCC-2026-${String(index).padStart(3, "0")}`,
    inpatient_no: `ZY${String(260000 + index)}`,
    medical_record_no: `BA${String(880000 + index)}`,
    name_token: `T${String(index).padStart(3, "0")}`,
    sex: index % 2 ? "男" : "女",
    age_at_admission: 62 + index,
    qc_status: "待确认",
    encounters: [createEncounter()],
    diagnoses: [createDiagnosis({ diagnosis_text_raw: "胰腺癌", diagnosis_role: "主诊断", diagnosis_status: "临床诊断", is_primary_for_model: true })],
    labs: [createLab({ item_name_raw: "CA19-9", value_raw: "856.4", unit_raw: "U/mL" })],
    reports: [createReport({ report_type: "影像报告", report_title: "腹部增强CT", structured_summary: "胰头占位，胆总管扩张，建议结合病理。" })],
    followup: [{ followup_id: uid("follow"), followup_date: "2026-08-20", survival_status: "生存", recurrence_status: "不详" }],
    candidates: [],
    ocr_workbench: {
      image_name: "",
      image_size: "",
      ocr_text: "",
      parsed_at: "",
      source_type: "化验截图"
    },
    report_scratch: "",
    updated_at: new Date().toISOString()
  };
  patient.content_hash = simpleHash(JSON.stringify(patient));
  return patient;
}

function createEncounter() {
  const encounter = {
    record_uuid: uid("rec"),
    content_hash: "",
    encounter_id: uid("enc"),
    admission_date: "2026-05-18",
    discharge_date: "2026-05-28",
    department: "肝胆胰外科",
    visit_type: "住院",
    source_system: "HIS"
  };
  computeLengthOfStay(encounter);
  return encounter;
}

function createDiagnosis(overrides = {}) {
  return {
    record_uuid: uid("rec"),
    content_hash: "",
    diagnosis_id: uid("diag"),
    diagnosis_text_raw: "胰腺癌",
    diagnosis_name_std: "",
    diagnosis_code: "",
    diagnosis_role: "主诊断",
    diagnosis_status: "临床诊断",
    is_primary_for_model: false,
    diagnosis_date: "2026-05-18",
    source_doc: "HIS页面",
    confirm_status: "人工确认",
    ...overrides
  };
}

function createLab(overrides = {}) {
  return {
    record_uuid: uid("rec"),
    content_hash: "",
    lab_result_id: uid("lab"),
    lab_report_id: uid("labreport"),
    item_name_raw: "白蛋白",
    item_name_std: "",
    value_raw: "",
    comparator: "=",
    value_num: "",
    value_text: "",
    unit_raw: "g/L",
    unit_std: "",
    reference_range: "",
    abnormal_flag: "不详",
    specimen_time: "2026-05-18",
    report_time: "2026-05-18",
    source_text: "检验报告",
    ai_confidence: 0.92,
    confirm_status: "人工确认",
    ...overrides
  };
}

function createReport(overrides = {}) {
  return {
    record_uuid: uid("rec"),
    content_hash: "",
    report_id: uid("report"),
    report_type: "影像报告",
    report_date: "2026-05-17",
    report_title: "",
    report_text_raw: "",
    report_text_hash: "",
    structured_summary: "",
    source_system: "PACS",
    source_ref: "",
    deid_status: "不含身份信息",
    store_image_flag: "否",
    confirm_status: "人工确认",
    ...overrides
  };
}

function seedPatients() {
  const first = createPatient();
  first.research_id = "PCC-2026-001";
  first.sex = "男";
  first.age_at_admission = 63;
  first.qc_status = "待确认";
  first.diagnoses.push(createDiagnosis({ diagnosis_text_raw: "糖尿病", diagnosis_role: "合并症", diagnosis_status: "临床诊断", is_primary_for_model: false }));
  first.diagnoses.push(createDiagnosis({ diagnosis_text_raw: "胰腺导管腺癌", diagnosis_role: "病理诊断", diagnosis_status: "病理证实", is_primary_for_model: false, source_doc: "病理报告" }));
  first.labs.push(createLab({ item_name_raw: "白蛋白", value_raw: "37.6", unit_raw: "g/L", specimen_time: "2026-05-18" }));
  first.labs.push(createLab({ item_name_raw: "CA19-9", value_raw: "642.1", unit_raw: "U/mL", specimen_time: "2026-05-27" }));

  const second = createPatient();
  second.research_id = "PCC-2026-002";
  second.sex = "女";
  second.age_at_admission = 58;
  second.qc_status = "已质控";
  second.encounters[0].admission_date = "2026-04-08";
  second.encounters[0].discharge_date = "2026-04-19";
  computeLengthOfStay(second.encounters[0]);
  second.diagnoses[0].diagnosis_text_raw = "胰体尾癌";
  second.labs[0].value_raw = "420.0";
  second.reports[0].structured_summary = "胰体尾占位，未见明确远处转移。";

  const third = createPatient();
  third.research_id = "PCC-2026-003";
  third.qc_status = "随访中";
  third.encounters[0].admission_date = "2026-03-12";
  third.encounters[0].discharge_date = "";
  computeLengthOfStay(third.encounters[0]);

  return [first, second, third];
}

function inputField(label, field, value, type = "text") {
  return `<div class="field"><label>${escapeHtml(label)}</label><input type="${type}" data-field="${escapeAttr(field)}" value="${escapeAttr(value ?? "")}" /></div>`;
}

function numberField(label, field, value) {
  return inputField(label, field, value, "number");
}

function readonlyField(label, value) {
  return `<div class="field"><label>${escapeHtml(label)}</label><input value="${escapeAttr(value ?? "")}" readonly /></div>`;
}

function selectField(label, field, value, options) {
  const optionList = value && !options.includes(value) ? [value, ...options] : options;
  return `<div class="field"><label>${escapeHtml(label)}</label><select data-field="${escapeAttr(field)}">${optionList.map((option) => `<option ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></div>`;
}

function smallSelect(field, value, options) {
  return `<select data-${field.includes("diagnosis") ? "diagnosis" : field.includes("report") ? "report" : "lab"}-field="${escapeAttr(field)}">${options.map((option) => `<option ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
}

function objectsToCsv(rows) {
  if (!rows.length) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return toCsv([columns, ...rows.map((row) => columns.map((col) => row[col] ?? ""))]);
}

function objectsToTableRows(rows) {
  if (!rows.length) return [["无记录"]];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [columns, ...rows.map((row) => columns.map((col) => row[col] ?? ""))];
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsvObjects(csv) {
  if (!csv.trim()) return [];
  const rows = parseCsvRows(csv);
  const headers = rows.shift() || [];
  return rows
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function getCsvHeaders(csv) {
  if (!csv.trim()) return [];
  return parseCsvRows(csv)[0] || [];
}

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function uid(prefix) {
  if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function dateValue(value) {
  return value ? new Date(value).getTime() : 0;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function formatDateTime(value) {
  return value ? value.slice(0, 16).replace("T", " ") : "--";
}

function matchText(text, regex) {
  const match = text.match(regex);
  return match ? match[1] : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttr(value) {
  return escapeXml(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

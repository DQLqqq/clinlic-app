#!/usr/bin/env node
import fs from "node:fs";
import vm from "node:vm";

function loadAppContext() {
  const code = fs.readFileSync("app.js", "utf8");
  const storage = new Map();
  const context = {
    console,
    crypto,
    TextEncoder,
    Blob: globalThis.Blob,
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {}
    },
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
    localStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, value);
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    document: {
      addEventListener() {},
      getElementById() {
        return {
          addEventListener() {},
          classList: { add() {}, remove() {} }
        };
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
      createElement() {
        return { click() {} };
      },
      body: { appendChild() {} }
    },
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyLabOcrBatchDate(context) {
  const text = [
    "编号\t项目名称\t结果\t异常提示\t单位\t参考范围",
    "WBC\t白细胞\t4.63\t\t10~9/L\t3.69-9.16",
    "NEUT%\t中性粒细胞百分率\t84.90\tH\t%\t50-70"
  ].join("\n");
  const candidates = context.extractLabCandidatesFromText(text, "真实截图样例", "2026-01-02");
  assert(candidates.length === 2, `expected 2 lab candidates, got ${candidates.length}`);
  assert(candidates.every((item) => item.payload.specimen_time === "2026-01-02"), "batch date not applied to lab candidates");
}

function verifyLabOcrSelectedListDateAndCleanup(context) {
  const text = [
    "申请日期\t姓名\t医嘱名称\t结果状态",
    "2026-01-03 10:52:53\t赫某珍\t血培养及鉴定(仪器法)\t报告结果",
    "2026-01-02 11:58:07\t赫某珍\t急检腹水淀粉酶(常规化学)\t报告结果",
    "2026-01-02 11:17:33\t赫某珍\t全血细胞分析(血常规)\t异 报告结果",
    "2026-01-01 10:11:34\t赫某珍\t急检腹水淀粉酶(常规化学)\t报告结果",
    "全血细胞分析(血常规)(历次数据)",
    "编号\t项目名称\t结果\t结果提示\t异常提示\t辅助诊断\t单位\t参考范围\t历次",
    "WBC\t白细胞\t4.63\t\t\t\t10^9/L\t3.69-9.16\t4.19",
    "NEUT%\t中性粒细胞百分率\t84.90\t\tH\t\t%\t50-70\t91.80",
    "ALB\t白蛋白\t\t\t\t\tg/L\t40-55\t",
    "WBC\t白细胞\t4.63\t\t\t\t10^9/L\t3.69-9.16\t4.19"
  ].join("\n");
  const candidates = context.extractLabCandidatesFromText(text, "真实LIS截图", "");
  assert(candidates.length === 2, `expected 2 unique non-empty lab candidates, got ${candidates.length}`);
  assert(candidates.every((item) => item.payload.specimen_time === "2026-01-02"), "selected left-list lab date not applied");
  assert(candidates.some((item) => item.payload.item_name_raw === "白细胞"), "WBC candidate missing");
  assert(candidates.some((item) => item.payload.item_name_raw === "中性粒细胞百分率"), "NEUT% candidate missing");
}

function verifyLabOcrWrappedLongName(context) {
  const text = [
    "编号\t项目名称\t结果\t结果提示\t异常提示\t辅助诊断\t单位\t参考范围",
    "AST/ALT\t天门冬氨酸氨基转移",
    "酶/丙氨酸氨基转移酶\t1.46\t\t\t\t\t"
  ].join("\n");
  const candidates = context.extractLabCandidatesFromText(text, "长项目名换行", "2026-01-02");
  assert(candidates.length === 1, `expected one wrapped lab candidate, got ${candidates.length}`);
  assert(candidates[0].payload.item_name_std === "AST/ALT", `bad wrapped lab code ${candidates[0].payload.item_name_std}`);
  assert(candidates[0].payload.item_name_raw === "天门冬氨酸氨基转移酶/丙氨酸氨基转移酶", `bad wrapped lab name ${candidates[0].payload.item_name_raw}`);
  assert(candidates[0].payload.value_raw === "1.46", `bad wrapped lab value ${candidates[0].payload.value_raw}`);
}

function verifyLabOcrDoesNotMergeChineseStandaloneRows(context) {
  const text = [
    "编号\t项目名称\t结果\t单位\t参考范围",
    "TBIL\t总胆红素",
    "直接胆红素\t5.2\tμmol/L\t0-8"
  ].join("\n");
  const candidates = context.extractLabCandidatesFromText(text, "中文项目行", "2026-01-02");
  assert(candidates.length === 1, `expected one standalone Chinese lab candidate, got ${candidates.length}`);
  assert(candidates[0].payload.item_name_raw === "直接胆红素", `standalone Chinese lab row was merged incorrectly: ${candidates[0].payload.item_name_raw}`);
  assert(candidates[0].payload.value_raw === "5.2", `bad standalone Chinese lab value ${candidates[0].payload.value_raw}`);
  assert(candidates[0].payload.unit_raw === "μmol/L", `bad standalone Chinese lab unit ${candidates[0].payload.unit_raw}`);
}

function verifyReportOcrCandidateFlow(context) {
  const patient = context.createPatient();
  const text = [
    "哈尔滨医科大学附属第一医院",
    "CT室报告单",
    "检查号：20260522234104",
    "检查项目：上腹部增强螺旋CT",
    "检查日期：2026-05-27",
    "检查所见：肝胆大小形态正常，肝右叶可见低密度影。",
    "检查结论：肝右叶乏血供病变，考虑恶性病变可能性大。胆囊炎。胆囊结石。"
  ].join("\n");
  patient.report_workbench = {
    image_name: "ct-report.jpg",
    image_size: "120KB",
    ocr_text: text,
    report_date: "",
    last_status: "待确认",
    ocr_engine: "PaddleOCR"
  };
  const initialReportCount = patient.reports.length;
  const candidates = context.extractReportCandidatesFromText(text, {
    report_date: "",
    image_name: "ct-report.jpg"
  });
  assert(candidates.length === 1, `expected 1 report candidate, got ${candidates.length}`);
  const candidate = candidates[0];
  assert(candidate.field === "report:ocr", `unexpected report candidate field ${candidate.field}`);
  assert(candidate.payload.report_date === "2026-05-27", `bad report date ${candidate.payload.report_date}`);
  assert(candidate.payload.report_title.includes("上腹部增强螺旋CT"), `bad report title ${candidate.payload.report_title}`);
  assert(!candidate.payload.report_title.includes("检查日期"), "report title swallowed following OCR lines");
  assert(candidate.payload.source_ref === "20260522234104", `bad report source ref ${candidate.payload.source_ref}`);
  assert(candidate.payload.confirm_status === "待确认", "report OCR candidate should stay pending before manual confirmation");
  const escapedTextCandidate = context.extractReportCandidatesFromText(text.replaceAll("\n", "\\n"), {
    report_date: "",
    image_name: "ct-report.jpg"
  })[0];
  assert(escapedTextCandidate.payload.report_title === candidate.payload.report_title, "escaped newline OCR text should parse like normal text");
  const prepared = context.prepareReportOcrCandidate(patient);
  assert(prepared === 1, `expected one prepared report candidate, got ${prepared}`);
  assert(patient.reports.length === initialReportCount, "preparing report OCR must not write to reports");
  context.applyCandidate(patient, candidate);
  assert(patient.reports.length === initialReportCount + 1, `expected one report inserted, got ${patient.reports.length - initialReportCount}`);
  const inserted = patient.reports.at(-1);
  assert(inserted.store_image_flag === "否", "report candidate must not store image");
  assert(inserted.confirm_status === "人工确认", "confirmed report must be marked as manually confirmed");
  assert(inserted.report_text_raw.includes("检查结论"), "raw report text missing after confirmation");
  const workbench = context.getReportOcrWorkbench(patient);
  assert(workbench.image_name === "", "report image name should be cleared after confirmation");
  assert(workbench.ocr_text === "", "report OCR text should be cleared after confirmation");
  assert(patient.report_scratch === "", "temporary report source text should be cleared after report OCR confirmation");
}

function verifyReportOcrTypes(context) {
  const pathologyText = [
    "哈尔滨医科大学附属第一医院",
    "病理报告",
    "病理号：P20260527001",
    "报告日期：2026-05-29",
    "病理诊断：胰腺导管腺癌，伴神经侵犯。"
  ].join("\n");
  const pathology = context.extractReportCandidatesFromText(pathologyText, { image_name: "pathology.jpg" })[0];
  assert(pathology.payload.report_type === "病理报告", `bad pathology report type ${pathology.payload.report_type}`);
  assert(pathology.payload.report_title === "病理报告", `bad pathology report title ${pathology.payload.report_title}`);
  assert(pathology.payload.source_ref === "P20260527001", `bad pathology source ref ${pathology.payload.source_ref}`);
  assert(pathology.value.includes("胰腺导管腺癌"), "pathology summary missing diagnosis");

  const dischargeText = [
    "出院记录",
    "住院号：ZY260001",
    "入院日期：2026-05-18",
    "出院日期：2026-05-28",
    "出院诊断：胰腺恶性肿瘤，梗阻性黄疸。",
    "出院医嘱：门诊随访，复查肝功能。"
  ].join("\n");
  const discharge = context.extractReportCandidatesFromText(dischargeText, { image_name: "discharge.jpg" })[0];
  assert(discharge.payload.report_type === "出院记录", `bad discharge report type ${discharge.payload.report_type}`);
  assert(discharge.payload.report_title === "出院记录", `bad discharge report title ${discharge.payload.report_title}`);
  assert(discharge.payload.report_date === "2026-05-28", `bad discharge report date ${discharge.payload.report_date}`);
  assert(discharge.payload.source_ref === "ZY260001", `bad discharge source ref ${discharge.payload.source_ref}`);
  assert(discharge.value.includes("出院诊断"), "discharge summary missing diagnosis");
}

function verifyInvalidLabCandidateIsRetained(context) {
  const patient = context.createPatient();
  const invalid = context.createReviewLabCandidate();
  patient.candidates = [invalid];
  const summary = context.confirmCandidateBatch(patient, context.getCandidates(patient));
  assert(summary.confirmed === 0, `invalid lab candidate should not be confirmed, got ${summary.confirmed}`);
  assert(patient.candidates.length === 1, "invalid lab candidate should remain pending instead of being discarded");
  assert(patient.candidates[0].id === invalid.id, "wrong candidate retained after failed confirmation");
  assert(context.shouldKeepReviewModalOpen(summary), "review modal should remain open when a batch has failed candidates");
}

function verifyUnitlessLabRatioCanBeConfirmed(context) {
  const patient = context.createPatient();
  const text = [
    "编号\t项目名称\t结果\t结果提示\t异常提示\t辅助诊断\t单位\t参考范围",
    "AST/ALT\t天门冬氨酸氨基转移",
    "酶/丙氨酸氨基转移酶\t1.46\t\t\t\t\t"
  ].join("\n");
  const candidate = context.extractLabCandidatesFromText(text, "长项目名换行", "2026-01-04")[0];
  patient.candidates = [candidate];
  const before = patient.labs.length;
  const summary = context.confirmCandidateBatch(patient, [candidate]);
  assert(summary.confirmed === 1, `unitless AST/ALT ratio should confirm, got ${summary.confirmed}`);
  assert(patient.labs.length === before + 1, "unitless AST/ALT ratio should be written to labs");
  assert(patient.labs.at(-1).item_name_raw === "天门冬氨酸氨基转移酶/丙氨酸氨基转移酶", "wrong unitless lab ratio inserted");
}

function verifyReviewModalStaysOpenWhenOtherCandidatesRemain(context) {
  const patient = context.createPatient();
  const lab = context.extractLabCandidatesFromText("WBC\t白细胞\t4.63\t\t\t\t10^9/L\t3.69-9.16", "手动验证", "2026-01-02")[0];
  const history = context.createHistoryCandidate("吸烟史", "否认", "人工新增");
  patient.candidates = [lab, history];
  const summary = context.confirmCandidateBatch(patient, [lab]);
  assert(summary.confirmed === 1, `expected one lab candidate confirmed, got ${summary.confirmed}`);
  assert(patient.candidates.length === 1 && patient.candidates[0].id === history.id, "non-lab candidate should remain after confirming labs only");
  assert(context.shouldKeepReviewModalOpen(summary, patient), "review modal should remain open when other pending candidates remain");
}

function verifyLabOcrWorkbenchClearsWhenOnlyNonLabCandidatesRemain(context) {
  const patient = context.createPatient();
  const lab = context.extractLabCandidatesFromText("WBC\t白细胞\t4.63\t\t\t\t10^9/L\t3.69-9.16", "截图A", "2026-01-02")[0];
  const history = context.createHistoryCandidate("吸烟史", "否认", "人工新增");
  patient.candidates = [lab, history];
  const workbench = context.getOcrWorkbench(patient);
  workbench.image_name = "lab-shot.png";
  workbench.image_size = "80KB";
  workbench.ocr_text = "WBC\t白细胞\t4.63\t\t\t\t10^9/L\t3.69-9.16";
  workbench.capture_queue = [
    { capture_id: "cap-1", name: "lab-shot.png", status: "已生成候选", candidate_count: 1, ocr_text: workbench.ocr_text }
  ];
  const summary = context.confirmCandidateBatch(patient, [lab]);
  assert(summary.confirmed === 1, `expected lab confirmation before pruning, got ${summary.confirmed}`);
  context.pruneCompletedCaptureQueue(patient);
  assert(patient.candidates.length === 1 && patient.candidates[0].field.startsWith("history:"), "non-lab candidate should remain pending");
  assert(workbench.image_name === "", "lab screenshot name should be cleared after lab candidates finish");
  assert(workbench.ocr_text === "", "lab OCR text should be cleared after lab candidates finish");
  assert(workbench.capture_queue.length === 0, "completed capture queue should be cleared after lab candidates finish");
}

function verifyPendingCaptureQueueItemsArePreserved(context) {
  const patient = context.createPatient();
  const lab = context.extractLabCandidatesFromText("WBC\t白细胞\t4.63\t\t\t\t10^9/L\t3.69-9.16", "截图A", "2026-01-02")[0];
  patient.candidates = [lab];
  const workbench = context.getOcrWorkbench(patient);
  workbench.image_name = "done-shot.png";
  workbench.image_size = "80KB";
  workbench.ocr_text = "WBC\t白细胞\t4.63\t\t\t\t10^9/L\t3.69-9.16";
  workbench.capture_queue = [
    { capture_id: "cap-done", name: "done-shot.png", status: "已生成候选", candidate_count: 1, ocr_text: workbench.ocr_text },
    { capture_id: "cap-pending", name: "pending-shot.png", status: "待识别", candidate_count: 0, ocr_text: "" }
  ];
  const summary = context.confirmCandidateBatch(patient, [lab]);
  assert(summary.confirmed === 1, `expected lab confirmation before queue pruning, got ${summary.confirmed}`);
  context.pruneCompletedCaptureQueue(patient);
  assert(workbench.capture_queue.length === 1, `pending capture item should remain, got ${workbench.capture_queue.length}`);
  assert(workbench.capture_queue[0].capture_id === "cap-pending", "wrong capture queue item remained after pruning");
  assert(workbench.image_name === "", "completed screenshot preview should be cleared after pruning");
  assert(workbench.ocr_text === "", "completed screenshot OCR text should be cleared after pruning");
}

function verifyFriendlyUiCopy() {
  const visibleSource = [
    fs.readFileSync("index.html", "utf8"),
    fs.readFileSync("app.js", "utf8")
  ].join("\n");
  ["AI候选", "AI助手", "本地 AI 候选", "AI辅助设置", "模型配置"].forEach((term) => {
    assert(!visibleSource.includes(term), `clinical UI still exposes old technical copy: ${term}`);
  });
  const modelConfigVisibleText = context.renderModelConfig()
    .replace(/\svalue="[^"]*"/g, "")
    .replace(/\saccept="[^"]*"/g, "");
  ["Qwen", "GGUF", "llama.cpp", "Ollama", "Transformers", "本地小模型", "禁用AI"].forEach((term) => {
    assert(!modelConfigVisibleText.includes(term), `assistant settings still expose technical copy: ${term}`);
  });
}

const context = loadAppContext();
verifyLabOcrBatchDate(context);
verifyLabOcrSelectedListDateAndCleanup(context);
verifyLabOcrWrappedLongName(context);
verifyLabOcrDoesNotMergeChineseStandaloneRows(context);
verifyReportOcrCandidateFlow(context);
verifyReportOcrTypes(context);
verifyInvalidLabCandidateIsRetained(context);
verifyUnitlessLabRatioCanBeConfirmed(context);
verifyReviewModalStaysOpenWhenOtherCandidatesRemain(context);
verifyLabOcrWorkbenchClearsWhenOnlyNonLabCandidatesRemain(context);
verifyPendingCaptureQueueItemsArePreserved(context);
verifyFriendlyUiCopy();
console.log("OCR workflow checks passed");

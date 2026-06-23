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
}

const context = loadAppContext();
verifyLabOcrBatchDate(context);
verifyReportOcrCandidateFlow(context);
console.log("OCR workflow checks passed");

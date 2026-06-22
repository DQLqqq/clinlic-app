#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { randomUUID, webcrypto } from "node:crypto";

const expectedSheets = ["患者主表", "住院次", "诊断明细", "化验长表", "报告明细", "随访记录", "字段字典"];
const appPath = new URL("../app.js", import.meta.url);

const source = await readFile(appPath, "utf8");
const context = makeBrowserLikeContext();
vm.createContext(context);
vm.runInContext(
  `${source}
globalThis.__xlsxExportApi = {
  state,
  seedPatients,
  buildExportTables,
  buildExportReport,
  createXlsxWorkbookBlob,
  exportWorkbookSheetNames
};`,
  context,
  { filename: "app.js" }
);

const result = await vm.runInContext(
  `(async () => {
    const api = globalThis.__xlsxExportApi;
    api.state.patients = api.seedPatients();
    api.state.activePatientId = api.state.patients[0].patient_uid;
    api.state.exportConfig.selectedPatients = api.state.patients.map((patient) => patient.patient_uid);
    api.state.exportConfig.selectedFields = [
      "research_id",
      "sex",
      "age_at_admission",
      "admission_date",
      "discharge_date",
      "length_of_stay_days",
      "primary_diagnosis",
      "all_diagnoses",
      "lab_wide",
      "report_summary",
      "last_followup_date",
      "survival_status"
    ];
    const tables = api.buildExportTables(api.state.patients);
    const report = api.buildExportReport(api.state.patients, tables.preview);
    const workbook = api.createXlsxWorkbookBlob(tables.workbookSheets);
    return {
      workbookBuffer: await workbook.arrayBuffer(),
      expectedFromApp: api.exportWorkbookSheetNames,
      previewColumns: tables.preview.columns,
      reportText: report.text
    };
  })()`,
  context
);

const inputPath = getPathArg("--input");
const workbookBuffer = inputPath ? await readFile(inputPath) : Buffer.from(result.workbookBuffer);
const files = unzipStoredWorkbook(workbookBuffer);
const workbookXml = mustGet(files, "xl/workbook.xml");
const sheetNames = [...workbookXml.matchAll(/<sheet name="([^"]+)"/g)].map((match) => decodeXml(match[1]));
const worksheetPaths = [...files.keys()].filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
const patientMasterText = worksheetText(mustGet(files, "xl/worksheets/sheet1.xml"));
const labLongText = worksheetText(mustGet(files, "xl/worksheets/sheet4.xml"));

assertEqualArrays(result.expectedFromApp, expectedSheets, "app sheet-name contract changed");
assertEqualArrays(sheetNames, expectedSheets, "workbook sheet names mismatch");
assert(worksheetPaths.length === expectedSheets.length, `expected ${expectedSheets.length} worksheet files, found ${worksheetPaths.length}`);
assert(files.has("[Content_Types].xml"), "missing [Content_Types].xml");
assert(files.has("xl/_rels/workbook.xml.rels"), "missing workbook relationships");
assert(files.has("xl/styles.xml"), "missing styles.xml");

[
  "研究编号",
  "入院年龄 (岁)",
  "住院天数 (天)",
  "CA19-9_入院首次 (U/mL)",
  "白蛋白_入院首次 (g/L)"
].forEach((text) => assert(patientMasterText.includes(text), `patient master sheet missing ${text}`));

["unit_raw", "U/mL", "g/L"].forEach((text) => assert(labLongText.includes(text), `lab long sheet missing ${text}`));
assert(result.reportText.includes("XLSX工作簿: 7 个Sheet"), "export report missing XLSX workbook summary");

const outputPath = getOutputPath();
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, workbookBuffer);
}

console.log("XLSX export verified");
console.log(`- sheets: ${sheetNames.join(", ")}`);
console.log(`- patient master columns: ${result.previewColumns.length}`);
console.log(`- workbook bytes: ${workbookBuffer.length}`);
if (inputPath) console.log(`- input: ${inputPath}`);
if (outputPath) console.log(`- wrote: ${outputPath}`);

function makeBrowserLikeContext() {
  const element = {
    addEventListener() {},
    querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {} },
    set innerHTML(_value) {},
    get innerHTML() {
      return "";
    },
    set textContent(_value) {},
    get textContent() {
      return "";
    },
    dataset: {},
    value: "",
    click() {}
  };
  const localStorageStore = new Map();
  return {
    console,
    Blob,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    DataView,
    ArrayBuffer,
    Map,
    Set,
    Date,
    Math,
    JSON,
    RegExp,
    String,
    Number,
    URL,
    document: {
      addEventListener() {},
      getElementById: () => element,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => element
    },
    localStorage: {
      getItem: (key) => localStorageStore.get(key) || null,
      setItem: (key, value) => localStorageStore.set(key, String(value)),
      removeItem: (key) => localStorageStore.delete(key)
    },
    navigator: {},
    crypto: {
      randomUUID,
      subtle: webcrypto.subtle
    },
    setTimeout: () => 0,
    clearTimeout() {},
    confirm: () => true
  };
}

function getOutputPath() {
  return getPathArg("--write-output");
}

function getPathArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return "";
  return resolve(value);
}

function unzipStoredWorkbook(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    assert(signature === 0x04034b50, `unexpected ZIP signature at ${offset}`);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const path = buffer.toString("utf8", nameStart, nameEnd);
    assert(method === 0, `ZIP entry ${path} is compressed; verifier expects stored entries`);
    files.set(path, buffer.subarray(dataStart, dataEnd).toString("utf8"));
    offset = dataEnd;
  }
  return files;
}

function mustGet(files, path) {
  const value = files.get(path);
  assert(value !== undefined, `missing ${path}`);
  return value;
}

function worksheetText(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("\n");
}

function decodeXml(text) {
  return String(text)
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function assertEqualArrays(actual, expected, message) {
  assert(actual.length === expected.length && actual.every((item, index) => item === expected[index]), `${message}: ${actual.join(", ")}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`XLSX export verification failed: ${message}`);
    process.exit(1);
  }
}

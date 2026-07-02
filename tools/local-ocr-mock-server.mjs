#!/usr/bin/env node

import http from "node:http";
import { Buffer } from "node:buffer";

const port = Number(process.env.OCR_MOCK_PORT || process.argv[2] || 8766);
const host = normalizeBindHost(process.env.OCR_MOCK_HOST || "127.0.0.1");
const schema = "local-ocr-v1";
const tasks = new Set(["lab_table_ocr", "report_text_ocr"]);
const maxBodyBytes = 12 * 1024 * 1024;
const allowNullOrigin = process.env.OCR_MOCK_ALLOW_NULL_ORIGIN === "1";

const sampleText = [
  "申请日期: 2026-06-22 09:15:00",
  "报告名称: 生化及肿瘤标志物",
  "CA19-9\tCA19-9\t856.4\tH\tU/mL\t0-37",
  "ALB\t白蛋白\t37.6\t\tg/L\t35-55",
  "TBIL\t总胆红素\t42.1\t高\tμmol/L\t3.4-20.5"
].join("\n");

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === "null") return allowNullOrigin;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
    return ["localhost", "127.0.0.1", "::1"].includes(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function normalizeBindHost(value) {
  const hostname = String(value || "").replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    console.error("OCR_MOCK_HOST must be localhost, 127.0.0.1, or ::1");
    process.exit(1);
  }
  return hostname;
}

function corsHeaders(origin) {
  const allowOrigin = isAllowedOrigin(origin) ? origin || "*" : "http://127.0.0.1";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Clinical-OCR-Schema",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function sendJson(res, statusCode, body, origin) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Clinical-OCR-Schema": schema,
    ...corsHeaders(origin)
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validateRequest(payload) {
  if (!payload || typeof payload !== "object") return "请求必须是 JSON 对象";
  if (payload.schema_version !== schema) return `schema_version 必须是 ${schema}`;
  if (!tasks.has(payload.task)) return "仅支持 lab_table_ocr 或 report_text_ocr";
  if (!payload.privacy?.offline_only || !payload.privacy?.human_confirm_required) return "缺少离线和人工确认标记";
  if (payload.privacy?.store_image !== false) return "privacy.store_image 必须为 false";
  if (payload.image && payload.image.retain_image !== false) return "image.retain_image 必须为 false";
  if (!payload.image && !String(payload.manual_text || "").trim()) return "缺少截图或文本";
  return "";
}

function buildOcrResponse(payload) {
  const manualText = String(payload.manual_text || "").trim();
  return {
    request_id: payload.request_id || "",
    schema_version: schema,
    text: manualText || sampleText,
    engine: "mock-local-ocr",
    confidence: manualText ? 0.99 : 0.93,
    image_retained: false
  };
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    sendJson(res, 403, { error: "Origin 必须是本机页面" }, origin);
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(
      res,
      200,
      {
        ok: true,
        schema_version: schema,
        engine: "mock-local-ocr",
        image_retained: false,
        dependencies: {
          ready: true,
          offline_ready: true,
          model_cache: { ready: true }
        }
      },
      origin
    );
    return;
  }

  if (req.method !== "POST" || req.url !== "/ocr") {
    sendJson(res, 404, { error: "仅支持 POST /ocr" }, origin);
    return;
  }

  try {
    const body = await readBody(req);
    const payload = JSON.parse(body || "{}");
    const validationError = validateRequest(payload);
    if (validationError) {
      sendJson(res, 400, { error: validationError }, origin);
      return;
    }
    sendJson(res, 200, buildOcrResponse(payload), origin);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "OCR mock 请求失败" }, origin);
  }
});

server.listen(port, host, () => {
  console.log(`Local OCR mock server listening at http://${host}:${port}/ocr`);
});

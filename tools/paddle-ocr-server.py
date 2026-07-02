#!/usr/bin/env python3
"""Local PaddleOCR adapter for the clinical data app OCR contract."""

from __future__ import annotations

import argparse
import base64
import importlib.metadata
import importlib.util
import json
import os
import socket
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from statistics import median
from typing import Any


SCHEMA_VERSION = "local-ocr-v1"
TASK_NAMES = {"lab_table_ocr", "report_text_ocr"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
LAB_TABLE_COLUMNS = [
    {"key": "code", "aliases": ("编号", "缩写", "代码")},
    {"key": "name", "aliases": ("项目名称", "项目", "名称")},
    {"key": "result", "aliases": ("结果", "检验结果", "测定结果")},
    {"key": "result_hint", "aliases": ("结果提示",)},
    {"key": "flag", "aliases": ("异常提示", "异常")},
    {"key": "diagnosis", "aliases": ("辅助诊断",)},
    {"key": "unit", "aliases": ("单位",)},
    {"key": "reference", "aliases": ("参考范围", "参考区间")},
    {"key": "history", "aliases": ("历次", "历史")},
]


@dataclass
class ServerConfig:
    host: str
    port: int
    lang: str
    engine: str
    ocr_version: str
    use_angle_cls: bool
    max_body_bytes: int
    allow_file_origin: bool


_ocr_engine: Any | None = None


def package_status(import_name: str, distribution_name: str | None = None) -> dict[str, Any]:
    spec = importlib.util.find_spec(import_name)
    installed = spec is not None
    version = ""
    if installed:
        try:
            version = importlib.metadata.version(distribution_name or import_name)
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"
    return {"installed": installed, "version": version}


def paddle_dependency_status() -> dict[str, Any]:
    paddleocr = package_status("paddleocr")
    paddle = package_status("paddle", "paddlepaddle")
    missing = [name for name, status in {"paddleocr": paddleocr, "paddle": paddle}.items() if not status["installed"]]
    return {
        "paddleocr": paddleocr,
        "paddle": paddle,
        "ready": not missing,
        "missing": missing,
        "offline_install_hint": "python -m pip install --no-index --find-links D:\\wheelhouse paddleocr paddlepaddle opencv-python pillow"
        if missing
        else "",
    }


def normalize_host(value: str) -> str:
    host = (value or "127.0.0.1").strip().strip("[]").lower()
    if host not in LOCAL_HOSTS:
        raise ValueError("host must be localhost, 127.0.0.1, or ::1")
    return host


def format_host(host: str) -> str:
    return f"[{host}]" if ":" in host else host


def is_allowed_origin(origin: str | None, allow_file_origin: bool) -> bool:
    if not origin:
        return True
    if origin == "null":
        return allow_file_origin
    try:
        from urllib.parse import urlparse

        parsed = urlparse(origin)
        hostname = (parsed.hostname or "").strip("[]").lower()
        return hostname in LOCAL_HOSTS or hostname.endswith(".localhost")
    except Exception:
        return False


def cors_headers(origin: str | None, allow_file_origin: bool) -> dict[str, str]:
    if origin and is_allowed_origin(origin, allow_file_origin):
        allow_origin = origin
    elif not origin:
        allow_origin = "*"
    else:
        allow_origin = "http://127.0.0.1"
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Clinical-OCR-Schema",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
    }


def send_json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    origin = handler.headers.get("Origin")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("X-Clinical-OCR-Schema", SCHEMA_VERSION)
    for key, value in cors_headers(origin, handler.server.config.allow_file_origin).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or "0")
    if length <= 0:
        return {}
    if length > handler.server.config.max_body_bytes:
        raise ValueError("请求体过大，请压缩截图或分批识别")
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8") or "{}")


def validate_request(payload: dict[str, Any]) -> str:
    if not isinstance(payload, dict):
        return "请求必须是 JSON 对象"
    if payload.get("schema_version") != SCHEMA_VERSION:
        return f"schema_version 必须是 {SCHEMA_VERSION}"
    if payload.get("task") not in TASK_NAMES:
        return "仅支持 lab_table_ocr 或 report_text_ocr"
    privacy = payload.get("privacy") or {}
    if privacy.get("offline_only") is not True:
        return "缺少 offline_only 标记"
    if privacy.get("human_confirm_required") is not True:
        return "缺少人工确认标记"
    if privacy.get("store_image") is not False:
        return "privacy.store_image 必须为 false"
    image = payload.get("image")
    manual_text = str(payload.get("manual_text") or "").strip()
    if image:
        if image.get("retain_image") is not False:
            return "image.retain_image 必须为 false"
        if not image.get("data_url") and not manual_text:
            return "缺少 image.data_url"
    elif not manual_text:
        return "缺少截图或文本"
    return ""


def decode_data_url(data_url: str) -> tuple[bytes, str]:
    if not data_url:
        raise ValueError("缺少 image.data_url")
    header, separator, encoded = data_url.partition(",")
    if not separator or ";base64" not in header:
        raise ValueError("image.data_url 必须是 base64 data URL")
    try:
        return base64.b64decode(encoded, validate=True), header
    except Exception as exc:
        raise ValueError("image.data_url 解码失败") from exc


def image_bytes_to_array(image_bytes: bytes) -> Any:
    try:
        import cv2
        import numpy as np

        array = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(array, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("cv2 failed to decode image")
        return image
    except Exception:
        try:
            import numpy as np
            from PIL import Image

            with Image.open(BytesIO(image_bytes)) as image:
                return np.asarray(image.convert("RGB"))
        except Exception as exc:
            raise ValueError("无法解码图片，请确认截图格式") from exc


def get_paddle_engine(config: ServerConfig) -> Any:
    global _ocr_engine
    if _ocr_engine is not None:
        return _ocr_engine
    try:
        from paddleocr import PaddleOCR
    except Exception as exc:
        raise RuntimeError("未安装 PaddleOCR/PaddlePaddle，请先按文档安装本机依赖") from exc

    option_sets: list[dict[str, Any]] = []
    base_options: dict[str, Any] = {"lang": config.lang}
    if config.ocr_version:
        base_options["ocr_version"] = config.ocr_version
    option_sets.append(
        {
            **base_options,
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": config.use_angle_cls,
            "engine": config.engine,
        }
    )
    option_sets.append({**base_options, "use_angle_cls": config.use_angle_cls, "show_log": False})
    option_sets.append({**base_options, "use_angle_cls": config.use_angle_cls})
    option_sets.append({**base_options, "show_log": False})
    option_sets.append(base_options)

    last_error: Exception | None = None
    for options in option_sets:
        try:
            _ocr_engine = PaddleOCR(**options)
            return _ocr_engine
        except TypeError as exc:
            last_error = exc
            continue
    raise RuntimeError(f"PaddleOCR 初始化失败：{last_error}") from last_error


def run_paddle_ocr(image_array: Any, config: ServerConfig) -> Any:
    engine = get_paddle_engine(config)
    if hasattr(engine, "predict"):
        try:
            return engine.predict(input=image_array)
        except TypeError:
            return engine.predict(image_array)
    if hasattr(engine, "ocr"):
        try:
            return engine.ocr(image_array, cls=config.use_angle_cls)
        except TypeError:
            return engine.ocr(image_array)
    raise RuntimeError("当前 PaddleOCR 对象缺少 ocr/predict 方法")


def to_plain(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "tolist"):
        try:
            return value.tolist()
        except Exception:
            pass
    if isinstance(value, dict):
        return {str(key): to_plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_plain(item) for item in value]
    for attr_name in ("json", "to_dict"):
        attr = getattr(value, attr_name, None)
        if attr is None:
            continue
        try:
            converted = attr() if callable(attr) else attr
            return to_plain(converted)
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        return {key: to_plain(item) for key, item in vars(value).items() if not key.startswith("_")}
    return str(value)


def normalize_line_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())


def confidence_from(value: Any) -> float | None:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    if score < 0 or score > 1:
        return None
    return round(score, 4)


def normalize_box(value: Any) -> list[list[float]] | None:
    plain = to_plain(value)
    if not isinstance(plain, list):
        return None
    points: list[list[float]] = []
    for item in plain:
        if isinstance(item, list) and len(item) >= 2:
            try:
                points.append([float(item[0]), float(item[1])])
            except (TypeError, ValueError):
                return None
    return points or None


def add_line(lines: list[dict[str, Any]], text: Any, confidence: Any = None, box: Any = None) -> None:
    normalized = normalize_line_text(text)
    if not normalized:
        return
    item: dict[str, Any] = {"text": normalized}
    score = confidence_from(confidence)
    if score is not None:
        item["confidence"] = score
    normalized_box = normalize_box(box)
    if normalized_box:
        item["box"] = normalized_box
    lines.append(item)


def collect_lines(node: Any, lines: list[dict[str, Any]]) -> None:
    plain = to_plain(node)
    if isinstance(plain, dict):
        consumed_keys: set[str] = set()
        rec_texts = plain.get("rec_texts")
        if isinstance(rec_texts, list):
            consumed_keys.add("rec_texts")
            scores = plain.get("rec_scores") or plain.get("scores") or []
            boxes = plain.get("rec_polys") or plain.get("dt_polys") or plain.get("boxes") or []
            consumed_keys.update({"rec_scores", "scores", "rec_polys", "dt_polys", "boxes"})
            for index, text in enumerate(rec_texts):
                add_line(lines, text, scores[index] if index < len(scores) else None, boxes[index] if index < len(boxes) else None)
        text = plain.get("text") or plain.get("rec_text") or plain.get("transcription") or plain.get("label")
        if text:
            consumed_keys.update({"text", "rec_text", "transcription", "label", "score", "rec_score", "confidence", "box", "points", "poly"})
            score = plain.get("score") or plain.get("rec_score") or plain.get("confidence")
            box = plain.get("box") or plain.get("points") or plain.get("poly")
            add_line(lines, text, score, box)
        for key, value in plain.items():
            if key in consumed_keys:
                continue
            collect_lines(value, lines)
        return
    if isinstance(plain, list):
        if len(plain) == 2 and isinstance(plain[1], list) and plain[1] and isinstance(plain[1][0], str):
            confidence = plain[1][1] if len(plain[1]) > 1 else None
            add_line(lines, plain[1][0], confidence, plain[0])
            return
        if len(plain) >= 2 and isinstance(plain[0], str):
            add_line(lines, plain[0], plain[1] if len(plain) > 1 else None)
            return
        for value in plain:
            collect_lines(value, lines)


def dedupe_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, Any]] = []
    for line in lines:
        key = (line.get("text", ""), json.dumps(line.get("box", []), sort_keys=True))
        if key in seen:
            continue
        seen.add(key)
        unique.append(line)
    return unique


def box_bounds(box: list[list[float]]) -> tuple[float, float, float, float] | None:
    if not box:
        return None
    xs = [point[0] for point in box]
    ys = [point[1] for point in box]
    return min(xs), min(ys), max(xs), max(ys)


def rebuild_text_from_lines(lines: list[dict[str, Any]], prefer_table: bool = False) -> str:
    boxed: list[dict[str, Any]] = []
    unboxed: list[str] = []
    for line in lines:
        bounds = box_bounds(line.get("box") or [])
        if not bounds:
            unboxed.append(line["text"])
            continue
        x1, y1, x2, y2 = bounds
        boxed.append({**line, "x": x1, "x2": x2, "y": (y1 + y2) / 2, "height": max(1.0, y2 - y1)})
    if not boxed:
        return "\n".join(unboxed)

    rows = group_boxed_rows(boxed)
    if prefer_table:
        table_text = rebuild_lab_table_text(rows, unboxed)
        if table_text:
            return table_text

    text_rows = []
    for row in sorted(rows, key=lambda value: sum(cell["y"] for cell in value) / len(value)):
        cells = [normalize_ocr_cell(cell["text"]) for cell in sorted(row, key=lambda value: value["x"])]
        text_rows.append("\t".join(cells))
    text_rows.extend(unboxed)
    return "\n".join(normalize_ocr_row(row) for row in text_rows if row.strip())


def group_boxed_rows(boxed: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    heights = [item["height"] for item in boxed]
    row_threshold = max(14.0, median(heights) * 1.05)
    rows: list[list[dict[str, Any]]] = []
    for item in sorted(boxed, key=lambda value: (value["y"], value["x"])):
        matched = None
        for row in rows:
            row_center = sum(cell["y"] for cell in row) / len(row)
            if abs(item["y"] - row_center) <= row_threshold:
                matched = row
                break
        if matched is None:
            rows.append([item])
        else:
            matched.append(item)
    return rows


def rebuild_lab_table_text(rows: list[list[dict[str, Any]]], unboxed: list[str]) -> str:
    header_index, anchors = detect_lab_table_columns(rows)
    if header_index < 0 or len(anchors) < 3:
        return ""

    ordered_columns = ordered_lab_columns(anchors)
    output_rows: list[list[str]] = []
    for row in rows[header_index + 1 :]:
        row_values = assign_row_to_columns(row, ordered_columns)
        if not any(row_values.values()):
            continue
        if should_merge_table_continuation(row_values) and output_rows:
            merge_table_continuation(output_rows[-1], row_values, ordered_columns)
            continue
        if not is_probable_lab_data_row(row_values):
            continue
        output_rows.append([row_values.get(column["key"], "") for column in ordered_columns])

    if not output_rows:
        return ""
    text_rows = ["\t".join([normalize_ocr_cell(value) for value in row]).rstrip("\t") for row in output_rows]
    text_rows.extend(unboxed)
    return "\n".join(normalize_ocr_row(row) for row in text_rows if row.strip())


def build_ocr_debug_payload(lines: list[dict[str, Any]], prefer_table: bool = False) -> dict[str, Any]:
    boxed: list[dict[str, Any]] = []
    unboxed = 0
    for line in lines:
        bounds = box_bounds(line.get("box") or [])
        if not bounds:
            unboxed += 1
            continue
        x1, y1, x2, y2 = bounds
        boxed.append({**line, "x": x1, "x2": x2, "y": (y1 + y2) / 2, "height": max(1.0, y2 - y1)})
    rows = group_boxed_rows(boxed) if boxed else []
    header_index, anchors = detect_lab_table_columns(rows) if prefer_table else (-1, [])
    columns = ordered_lab_columns(anchors) if header_index >= 0 else []
    table_rows: list[list[str]] = []
    if columns:
        for row in rows[header_index + 1 :]:
            values = assign_row_to_columns(row, columns)
            if is_probable_lab_data_row(values):
                table_rows.append([values.get(column["key"], "") for column in columns])
            elif should_merge_table_continuation(values) and table_rows:
                merge_table_continuation(table_rows[-1], values, columns)
    return {
        "line_count": len(lines),
        "boxed_line_count": len(boxed),
        "unboxed_line_count": unboxed,
        "row_count": len(rows),
        "table_detected": bool(columns),
        "header_row_index": header_index,
        "columns": [str(column["key"]) for column in columns],
        "table_rows": table_rows[:20],
    }


def detect_lab_table_columns(rows: list[list[dict[str, Any]]]) -> tuple[int, list[dict[str, Any]]]:
    best_index = -1
    best_anchors: list[dict[str, Any]] = []
    best_score = 0
    for row_index, row in enumerate(rows):
        anchors: list[dict[str, Any]] = []
        used_keys: set[str] = set()
        for cell in sorted(row, key=lambda value: value["x"]):
            key = lab_column_key_for_text(str(cell.get("text") or ""))
            if not key or key in used_keys:
                continue
            used_keys.add(key)
            anchors.append({**cell, "key": key, "center": (cell["x"] + cell.get("x2", cell["x"])) / 2})
        keys = {anchor["key"] for anchor in anchors}
        score = len(keys)
        if {"name", "result"}.issubset(keys):
            score += 2
        if "unit" in keys:
            score += 1
        if score > best_score:
            best_index = row_index
            best_anchors = anchors
            best_score = score
    keys = {anchor["key"] for anchor in best_anchors}
    if not ({"name", "result"}.issubset(keys) and ("unit" in keys or "reference" in keys or "flag" in keys)):
        return -1, []
    return best_index, best_anchors


def lab_column_key_for_text(text: str) -> str:
    normalized = normalize_ocr_cell(text).replace(" ", "")
    if not normalized:
        return ""
    best_key = ""
    best_length = 0
    for column in LAB_TABLE_COLUMNS:
        for alias in column["aliases"]:
            if alias in normalized and len(alias) > best_length:
                best_key = str(column["key"])
                best_length = len(alias)
    return best_key


def ordered_lab_columns(anchors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key = {anchor["key"]: anchor for anchor in anchors}
    ordered = []
    for definition in LAB_TABLE_COLUMNS:
        key = definition["key"]
        if key not in by_key:
            continue
        anchor = by_key[key]
        ordered.append({**definition, "x": anchor["center"]})
    return sorted(ordered, key=lambda value: value["x"])


def assign_row_to_columns(row: list[dict[str, Any]], columns: list[dict[str, Any]]) -> dict[str, str]:
    values: dict[str, list[str]] = {str(column["key"]): [] for column in columns}
    if not columns:
        return {}
    for cell in sorted(row, key=lambda value: value["x"]):
        text = normalize_ocr_cell(cell.get("text") or "")
        if not text:
            continue
        center = (cell["x"] + cell.get("x2", cell["x"])) / 2
        column = nearest_column(center, columns)
        values[str(column["key"])].append(text)
    return {key: " ".join(items).strip() for key, items in values.items()}


def nearest_column(center: float, columns: list[dict[str, Any]]) -> dict[str, Any]:
    return min(columns, key=lambda column: abs(float(column["x"]) - center))


def should_merge_table_continuation(values: dict[str, str]) -> bool:
    has_result = bool(values.get("result"))
    has_code = bool(values.get("code"))
    has_unit = bool(values.get("unit"))
    has_reference = bool(values.get("reference"))
    return not (has_result or has_code or has_unit or has_reference)


def merge_table_continuation(previous: list[str], values: dict[str, str], columns: list[dict[str, Any]]) -> None:
    for index, column in enumerate(columns):
        text = values.get(str(column["key"]), "")
        if not text:
            continue
        previous[index] = f"{previous[index]} {text}".strip()


def is_probable_lab_data_row(values: dict[str, str]) -> bool:
    if not (values.get("result") or values.get("name") or values.get("code")):
        return False
    if values.get("result") and values.get("unit"):
        return True
    return bool(values.get("name") and values.get("result"))


def normalize_ocr_cell(text: str) -> str:
    return " ".join(str(text or "").replace("\r", " ").replace("\n", " ").split())


def normalize_ocr_row(text: str) -> str:
    row = str(text or "").replace("μ", "μ").replace("µ", "μ")
    row = row.replace("／", "/").replace("10~", "10^")
    row = row.replace("×10^", "10^").replace("x10^", "10^")
    return row.strip()


def average_confidence(lines: list[dict[str, Any]]) -> float | None:
    scores = [line["confidence"] for line in lines if isinstance(line.get("confidence"), (int, float))]
    if not scores:
        return None
    return round(sum(scores) / len(scores), 4)


def build_response(payload: dict[str, Any], config: ServerConfig) -> dict[str, Any]:
    manual_text = str(payload.get("manual_text") or "").strip()
    image = payload.get("image") or {}
    if not image.get("data_url"):
        return {
            "request_id": payload.get("request_id") or "",
            "schema_version": SCHEMA_VERSION,
            "text": manual_text,
            "engine": "paddleocr-local/manual-text",
            "confidence": 0.99,
            "image_retained": False,
        }

    started = time.perf_counter()
    image_bytes, _header = decode_data_url(str(image.get("data_url")))
    image_array = image_bytes_to_array(image_bytes)
    raw_result = run_paddle_ocr(image_array, config)
    lines: list[dict[str, Any]] = []
    collect_lines(raw_result, lines)
    lines = dedupe_lines(lines)
    prefer_table = payload.get("task") == "lab_table_ocr"
    text = rebuild_text_from_lines(lines, prefer_table=prefer_table)
    if not text.strip() and manual_text:
        text = manual_text
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {
        "request_id": payload.get("request_id") or "",
        "schema_version": SCHEMA_VERSION,
        "text": text,
        "lines": lines,
        "debug": build_ocr_debug_payload(lines, prefer_table=prefer_table),
        "engine": "paddleocr-local",
        "provider": "PaddleOCR",
        "confidence": average_confidence(lines),
        "elapsed_ms": elapsed_ms,
        "image": {
            "name": image.get("name") or "",
            "size": image.get("size") or len(image_bytes),
            "type": image.get("type") or "",
            "retained": False,
        },
        "image_retained": False,
    }


def make_handler(config: ServerConfig):
    class PaddleOcrHandler(BaseHTTPRequestHandler):
        server_version = "ClinicalPaddleOCR/1.0"

        def log_message(self, format: str, *args: Any) -> None:
            print(f"{self.address_string()} - {format % args}")

        def do_OPTIONS(self) -> None:
            origin = self.headers.get("Origin")
            if not is_allowed_origin(origin, config.allow_file_origin):
                send_json(self, 403, {"ok": False, "error": "Origin 必须是本机页面"})
                return
            self.send_response(204)
            for key, value in cors_headers(origin, config.allow_file_origin).items():
                self.send_header(key, value)
            self.end_headers()

        def do_GET(self) -> None:
            origin = self.headers.get("Origin")
            if not is_allowed_origin(origin, config.allow_file_origin):
                send_json(self, 403, {"ok": False, "error": "Origin 必须是本机页面"})
                return
            if self.path != "/health":
                send_json(self, 404, {"ok": False, "error": "仅支持 GET /health"})
                return
            send_json(
                self,
                200,
                {
                    "ok": True,
                    "schema_version": SCHEMA_VERSION,
                    "engine": "paddleocr-local",
                    "paddle_engine": config.engine,
                    "lang": config.lang,
                    "dependencies": paddle_dependency_status(),
                    "image_retained": False,
                },
            )

        def do_POST(self) -> None:
            origin = self.headers.get("Origin")
            if not is_allowed_origin(origin, config.allow_file_origin):
                send_json(self, 403, {"ok": False, "error": "Origin 必须是本机页面"})
                return
            if self.path != "/ocr":
                send_json(self, 404, {"ok": False, "error": "仅支持 POST /ocr"})
                return
            try:
                payload = read_json_body(self)
                validation_error = validate_request(payload)
                if validation_error:
                    send_json(self, 400, {"ok": False, "error": validation_error})
                    return
                response = build_response(payload, config)
                send_json(self, 200, {"ok": True, **response})
            except Exception as exc:
                send_json(self, 400, {"ok": False, "error": str(exc) or "PaddleOCR 识别失败"})

    return PaddleOcrHandler


def make_server(config: ServerConfig, handler_class: type[BaseHTTPRequestHandler]) -> ThreadingHTTPServer:
    class LocalOnlyThreadingHTTPServer(ThreadingHTTPServer):
        address_family = socket.AF_INET6 if ":" in config.host else socket.AF_INET

    server = LocalOnlyThreadingHTTPServer((config.host, config.port), handler_class)
    server.config = config
    return server


def parse_args() -> ServerConfig:
    parser = argparse.ArgumentParser(description="Run a local PaddleOCR HTTP adapter for local-ocr-v1.")
    parser.add_argument("--host", default=os.environ.get("PADDLE_OCR_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PADDLE_OCR_PORT", "8766")))
    parser.add_argument("--lang", default=os.environ.get("PADDLE_OCR_LANG", "ch"))
    parser.add_argument("--engine", default=os.environ.get("PADDLE_OCR_ENGINE", "paddle"))
    parser.add_argument("--ocr-version", default=os.environ.get("PADDLE_OCR_VERSION", ""))
    parser.set_defaults(use_angle_cls=True)
    parser.add_argument("--use-angle-cls", dest="use_angle_cls", action="store_true")
    parser.add_argument("--no-angle-cls", dest="use_angle_cls", action="store_false")
    parser.add_argument("--max-body-mb", type=float, default=float(os.environ.get("PADDLE_OCR_MAX_BODY_MB", "12")))
    parser.add_argument(
        "--allow-file-origin",
        action="store_true",
        default=os.environ.get("PADDLE_OCR_ALLOW_FILE_ORIGIN") == "1",
        help="allow file:// prototype pages whose browser Origin is null",
    )
    args = parser.parse_args()
    return ServerConfig(
        host=normalize_host(args.host),
        port=args.port,
        lang=args.lang,
        engine=args.engine,
        ocr_version=args.ocr_version,
        use_angle_cls=bool(args.use_angle_cls),
        max_body_bytes=max(1, int(args.max_body_mb * 1024 * 1024)),
        allow_file_origin=bool(args.allow_file_origin),
    )


def main() -> None:
    config = parse_args()
    handler_class = make_handler(config)
    server = make_server(config, handler_class)
    url = f"http://{format_host(config.host)}:{config.port}/ocr"
    print(f"PaddleOCR local server listening at {url}")
    print("Images are decoded in memory only; original screenshots are not stored.")
    server.serve_forever()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Local PaddleOCR adapter for the clinical data app OCR contract."""

from __future__ import annotations

import argparse
import base64
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
        rec_texts = plain.get("rec_texts")
        if isinstance(rec_texts, list):
            scores = plain.get("rec_scores") or plain.get("scores") or []
            boxes = plain.get("rec_polys") or plain.get("dt_polys") or plain.get("boxes") or []
            for index, text in enumerate(rec_texts):
                add_line(lines, text, scores[index] if index < len(scores) else None, boxes[index] if index < len(boxes) else None)
        text = plain.get("text") or plain.get("rec_text") or plain.get("transcription") or plain.get("label")
        if text:
            score = plain.get("score") or plain.get("rec_score") or plain.get("confidence")
            box = plain.get("box") or plain.get("points") or plain.get("poly")
            add_line(lines, text, score, box)
        for value in plain.values():
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


def rebuild_text_from_lines(lines: list[dict[str, Any]]) -> str:
    boxed: list[dict[str, Any]] = []
    unboxed: list[str] = []
    for line in lines:
        bounds = box_bounds(line.get("box") or [])
        if not bounds:
            unboxed.append(line["text"])
            continue
        x1, y1, x2, y2 = bounds
        boxed.append({**line, "x": x1, "y": (y1 + y2) / 2, "height": max(1.0, y2 - y1)})
    if not boxed:
        return "\n".join(unboxed)

    heights = [item["height"] for item in boxed]
    row_threshold = max(10.0, median(heights) * 0.7)
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

    text_rows = []
    for row in rows:
        cells = [cell["text"] for cell in sorted(row, key=lambda value: value["x"])]
        text_rows.append("\t".join(cells))
    text_rows.extend(unboxed)
    return "\n".join(row for row in text_rows if row.strip())


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
    text = rebuild_text_from_lines(lines)
    if not text.strip() and manual_text:
        text = manual_text
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {
        "request_id": payload.get("request_id") or "",
        "schema_version": SCHEMA_VERSION,
        "text": text,
        "lines": lines,
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

#!/usr/bin/env python3
"""Check local PaddleOCR deployment readiness without storing images."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import mimetypes
import sys
from pathlib import Path
from typing import Any


def load_adapter() -> Any:
    module_path = Path(__file__).with_name("paddle-ocr-server.py")
    spec = importlib.util.spec_from_file_location("paddle_ocr_server", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def data_url_for_image(path: Path) -> tuple[str, str, int]:
    image_bytes = path.read_bytes()
    mime_type = mimetypes.guess_type(path.name)[0] or "image/png"
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}", mime_type, len(image_bytes)


def build_payload(args: argparse.Namespace) -> dict[str, Any]:
    adapter = load_adapter()
    config = adapter.ServerConfig(
        host=adapter.normalize_host(args.host),
        port=args.port,
        lang=args.lang,
        engine=args.engine,
        ocr_version=args.ocr_version,
        use_angle_cls=not args.no_angle_cls,
        max_body_bytes=int(args.max_body_mb * 1024 * 1024),
        allow_file_origin=True,
    )
    health = adapter.health_payload(config)
    service_url = f"http://{adapter.format_host(config.host)}:{config.port}/ocr"
    payload: dict[str, Any] = {
        **health,
        "service_url": service_url,
        "smoke_test": {"requested": bool(args.image), "ran": False, "status": "not_requested"},
    }
    if not args.image:
        return payload

    image_path = Path(args.image).expanduser()
    payload["smoke_test"] = {
        "requested": True,
        "ran": False,
        "status": "blocked",
        "image_name": image_path.name,
        "reason": "",
    }
    if not image_path.exists():
        payload["smoke_test"]["reason"] = "image file not found"
        return payload
    if not health["dependencies"]["ready"]:
        payload["smoke_test"]["reason"] = "paddleocr/paddle dependencies are not ready"
        return payload

    data_url, mime_type, image_size = data_url_for_image(image_path)
    request = {
        "request_id": "deployment_smoke",
        "schema_version": adapter.SCHEMA_VERSION,
        "app_schema_version": "v3",
        "task": args.task,
        "image": {
            "name": image_path.name,
            "size": image_size,
            "type": mime_type,
            "data_url": data_url,
            "retain_image": False,
        },
        "manual_text": "",
        "options": {"language": "zh-CN", "table_hint": args.task == "lab_table_ocr", "return_text": True, "return_boxes": True},
        "privacy": {"offline_only": True, "store_image": False, "human_confirm_required": True},
    }
    response = adapter.build_response(request, config)
    payload["smoke_test"] = {
        "requested": True,
        "ran": True,
        "status": "passed" if response.get("text") else "empty_text",
        "image_name": image_path.name,
        "engine": response.get("engine", ""),
        "elapsed_ms": response.get("elapsed_ms", ""),
        "text_preview": str(response.get("text") or "")[:240],
        "line_count": len(response.get("lines") or []),
        "debug": response.get("debug") or {},
        "image_retained": response.get("image_retained") is True,
    }
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check offline PaddleOCR deployment readiness.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--lang", default="ch")
    parser.add_argument("--engine", default="paddle")
    parser.add_argument("--ocr-version", default="")
    parser.add_argument("--no-angle-cls", action="store_true")
    parser.add_argument("--max-body-mb", type=float, default=12)
    parser.add_argument("--image", default="", help="optional local screenshot for a real OCR smoke test")
    parser.add_argument("--task", choices=["lab_table_ocr", "report_text_ocr"], default="lab_table_ocr")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = build_payload(args)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        deps = payload["dependencies"]
        print(f"Service: {payload['service_url']}")
        print(f"Python: {deps['python']['version']} ({deps['python']['executable']})")
        print(f"PaddleOCR installed: {deps['paddleocr']['installed']} {deps['paddleocr']['version']}")
        print(f"Paddle installed: {deps['paddle']['installed']} {deps['paddle']['version']}")
        print(f"Ready: {deps['ready']}")
        if deps.get("offline_install_hint"):
            print(f"Offline install: {deps['offline_install_hint']}")
        if payload["smoke_test"]["requested"]:
            print(f"Smoke test: {payload['smoke_test']['status']}")
            if payload["smoke_test"].get("reason"):
                print(f"Reason: {payload['smoke_test']['reason']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

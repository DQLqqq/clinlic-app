#!/usr/bin/env python3
"""Check local PaddleOCR deployment readiness without storing images."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import mimetypes
import socket
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


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
    host = adapter.normalize_host(args.host)
    config = adapter.ServerConfig(
        host=host,
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
    health_url = f"http://{adapter.format_host(config.host)}:{config.port}/health"
    service = probe_service_status(host, config.port, health_url)
    doctor_status = classify_deployment_status(health["dependencies"], service)
    payload: dict[str, Any] = {
        **health,
        "service_url": service_url,
        "health_url": health_url,
        "service": service,
        "doctor_status": doctor_status,
        "doctor_message": doctor_status["doctor_message"],
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
    block_reason = smoke_block_reason(health["dependencies"])
    if block_reason:
        payload["smoke_test"]["reason"] = block_reason
        return payload
    if not image_path.exists():
        payload["smoke_test"]["reason"] = "image file not found"
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


def smoke_block_reason(dependencies: dict[str, Any]) -> str:
    if not dependencies.get("ready"):
        return "paddleocr/paddle dependencies are not ready"
    if not dependencies.get("offline_ready", dependencies.get("ready")):
        return "paddleocr model cache is not ready"
    return ""


def probe_service_status(host: str, port: int, health_url: str, timeout_seconds: float = 1.0) -> dict[str, Any]:
    port_open = is_tcp_port_open(host, port, timeout_seconds)
    health: dict[str, Any] = {}
    health_error = ""
    if port_open:
        try:
            request = Request(health_url, headers={"Accept": "application/json"})
            with urlopen(request, timeout=timeout_seconds) as response:
                body = response.read(512 * 1024).decode("utf-8")
                health = json.loads(body or "{}")
        except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            health_error = str(exc)
    healthy = is_healthy_service_payload(health, load_adapter().SCHEMA_VERSION)
    return {
        "host": host,
        "port": port,
        "health_url": health_url,
        "port_open": port_open,
        "healthy": healthy,
        "health_error": "" if healthy else health_error,
        "engine": health.get("engine", "") if isinstance(health, dict) else "",
    }


def is_tcp_port_open(host: str, port: int, timeout_seconds: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            return True
    except OSError:
        return False


def is_healthy_service_payload(payload: dict[str, Any], schema_version: str) -> bool:
    if not isinstance(payload, dict):
        return False
    dependencies = payload.get("dependencies") or {}
    model_cache = dependencies.get("model_cache") or {}
    return bool(
        payload.get("ok") is True
        and payload.get("schema_version") == schema_version
        and payload.get("image_retained") is False
        and dependencies.get("ready") is True
        and dependencies.get("offline_ready") is True
        and model_cache.get("ready") is True
    )


def classify_deployment_status(dependencies: dict[str, Any], service: dict[str, Any]) -> dict[str, Any]:
    if not dependencies.get("ready"):
        missing = "、".join(str(item) for item in dependencies.get("missing") or []) or "识别组件"
        return deployment_status(
            "missing_dependencies",
            "缺少识别组件",
            f"离线识别运行包不完整，缺少 {missing}。请联系信息科补齐随软件携带的运行包；当前仍可继续手动粘贴文字。",
            ["联系信息科补齐离线运行包", "暂时继续手动粘贴文字"],
        )
    model_cache = dependencies.get("model_cache") or {}
    if not dependencies.get("offline_ready", dependencies.get("ready")) or not model_cache.get("ready", True):
        return deployment_status(
            "missing_models",
            "缺少模型文件",
            "离线识别包不完整，请联系信息科处理；当前仍可继续手动粘贴文字。",
            ["联系信息科处理", "重新检查", "继续手动粘贴文字"],
        )
    if service.get("healthy"):
        return deployment_status(
            "available",
            "识别服务可用",
            "识别服务已启动，可以识别截图；识别结果仍需人工确认后才入库。",
            ["回到 APP 选择图片识别", "识别后检查待导入表格", "不清楚时继续手动粘贴文字"],
        )
    if service.get("port_open"):
        return deployment_status(
            "port_occupied",
            "端口被占用",
            "识别服务端口已经被其他程序占用，当前 APP 不能确认这是本系统的识别服务。",
            ["关闭占用端口的程序", "重新检查", "继续手动粘贴文字"],
        )
    return deployment_status(
        "not_started",
        "未启动",
        "识别服务还没有启动；可以先启动服务，也可以继续手动粘贴文字。",
        ["启动识别服务", "重新检查", "继续手动粘贴文字"],
    )


def deployment_status(status_key: str, status_label: str, doctor_message: str, next_steps: list[str]) -> dict[str, Any]:
    return {
        "status_key": status_key,
        "status_label": status_label,
        "doctor_message": doctor_message,
        "next_steps": next_steps,
    }


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
        doctor_status = payload["doctor_status"]
        print(f"识别服务状态：{doctor_status['status_label']}")
        print(doctor_status["doctor_message"])
        print(f"本机地址：{payload['service_url']}")
        print(f"Python：{deps['python']['version']} ({deps['python']['executable']})")
        print(f"识别组件：{'已安装' if deps['ready'] else '未准备好'}")
        model_cache = deps.get("model_cache") or {}
        print(f"模型文件：{'已准备' if model_cache.get('ready') else '缺少'} ({model_cache.get('base_dir', '')})")
        if model_cache.get("missing"):
            print(f"缺少文件：{', '.join(model_cache['missing'])}")
        print("下一步：")
        for step in doctor_status["next_steps"]:
            print(f"- {step}")
        if deps.get("offline_install_hint"):
            print(f"离线安装命令（信息科使用）：{deps['offline_install_hint']}")
        if model_cache.get("offline_prepare_hint"):
            print(f"模型文件准备：{model_cache['offline_prepare_hint']}")
        if payload["smoke_test"]["requested"]:
            print(f"真实识别测试：{payload['smoke_test']['status']}")
            if payload["smoke_test"].get("reason"):
                print(f"原因：{payload['smoke_test']['reason']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

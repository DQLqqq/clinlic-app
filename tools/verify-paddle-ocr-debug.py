#!/usr/bin/env python3
"""Smoke checks for the local PaddleOCR adapter debug payload."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any


def load_module() -> Any:
    module_path = Path("tools/paddle-ocr-server.py")
    spec = importlib.util.spec_from_file_location("paddle_ocr_server", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def box(x: int, y: int, w: int = 40, h: int = 12) -> list[list[int]]:
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]


def main() -> None:
    module = load_module()
    dependency_status = module.paddle_dependency_status()
    assert "paddleocr" in dependency_status
    assert "paddle" in dependency_status
    assert isinstance(dependency_status["paddleocr"]["installed"], bool)
    assert isinstance(dependency_status["paddle"]["installed"], bool)
    if not dependency_status["paddleocr"]["installed"] or not dependency_status["paddle"]["installed"]:
        assert "wheelhouse" in dependency_status["offline_install_hint"]

    lines = [
        {"text": "编号", "box": box(10, 20)},
        {"text": "项目名称", "box": box(110, 20)},
        {"text": "结果", "box": box(250, 20)},
        {"text": "异常提示", "box": box(380, 20)},
        {"text": "单位", "box": box(510, 20)},
        {"text": "参考范围", "box": box(620, 20)},
        {"text": "AST", "box": box(10, 50)},
        {"text": "天门冬氨酸氨基转移酶", "box": box(110, 50)},
        {"text": "54.0", "box": box(250, 50)},
        {"text": "H", "box": box(380, 50)},
        {"text": "U/L", "box": box(510, 50)},
        {"text": "15-40", "box": box(620, 50)},
    ]
    debug = module.build_ocr_debug_payload(lines, prefer_table=True)
    assert debug["line_count"] == len(lines)
    assert debug["table_detected"] is True
    assert debug["columns"][:6] == ["code", "name", "result", "flag", "unit", "reference"]
    assert debug["table_rows"][0][:6] == ["AST", "天门冬氨酸氨基转移酶", "54.0", "H", "U/L", "15-40"]
    assert "data_url" not in str(debug)
    print("PaddleOCR debug payload checks passed")


if __name__ == "__main__":
    main()

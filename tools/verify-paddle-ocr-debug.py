#!/usr/bin/env python3
"""Smoke checks for the local PaddleOCR adapter debug payload."""

from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any


def load_module() -> Any:
    module_path = Path("tools/paddle-ocr-server.py")
    spec = importlib.util.spec_from_file_location("paddle_ocr_server", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_check_module() -> Any:
    module_path = Path("tools/check-paddle-ocr-deployment.py")
    spec = importlib.util.spec_from_file_location("check_paddle_ocr_deployment", module_path)
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
    assert "model_cache" in dependency_status
    assert dependency_status["model_cache"]["base_dir"]
    assert len(dependency_status["model_cache"]["required_models"]) >= 3
    assert isinstance(dependency_status["model_cache"]["ready"], bool)
    assert isinstance(dependency_status["paddleocr"]["installed"], bool)
    assert isinstance(dependency_status["paddle"]["installed"], bool)
    with tempfile.TemporaryDirectory() as empty_model_dir:
        cache_status = module.paddle_model_cache_status(empty_model_dir)
        assert cache_status["ready"] is False
        partial_dir = Path(empty_model_dir) / module.REQUIRED_PADDLE_MODELS[0]
        partial_dir.mkdir()
        (partial_dir / "inference.yml").write_text("partial", encoding="utf-8")
        partial_status = module.paddle_model_cache_status(empty_model_dir)
        assert partial_status["ready"] is False
        assert any("inference.pdiparams" in item for item in partial_status["missing"])
        check_module = load_check_module()
        old_model_dir = os.environ.get("PADDLE_PDX_MODEL_DIR")
        os.environ["PADDLE_PDX_MODEL_DIR"] = empty_model_dir
        try:
            assert check_module.smoke_block_reason({"ready": True, "offline_ready": False}) == "paddleocr model cache is not ready"
            blocked_payload = check_module.build_payload(
                SimpleNamespace(
                    host="127.0.0.1",
                    port=8766,
                    lang="ch",
                    engine="paddle",
                    ocr_version="",
                    no_angle_cls=False,
                    max_body_mb=12,
                    image=str(Path(empty_model_dir) / "missing.png"),
                    task="lab_table_ocr",
                    json=True,
                )
            )
            assert blocked_payload["dependencies"]["offline_ready"] is False
            assert blocked_payload["smoke_test"]["status"] == "blocked"
            assert blocked_payload["smoke_test"]["reason"]
        finally:
            if old_model_dir is None:
                os.environ.pop("PADDLE_PDX_MODEL_DIR", None)
            else:
                os.environ["PADDLE_PDX_MODEL_DIR"] = old_model_dir
    runtime_status = module.python_runtime_status()
    assert runtime_status["executable"]
    assert runtime_status["version"].count(".") >= 1
    assert runtime_status["implementation"]
    install_plan = module.offline_install_plan()
    assert install_plan["wheelhouse_example"].endswith("wheelhouse")
    assert "paddleocr" in install_plan["packages"]
    assert "paddlepaddle" in install_plan["packages"]
    assert "--no-index" in install_plan["offline_install_command"]
    if not dependency_status["paddleocr"]["installed"] or not dependency_status["paddle"]["installed"]:
        assert "wheelhouse" in dependency_status["offline_install_hint"]
        assert dependency_status["install_plan"]["ready"] is False
        assert dependency_status["install_plan"]["python"]["executable"] == runtime_status["executable"]
    health_payload = module.health_payload(module.ServerConfig("127.0.0.1", 8766, "ch", "paddle", "", True, 1024 * 1024, True))
    assert health_payload["dependencies"]["python"]["executable"] == runtime_status["executable"]
    assert "model_cache" in health_payload["dependencies"]
    assert health_payload["image_retained"] is False
    assert "data_url" not in str(health_payload)

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

    sidebar_noise_lines = [
        {"text": "编号", "box": box(300, 20)},
        {"text": "项目名称", "box": box(410, 20)},
        {"text": "结果", "box": box(650, 20)},
        {"text": "异常提示", "box": box(760, 20)},
        {"text": "单位", "box": box(880, 20)},
        {"text": "参考范围", "box": box(990, 20)},
        {"text": "目关融性(H M试验)", "box": box(20, 50, 150)},
        {"text": "AST", "box": box(300, 50)},
        {"text": "天门冬氨酸氨基转移酶", "box": box(410, 50)},
        {"text": "54.0", "box": box(650, 50)},
        {"text": "H", "box": box(760, 50)},
        {"text": "U/L", "box": box(880, 50)},
        {"text": "15-40", "box": box(990, 50)},
    ]
    sidebar_debug = module.build_ocr_debug_payload(sidebar_noise_lines, prefer_table=True)
    assert sidebar_debug["table_rows"][0][:6] == ["AST", "天门冬氨酸氨基转移酶", "54.0", "H", "U/L", "15-40"]

    merged_row_lines = [
        {"text": "编号", "box": box(300, 20)},
        {"text": "项目名称", "box": box(410, 20)},
        {"text": "结果", "box": box(650, 20)},
        {"text": "异常提示", "box": box(760, 20)},
        {"text": "单位", "box": box(880, 20)},
        {"text": "参考范围", "box": box(990, 20)},
        {"text": "量检测 γ-GT TBIL", "box": box(300, 50, 90)},
        {"text": "★γ-谷氨酰基转移酶 ★总胆红素", "box": box(410, 50, 180)},
        {"text": "34.18 57.9", "box": box(650, 50, 80)},
        {"text": "H", "box": box(760, 50)},
        {"text": "μmol/L U/L", "box": box(880, 50, 80)},
        {"text": "10-60 0-26", "box": box(990, 50, 80)},
    ]
    merged_debug = module.build_ocr_debug_payload(merged_row_lines, prefer_table=True)
    assert merged_debug["table_rows"][:2] == [
        ["γ-GT", "γ-谷氨酰基转移酶", "57.9", "", "U/L", "10-60"],
        ["TBIL", "总胆红素", "34.18", "H", "μmol/L", "0-26"],
    ]

    range_value_lines = [
        {"text": "编号", "box": box(300, 20)},
        {"text": "项目名称", "box": box(410, 20)},
        {"text": "结果", "box": box(650, 20)},
        {"text": "单位", "box": box(880, 20)},
        {"text": "参考范围", "box": box(990, 20)},
        {"text": "RATIO", "box": box(300, 50)},
        {"text": "比值范围", "box": box(410, 50)},
        {"text": "0.8-1.5", "box": box(650, 50)},
        {"text": "%", "box": box(880, 50)},
    ]
    range_debug = module.build_ocr_debug_payload(range_value_lines, prefer_table=True)
    assert range_debug["table_rows"] == [["RATIO", "比值范围", "0.8-1.5", "%", ""]]

    range_with_two_codes_lines = [
        {"text": "编号", "box": box(300, 20)},
        {"text": "项目名称", "box": box(410, 20)},
        {"text": "结果", "box": box(650, 20)},
        {"text": "单位", "box": box(880, 20)},
        {"text": "参考范围", "box": box(990, 20)},
        {"text": "A B", "box": box(300, 50)},
        {"text": "比值范围", "box": box(410, 50)},
        {"text": "0.8-1.5", "box": box(650, 50)},
        {"text": "%", "box": box(880, 50)},
    ]
    range_two_codes_debug = module.build_ocr_debug_payload(range_with_two_codes_lines, prefer_table=True)
    assert range_two_codes_debug["table_rows"] == [["A B", "比值范围", "0.8-1.5", "%", ""]]
    cli = subprocess.run(
        [sys.executable, "tools/check-paddle-ocr-deployment.py", "--json"],
        check=True,
        capture_output=True,
        text=True,
    )
    cli_payload = json.loads(cli.stdout)
    assert cli_payload["schema_version"] == module.SCHEMA_VERSION
    assert cli_payload["service_url"] == "http://127.0.0.1:8766/ocr"
    assert cli_payload["dependencies"]["python"]["executable"] == runtime_status["executable"]
    assert "--no-index" in cli_payload["dependencies"]["install_plan"]["offline_install_command"]
    assert cli_payload["image_retained"] is False
    assert "data_url" not in cli.stdout
    print("PaddleOCR debug payload checks passed")


if __name__ == "__main__":
    main()

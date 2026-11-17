"""Camera device discovery and opening (AVFoundation on macOS, DirectShow on Windows)."""

from __future__ import annotations

import json
import subprocess
import sys

import cv2

MAX_CAMERA_INDEX = 10  # probe indices 0-9


def _backend() -> int:
    if sys.platform == "darwin":
        return cv2.CAP_AVFOUNDATION
    if sys.platform == "win32":
        return cv2.CAP_DSHOW
    return cv2.CAP_ANY


def parse_macos_camera_names(system_profiler_json: str) -> list[str]:
    """Extract camera names from ``system_profiler SPCameraDataType -json`` output."""
    try:
        entries = json.loads(system_profiler_json).get("SPCameraDataType", [])
    except (ValueError, AttributeError):
        return []
    return [str(e["_name"]) for e in entries if isinstance(e, dict) and "_name" in e]


def _run(command: list[str]) -> str:
    try:
        completed = subprocess.run(  # fixed argument lists, no shell
            command, capture_output=True, text=True, timeout=10, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return completed.stdout


def list_camera_names() -> list[str]:
    """Best-effort OS camera names, in the OS enumeration order (usually matches OpenCV)."""
    if sys.platform == "darwin":
        return parse_macos_camera_names(
            _run(["/usr/sbin/system_profiler", "SPCameraDataType", "-json"])
        )
    if sys.platform == "win32":
        script = (
            "Get-CimInstance Win32_PnPEntity | "
            "Where-Object { $_.PNPClass -in 'Camera','Image' } | "
            "Select-Object -ExpandProperty Name"
        )
        output = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script])
        return [line.strip() for line in output.splitlines() if line.strip()]
    return []


def open_camera(index: int) -> cv2.VideoCapture | None:
    """Open camera ``index``; return ``None`` if it cannot be opened."""
    capture = cv2.VideoCapture(index, _backend())
    if not capture.isOpened():
        capture.release()
        return None
    return capture


def discover_cameras() -> list[dict[str, int | str]]:
    """Probe indices 0-9 and return ``[{"index": i, "name": ...}, ...]`` for those that open."""
    names = list_camera_names()
    devices: list[dict[str, int | str]] = []
    for index in range(MAX_CAMERA_INDEX):
        capture = open_camera(index)
        if capture is None:
            continue
        capture.release()
        name = names[index] if index < len(names) else f"Camera {index}"
        devices.append({"index": index, "name": name})
    return devices

"""Gaze tracker side-process.

Protocol (newline-delimited JSON). With --list-devices only the "devices" message is printed
and the process exits.

stdout (this process -> Electron)
  {"type": "ready", "version": "..."}
  {"type": "devices", "list": [{"index": 0, "name": "..."}]}
  {"type": "gaze", "ts": 1700000000.123, "zone": "camera|screen|away", "confidence": 0.91}
  {"type": "error", "message": "..."}
  Only while calibrating (about 10 per second, including a small mirrored JPEG preview):
  {"type": "calibration", "face": true, "h": 0.51, "v": 0.01, "yaw": 2.0, "pitch": -1.0,
   "zone": "camera|screen|away", "phase": "camera|screen|null",
   "camera_samples": 12, "screen_samples": 0, "preview": "<base64 jpeg>"}
  {"type": "calibration_result", "ok": true, "good": true, "camera_samples": 40,
   "screen_samples": 40, "camera_hit": 0.97, "screen_hit": 0.9, "thresholds": {...}}

stdin (Electron -> this process)
  {"cmd": "set_camera", "index": N}
  {"cmd": "set_confidence_threshold", "value": 0.0-1.0}
  {"cmd": "set_stability", "preset": "responsive|balanced|steady"}
  {"cmd": "set_thresholds", "thresholds": {...} | null}   (null restores the defaults)
  {"cmd": "calibration_start"} / {"cmd": "calibration_stop"}
  {"cmd": "calibration_phase", "phase": "camera|screen|null"}
  {"cmd": "calibration_fit"}

Exits cleanly on SIGTERM/SIGINT or when stdin is closed. Frames never leave this process.
"""

from __future__ import annotations

import argparse
import json
import queue
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any

from gaze.calibration import (
    PHASES,
    CalibrationSession,
    parse_thresholds,
    thresholds_to_dict,
)
from gaze.classifier import GazeMeasurement, GazeThresholds
from gaze.stabilizer import DEFAULT_STABILITY, PRESETS

VERSION = "0.1.0"
DEFAULT_MODEL = Path(__file__).resolve().parent / "models" / "face_landmarker.task"
READ_FAILURE_RETRY_S = 0.1
CALIBRATION_UPDATE_INTERVAL_S = 0.1
MAX_CAMERA_INDEX = 9


def emit(message: dict[str, Any]) -> None:
    """Write one JSON line to stdout and flush (stdout is reserved for protocol messages)."""
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def parse_command(line: str) -> dict[str, Any] | None:
    """Validate one stdin line; return the command dict, or ``None`` if invalid."""
    try:
        data = json.loads(line)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    if data.get("cmd") == "set_camera":
        index = data.get("index")
        if (
            isinstance(index, int)
            and not isinstance(index, bool)
            and 0 <= index <= MAX_CAMERA_INDEX
        ):
            return {"cmd": "set_camera", "index": index}
    elif data.get("cmd") == "set_confidence_threshold":
        value = data.get("value")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and 0.0 <= value <= 1.0:
            return {"cmd": "set_confidence_threshold", "value": float(value)}
    elif data.get("cmd") == "set_stability":
        preset = data.get("preset")
        if isinstance(preset, str) and preset in PRESETS:
            return {"cmd": "set_stability", "preset": preset}
    elif data.get("cmd") == "set_thresholds":
        if "thresholds" not in data:
            return None
        if data["thresholds"] is None:
            return {"cmd": "set_thresholds", "thresholds": None}
        thresholds = parse_thresholds(data["thresholds"])
        if thresholds is not None:
            return {"cmd": "set_thresholds", "thresholds": thresholds}
    elif data.get("cmd") in ("calibration_start", "calibration_stop", "calibration_fit"):
        return {"cmd": data["cmd"]}
    elif data.get("cmd") == "calibration_phase":
        phase = data.get("phase")
        if phase is None or (isinstance(phase, str) and phase in PHASES):
            return {"cmd": "calibration_phase", "phase": phase}
    return None


def calibration_message(
    measurement: GazeMeasurement | None,
    zone: str,
    session: CalibrationSession,
    preview: str | None,
) -> dict[str, Any]:
    """One live calibration update. Numbers are ``None`` while no face is visible."""
    return {
        "type": "calibration",
        "face": measurement is not None,
        "h": None if measurement is None else round(measurement.h_ratio, 3),
        "v": None if measurement is None else round(measurement.v_ratio, 3),
        "yaw": None if measurement is None else round(measurement.yaw, 1),
        "pitch": None if measurement is None else round(measurement.pitch, 1),
        "zone": zone,
        "phase": session.phase,
        "camera_samples": session.count("camera"),
        "screen_samples": session.count("screen"),
        "preview": preview,
    }


def calibration_result_message(session: CalibrationSession) -> dict[str, Any]:
    result = session.fit()
    if result is None:
        return {"type": "calibration_result", "ok": False}
    return {
        "type": "calibration_result",
        "ok": True,
        "good": result.good,
        "camera_samples": result.camera_samples,
        "screen_samples": result.screen_samples,
        "camera_hit": round(result.camera_hit, 3),
        "screen_hit": round(result.screen_hit, 3),
        "thresholds": thresholds_to_dict(result.thresholds),
    }


def _unit_float(text: str) -> float:
    value = float(text)
    if not 0.0 <= value <= 1.0:
        raise argparse.ArgumentTypeError("must be between 0.0 and 1.0")
    return value


def _camera_index(text: str) -> int:
    value = int(text)
    if not 0 <= value <= MAX_CAMERA_INDEX:
        raise argparse.ArgumentTypeError(f"must be between 0 and {MAX_CAMERA_INDEX}")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Teams Eye Contact Coach gaze tracker")
    parser.add_argument("--camera-index", type=_camera_index, default=0)
    parser.add_argument("--confidence-threshold", type=_unit_float, default=0.5)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL, help="face_landmarker.task")
    parser.add_argument(
        "--stability",
        choices=sorted(PRESETS),
        default=DEFAULT_STABILITY,
        help="how strongly the camera/screen/away zone is smoothed",
    )
    parser.add_argument(
        "--list-devices", action="store_true", help="print the camera list and exit"
    )
    return parser


def _read_stdin(commands: queue.Queue[dict[str, Any]], stop: threading.Event) -> None:
    """Forward valid commands to the main loop; request shutdown when stdin closes."""
    for line in sys.stdin:
        command = parse_command(line)
        if command is not None:
            commands.put(command)
    stop.set()


def run(args: argparse.Namespace) -> int:
    # Heavy imports are deferred so --help and the helpers above stay fast and testable.
    from gaze.camera import discover_cameras, open_camera
    from gaze.estimator import GazeEstimator
    from gaze.preview import encode_preview

    if args.list_devices:
        emit({"type": "devices", "list": discover_cameras()})
        return 0

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())

    emit({"type": "ready", "version": VERSION})
    if not args.model.is_file():
        emit({"type": "error", "message": f"Model file not found: {args.model.name}"})
        return 1
    emit({"type": "devices", "list": discover_cameras()})

    commands: queue.Queue[dict[str, Any]] = queue.Queue()
    threading.Thread(target=_read_stdin, args=(commands, stop), daemon=True).start()

    stability = args.stability
    estimator = GazeEstimator(
        args.model, min_confidence=args.confidence_threshold, stability=stability
    )
    capture = open_camera(args.camera_index)
    if capture is None:
        emit({"type": "error", "message": f"Cannot open camera {args.camera_index}"})

    last_timestamp_ms = -1
    calibration: CalibrationSession | None = None
    last_update = 0.0
    try:
        while not stop.is_set():
            try:
                command = commands.get_nowait()
            except queue.Empty:
                command = None

            if command is not None:
                if command["cmd"] == "set_camera":
                    new_capture = open_camera(command["index"])
                    if new_capture is None:
                        emit({"type": "error", "message": f"Cannot open camera {command['index']}"})
                    else:
                        if capture is not None:
                            capture.release()
                        capture = new_capture
                elif command["cmd"] == "set_stability":
                    stability = command["preset"]
                    estimator.set_stability(stability)
                elif command["cmd"] == "set_thresholds":
                    estimator.set_thresholds(command["thresholds"] or GazeThresholds())
                elif command["cmd"] == "calibration_start":
                    calibration = CalibrationSession()
                elif command["cmd"] == "calibration_stop":
                    calibration = None
                elif command["cmd"] == "calibration_phase":
                    if calibration is not None:
                        calibration.set_phase(command["phase"])
                elif command["cmd"] == "calibration_fit":
                    if calibration is not None:
                        emit(calibration_result_message(calibration))
                else:
                    estimator.close()
                    estimator = GazeEstimator(
                        args.model,
                        min_confidence=command["value"],
                        thresholds=estimator.thresholds,
                        stability=stability,
                    )
                continue

            if capture is None:
                stop.wait(READ_FAILURE_RETRY_S)
                continue

            ok, frame = capture.read()
            if not ok or frame is None:
                stop.wait(READ_FAILURE_RETRY_S)
                continue

            # MediaPipe VIDEO mode requires strictly increasing timestamps.
            last_timestamp_ms = max(last_timestamp_ms + 1, int(time.monotonic() * 1000))
            measurement = estimator.analyze(frame, last_timestamp_ms)
            zone, score = estimator.stabilize(last_timestamp_ms, measurement)
            if calibration is not None:
                calibration.add(measurement)
                now = time.monotonic()
                if now - last_update >= CALIBRATION_UPDATE_INTERVAL_S:
                    last_update = now
                    emit(calibration_message(measurement, zone, calibration, encode_preview(frame)))
            emit(
                {
                    "type": "gaze",
                    "ts": round(time.time(), 3),
                    "zone": zone,
                    "confidence": round(score, 3),
                }
            )
    finally:
        if capture is not None:
            capture.release()
        estimator.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())

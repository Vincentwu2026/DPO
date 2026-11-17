"""Gaze tracker side-process.

Protocol (newline-delimited JSON). With --list-devices only the "devices" message is printed
and the process exits.

stdout (this process -> Electron)
  {"type": "ready", "version": "..."}
  {"type": "devices", "list": [{"index": 0, "name": "..."}]}
  {"type": "gaze", "ts": 1700000000.123, "zone": "camera|screen|away", "confidence": 0.91}
  {"type": "error", "message": "..."}

stdin (Electron -> this process)
  {"cmd": "set_camera", "index": N}
  {"cmd": "set_confidence_threshold", "value": 0.0-1.0}

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

VERSION = "0.1.0"
DEFAULT_MODEL = Path(__file__).resolve().parent / "models" / "face_landmarker.task"
READ_FAILURE_RETRY_S = 0.1
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
    return None


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

    estimator = GazeEstimator(args.model, min_confidence=args.confidence_threshold)
    capture = open_camera(args.camera_index)
    if capture is None:
        emit({"type": "error", "message": f"Cannot open camera {args.camera_index}"})

    last_timestamp_ms = -1
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
                else:
                    estimator.close()
                    estimator = GazeEstimator(args.model, min_confidence=command["value"])
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
            zone, score = estimator.process(frame, last_timestamp_ms)
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

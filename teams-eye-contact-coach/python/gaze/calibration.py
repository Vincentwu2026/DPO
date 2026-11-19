"""Personal gaze calibration (pure logic, no MediaPipe / OpenCV dependency).

The generic thresholds in ``GazeThresholds`` assume an average face and camera. Real setups differ:
the head-pose estimate has a bias per camera and per face, and irises sit differently in each
person's eyes. Calibration measures the user twice:

* looking straight at the camera lens  -> centres of the "camera" zone and its natural jitter
* looking at the middle of the screen  -> where the "screen" zone sits relative to those centres

``fit_thresholds`` turns the two sample sets into personal ``GazeThresholds`` and reports how many
of the calibration samples those thresholds classify correctly, so a poor result is visible.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, fields
from typing import Any

import numpy as np

from .classifier import ZONE_CAMERA, ZONE_SCREEN, GazeMeasurement, GazeThresholds, classify

PHASE_CAMERA = "camera"
PHASE_SCREEN = "screen"
PHASES = (PHASE_CAMERA, PHASE_SCREEN)

# Frames needed per phase before a fit is attempted (about a second of video).
MIN_SAMPLES = 20
# A result is "good" when this share of each phase is classified into the right zone.
MIN_CAMERA_HIT = 0.85
MIN_SCREEN_HIT = 0.70

# measurement attribute, centre field, tolerance field, tolerance floor, tolerance ceiling
# The floors sit above the frame-to-frame jitter of a real webcam (yaw from the generic-head
# PnP pose swings by more than +-10 degrees even while looking at the lens), so a still
# calibration cannot shrink the camera zone below what live use needs.
_AXES = (
    ("h_ratio", "h_center", "h_tolerance", 0.05, 0.25),
    ("v_ratio", "v_center", "v_tolerance", 0.04, 0.15),
    ("yaw", "yaw_center", "camera_max_yaw", 12.0, 30.0),
    ("pitch", "pitch_center", "camera_max_pitch", 6.0, 30.0),
)

# Accepted range per threshold field; also used to validate values sent over stdin.
_BOUNDS: dict[str, tuple[float, float]] = {
    "h_center": (0.3, 0.7),
    "h_tolerance": (0.01, 0.3),
    "v_center": (-0.3, 0.3),
    "v_tolerance": (0.01, 0.3),
    "yaw_center": (-45.0, 45.0),
    "pitch_center": (-45.0, 45.0),
    "camera_max_yaw": (3.0, 45.0),
    "camera_max_pitch": (3.0, 45.0),
    "away_yaw": (20.0, 80.0),
    "away_pitch": (20.0, 80.0),
}


@dataclass(frozen=True)
class CalibrationResult:
    thresholds: GazeThresholds
    camera_samples: int
    screen_samples: int
    camera_hit: float  # share of the "lens" samples the thresholds classify as camera
    screen_hit: float  # share of the "screen" samples the thresholds classify as screen

    @property
    def good(self) -> bool:
        return self.camera_hit >= MIN_CAMERA_HIT and self.screen_hit >= MIN_SCREEN_HIT


def thresholds_to_dict(thresholds: GazeThresholds) -> dict[str, float]:
    return {key: float(value) for key, value in asdict(thresholds).items()}


def parse_thresholds(data: Any) -> GazeThresholds | None:
    """Validate an untrusted threshold dict; ``None`` unless every field is present and sane."""
    if not isinstance(data, dict) or set(data) != {f.name for f in fields(GazeThresholds)}:
        return None
    values: dict[str, float] = {}
    for key, (low, high) in _BOUNDS.items():
        value = data.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        if not math.isfinite(value) or not low <= value <= high:
            return None
        values[key] = float(value)
    # "Away" must start well beyond the camera zone, otherwise the zones overlap.
    if values["away_yaw"] < values["camera_max_yaw"] + 5.0:
        return None
    if values["away_pitch"] < values["camera_max_pitch"] + 5.0:
        return None
    return GazeThresholds(**values)


def _fit_axis(
    camera: np.ndarray, screen: np.ndarray, floor: float, ceiling: float
) -> tuple[float, float]:
    """Centre and tolerance for one axis."""
    centre = float(np.median(camera))
    spread = float(np.percentile(np.abs(camera - centre), 95))
    tolerance = 1.75 * spread
    gap = abs(float(np.median(screen)) - centre)
    # Keep the boundary well short of where the screen gaze sits, but never inside the
    # user's own lens-gaze jitter.
    tolerance = min(tolerance, 0.6 * gap)
    tolerance = max(tolerance, 1.25 * spread, floor)
    return centre, min(tolerance, ceiling)


def fit_thresholds(
    camera: list[GazeMeasurement], screen: list[GazeMeasurement]
) -> CalibrationResult | None:
    """Fit personal thresholds, or ``None`` if either phase has too few usable frames."""
    if len(camera) < MIN_SAMPLES or len(screen) < MIN_SAMPLES:
        return None

    defaults = GazeThresholds()
    values = asdict(defaults)
    for attr, centre_key, tolerance_key, floor, ceiling in _AXES:
        cam = np.array([getattr(m, attr) for m in camera], dtype=np.float64)
        scr = np.array([getattr(m, attr) for m in screen], dtype=np.float64)
        values[centre_key], values[tolerance_key] = _fit_axis(cam, scr, floor, ceiling)
    # Turning away stays a clearly larger movement than the (possibly widened) camera zone.
    values["away_yaw"] = min(max(defaults.away_yaw, 2.0 * values["camera_max_yaw"]), 80.0)
    values["away_pitch"] = min(max(defaults.away_pitch, 2.0 * values["camera_max_pitch"]), 80.0)
    thresholds = GazeThresholds(**values)

    camera_hit = sum(classify(m, thresholds)[0] == ZONE_CAMERA for m in camera) / len(camera)
    screen_hit = sum(classify(m, thresholds)[0] == ZONE_SCREEN for m in screen) / len(screen)
    return CalibrationResult(thresholds, len(camera), len(screen), camera_hit, screen_hit)


class CalibrationSession:
    """Collects measurements for the current phase; ``None`` (no face) frames are not counted."""

    def __init__(self) -> None:
        self.phase: str | None = None  # None = paused between steps
        self._samples: dict[str, list[GazeMeasurement]] = {p: [] for p in PHASES}

    def set_phase(self, phase: str | None) -> None:
        if phase is not None and phase not in PHASES:
            raise ValueError(f"Unknown calibration phase: {phase}")
        self.phase = phase
        if phase is not None:
            self._samples[phase] = []  # re-doing a step starts it afresh

    def add(self, measurement: GazeMeasurement | None) -> None:
        if self.phase is not None and measurement is not None:
            self._samples[self.phase].append(measurement)

    def count(self, phase: str) -> int:
        return len(self._samples[phase])

    def fit(self) -> CalibrationResult | None:
        return fit_thresholds(self._samples[PHASE_CAMERA], self._samples[PHASE_SCREEN])

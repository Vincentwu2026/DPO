"""Pure gaze-zone classification logic (no MediaPipe / OpenCV dependency)."""

from __future__ import annotations

from dataclasses import dataclass

ZONE_CAMERA = "camera"
ZONE_SCREEN = "screen"
ZONE_AWAY = "away"


@dataclass(frozen=True)
class GazeThresholds:
    """Configurable zone thresholds.

    Gaze ratios are measured relative to the eye corners (see ``estimator``):
    ``h`` is 0.5 when the iris is centred between the corners, and ``v`` is 0.0 when the
    iris is on the corner line (positive = iris below the line). Angles are in degrees.
    These are starting values; they are expected to be tuned against real footage.
    """

    h_center: float = 0.5
    h_tolerance: float = 0.08
    v_center: float = 0.0
    v_tolerance: float = 0.05
    camera_max_yaw: float = 15.0
    camera_max_pitch: float = 15.0
    away_yaw: float = 40.0
    away_pitch: float = 35.0


@dataclass(frozen=True)
class GazeMeasurement:
    """Per-frame measurements derived from face landmarks."""

    h_ratio: float
    v_ratio: float
    yaw: float
    pitch: float


def classify(
    measurement: GazeMeasurement | None, thresholds: GazeThresholds | None = None
) -> tuple[str, float]:
    """Classify a measurement into ``(zone, confidence)``.

    * ``away``: no face, or extreme head rotation.
    * ``camera``: iris centred and head frontal (all deviations within tolerance).
    * ``screen``: anything else (gaze displaced down/sideways, head moderately turned).

    Confidence is 1.0 for ``away`` (a definite condition). For ``camera`` and ``screen`` it
    grows with the margin from the camera/screen boundary, in the range 0.5 - 1.0.
    """
    t = thresholds or GazeThresholds()

    if measurement is None:
        return ZONE_AWAY, 1.0

    if abs(measurement.yaw) > t.away_yaw or abs(measurement.pitch) > t.away_pitch:
        return ZONE_AWAY, 1.0

    # Largest deviation from the "looking at the camera" pose, in units of its tolerance.
    deviation = max(
        abs(measurement.h_ratio - t.h_center) / t.h_tolerance,
        abs(measurement.v_ratio - t.v_center) / t.v_tolerance,
        abs(measurement.yaw) / t.camera_max_yaw,
        abs(measurement.pitch) / t.camera_max_pitch,
    )

    if deviation <= 1.0:
        return ZONE_CAMERA, 1.0 - 0.5 * deviation
    return ZONE_SCREEN, min(1.0, 0.5 + 0.5 * (deviation - 1.0))

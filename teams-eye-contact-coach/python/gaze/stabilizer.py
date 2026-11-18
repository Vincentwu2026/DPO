"""Temporal stabilisation of per-frame gaze classification (pure logic, no MediaPipe/OpenCV).

A raw frame-by-frame classifier flips between ``camera`` and ``screen`` whenever sensor noise
crosses the boundary. ``GazeStabilizer`` makes the reported zone steady with three layers:

1. the deviation from the camera pose is exponentially smoothed (time constant ``smoothing_s``);
2. a dead band (``hysteresis``) around the boundary: a committed ``camera`` zone is only left
   above ``1 + hysteresis`` and re-entered below ``1 - hysteresis``;
3. a change of zone is only committed after the new zone has held for ``dwell_s`` seconds
   (``away_dwell_s`` for a lost or turned-away face, so blinks and tracking drops are ignored).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .classifier import (
    ZONE_AWAY,
    ZONE_CAMERA,
    ZONE_SCREEN,
    GazeMeasurement,
    GazeThresholds,
    deviation,
    is_away,
    zone_confidence,
)


@dataclass(frozen=True)
class StabilityPreset:
    smoothing_s: float  # EMA time constant of the deviation
    hysteresis: float  # half-width of the camera/screen dead band, in tolerance units
    dwell_s: float  # a camera <-> screen change must hold this long
    away_dwell_s: float  # losing the face / turning away must hold this long


PRESETS: dict[str, StabilityPreset] = {
    "responsive": StabilityPreset(
        smoothing_s=0.10, hysteresis=0.10, dwell_s=0.15, away_dwell_s=0.5
    ),
    "balanced": StabilityPreset(smoothing_s=0.25, hysteresis=0.20, dwell_s=0.35, away_dwell_s=0.8),
    "steady": StabilityPreset(smoothing_s=0.50, hysteresis=0.30, dwell_s=0.70, away_dwell_s=1.2),
}
DEFAULT_STABILITY = "balanced"


class GazeStabilizer:
    """Stateful per-frame filter: feed it every measurement in time order."""

    def __init__(self, preset: str = DEFAULT_STABILITY, thresholds: GazeThresholds | None = None):
        if preset not in PRESETS:
            raise ValueError(f"Unknown stability preset: {preset}")
        self.preset_name = preset
        self._p = PRESETS[preset]
        self._t = thresholds or GazeThresholds()
        self._zone: str | None = None
        self._smoothed: float | None = None
        self._last_ts: float | None = None
        self._candidate: tuple[str, float] | None = None  # (zone, time it was first wanted)

    @property
    def zone(self) -> str | None:
        return self._zone

    def update(self, ts: float, measurement: GazeMeasurement | None) -> tuple[str, float]:
        """Consume one frame (``ts`` in seconds, non-decreasing); return ``(zone, confidence)``."""
        p = self._p
        if is_away(measurement, self._t):
            target = ZONE_AWAY
        else:
            assert measurement is not None
            dev = deviation(measurement, self._t)
            if self._smoothed is None or self._last_ts is None:
                self._smoothed = dev
            else:
                dt = max(ts - self._last_ts, 0.0)
                alpha = 1.0 - math.exp(-dt / p.smoothing_s)
                self._smoothed += alpha * (dev - self._smoothed)
            if self._zone == ZONE_CAMERA:
                target = ZONE_SCREEN if self._smoothed > 1.0 + p.hysteresis else ZONE_CAMERA
            elif self._zone == ZONE_SCREEN:
                target = ZONE_CAMERA if self._smoothed < 1.0 - p.hysteresis else ZONE_SCREEN
            else:  # first frame, or coming back from away: no zone to be sticky about
                target = ZONE_CAMERA if self._smoothed <= 1.0 else ZONE_SCREEN
        self._last_ts = ts

        self._commit(ts, target)

        if self._zone == ZONE_AWAY:
            self._smoothed = None  # forget stale pose; smoothing restarts when the face returns
        dev_for_conf = self._smoothed if self._smoothed is not None else 1.0
        assert self._zone is not None
        return self._zone, zone_confidence(self._zone, dev_for_conf)

    def _commit(self, ts: float, target: str) -> None:
        if self._zone is None:
            self._zone = target
            return
        if target == self._zone:
            self._candidate = None
            return
        if self._candidate is None or self._candidate[0] != target:
            self._candidate = (target, ts)
        needed = self._p.away_dwell_s if target == ZONE_AWAY else self._p.dwell_s
        if ts - self._candidate[1] >= needed:
            self._zone = target
            self._candidate = None

"""MediaPipe FaceLandmarker based gaze estimator.

Uses the MediaPipe Tasks ``FaceLandmarker`` (478 landmarks including the irises) in VIDEO
running mode, which tracks between frames instead of re-detecting every frame.
Frames are processed in memory only; they are never stored or transmitted.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

from .classifier import GazeMeasurement, GazeThresholds
from .stabilizer import DEFAULT_STABILITY, GazeStabilizer

# (image-left corner, image-right corner, iris centre) per eye. 468 is the iris of the
# subject's right eye (image left); 473 is the subject's left eye (image right).
_EYES = ((33, 133, 468), (362, 263, 473))

# 6-point PnP model: nose tip, chin, right eye outer, left eye outer, right mouth, left mouth.
# Camera-style axes (x right, y down, z away from the camera), nose tip at the origin, so the
# identity rotation is a frontal face. Units are arbitrary but consistent (generic head model).
_POSE_LANDMARKS = (1, 152, 33, 263, 61, 291)
_POSE_MODEL_POINTS = np.array(
    [
        [0.0, 0.0, 0.0],
        [0.0, 330.0, 65.0],
        [-225.0, -170.0, 135.0],
        [225.0, -170.0, 135.0],
        [-150.0, 150.0, 125.0],
        [150.0, 150.0, 125.0],
    ],
    dtype=np.float64,
)

_MIN_LANDMARKS = 478


def compute_gaze_ratios(points: np.ndarray) -> tuple[float, float] | None:
    """Return mean ``(h_ratio, v_ratio)`` of both irises from pixel-space landmarks.

    ``h`` is the iris position along the eye-corner axis (0 = image-left corner, 1 = image-right
    corner). ``v`` is the iris offset from the corner midpoint perpendicular to that axis,
    normalised by eye width (positive = below). Both are invariant to head roll and scale.
    """
    h_values: list[float] = []
    v_values: list[float] = []
    for left_idx, right_idx, iris_idx in _EYES:
        left, right, iris = points[left_idx], points[right_idx], points[iris_idx]
        axis = right - left
        width = float(np.linalg.norm(axis))
        if width < 1e-6:
            return None
        unit = axis / width
        perp = np.array([-unit[1], unit[0]])  # points "down" for an upright face
        midpoint = (left + right) / 2.0
        h_values.append(float(np.dot(iris - left, unit)) / width)
        v_values.append(float(np.dot(iris - midpoint, perp)) / width)
    return float(np.mean(h_values)), float(np.mean(v_values))


def estimate_head_pose(
    points: np.ndarray, frame_width: int, frame_height: int
) -> tuple[float, float] | None:
    """Return ``(yaw, pitch)`` in degrees via 6-point PnP, or ``None`` if the solve fails."""
    image_points = np.ascontiguousarray(points[list(_POSE_LANDMARKS)], dtype=np.float64)
    focal = float(frame_width)  # common approximation when the camera is uncalibrated
    camera_matrix = np.array(
        [[focal, 0.0, frame_width / 2.0], [0.0, focal, frame_height / 2.0], [0.0, 0.0, 1.0]]
    )
    # Seed the iterative solver with a frontal pose at a depth implied by the pixel eye distance.
    # Without a guess, solvePnP can converge on a mirrored solution behind the camera (tz < 0).
    eye_distance_px = float(np.linalg.norm(image_points[2] - image_points[3]))
    if eye_distance_px < 1e-6:
        return None
    eye_distance_model = float(np.linalg.norm(_POSE_MODEL_POINTS[2] - _POSE_MODEL_POINTS[3]))
    initial_tvec = np.array([[0.0], [0.0], [focal * eye_distance_model / eye_distance_px]])
    ok, rvec, tvec = cv2.solvePnP(
        _POSE_MODEL_POINTS,
        image_points,
        camera_matrix,
        np.zeros(4),
        np.zeros((3, 1)),
        initial_tvec,
        True,
        cv2.SOLVEPNP_ITERATIVE,
    )
    if not ok or float(tvec[2, 0]) <= 0.0:
        return None
    rotation, _ = cv2.Rodrigues(rvec)
    pitch, yaw, _roll = cv2.RQDecomp3x3(rotation)[0]
    return float(yaw), float(pitch)


def measure(points: np.ndarray, frame_width: int, frame_height: int) -> GazeMeasurement | None:
    """Combine gaze ratios and head pose for one face; ``None`` if either cannot be computed."""
    ratios = compute_gaze_ratios(points)
    pose = estimate_head_pose(points, frame_width, frame_height)
    if ratios is None or pose is None:
        return None
    return GazeMeasurement(h_ratio=ratios[0], v_ratio=ratios[1], yaw=pose[0], pitch=pose[1])


class GazeEstimator:
    """Wraps a ``FaceLandmarker`` and turns BGR frames into ``(zone, confidence)``."""

    def __init__(
        self,
        model_path: Path,
        min_confidence: float = 0.5,
        thresholds: GazeThresholds | None = None,
        stability: str = DEFAULT_STABILITY,
    ) -> None:
        self._thresholds = thresholds or GazeThresholds()
        self._stabilizer = GazeStabilizer(stability, self._thresholds)
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=min_confidence,
            min_face_presence_confidence=min_confidence,
            min_tracking_confidence=min_confidence,
        )
        self._landmarker = vision.FaceLandmarker.create_from_options(options)

    @property
    def thresholds(self) -> GazeThresholds:
        return self._thresholds

    def set_stability(self, preset: str) -> None:
        """Switch the smoothing preset (``responsive`` / ``balanced`` / ``steady``)."""
        self._stabilizer = GazeStabilizer(preset, self._thresholds)

    def set_thresholds(self, thresholds: GazeThresholds) -> None:
        """Use new (e.g. calibrated) zone thresholds; smoothing restarts from scratch."""
        self._thresholds = thresholds
        self._stabilizer = GazeStabilizer(self._stabilizer.preset_name, thresholds)

    def analyze(self, frame_bgr: np.ndarray, timestamp_ms: int) -> GazeMeasurement | None:
        """Raw per-frame measurements, or ``None`` when no face is found.

        ``timestamp_ms`` must be strictly increasing between calls.
        """
        height, width = frame_bgr.shape[:2]
        rgb = np.ascontiguousarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect_for_video(image, timestamp_ms)
        if result.face_landmarks and len(result.face_landmarks[0]) >= _MIN_LANDMARKS:
            landmarks = result.face_landmarks[0]
            points = np.array([(lm.x * width, lm.y * height) for lm in landmarks], dtype=np.float64)
            return measure(points, width, height)
        return None

    def stabilize(
        self, timestamp_ms: int, measurement: GazeMeasurement | None
    ) -> tuple[str, float]:
        """Turn one measurement into a smoothed ``(zone, confidence)``."""
        return self._stabilizer.update(timestamp_ms / 1000.0, measurement)

    def process(self, frame_bgr: np.ndarray, timestamp_ms: int) -> tuple[str, float]:
        """Classify one frame into a stabilised ``(zone, confidence)``."""
        return self.stabilize(timestamp_ms, self.analyze(frame_bgr, timestamp_ms))

    def close(self) -> None:
        self._landmarker.close()

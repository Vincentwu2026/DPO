import cv2
import numpy as np
import pytest

from gaze.estimator import (
    _EYES,
    _POSE_LANDMARKS,
    _POSE_MODEL_POINTS,
    compute_gaze_ratios,
    estimate_head_pose,
    measure,
)

WIDTH, HEIGHT = 640, 480


def make_landmarks(iris_h=0.5, iris_v=0.0, roll_deg=0.0, eye_width=60.0) -> np.ndarray:
    """Synthetic 478-point landmark array with both eyes at known corner/iris positions."""
    points = np.zeros((478, 2))
    angle = np.deg2rad(roll_deg)
    unit = np.array([np.cos(angle), np.sin(angle)])
    perp = np.array([-unit[1], unit[0]])
    for centre, (left_idx, right_idx, iris_idx) in zip(
        (np.array([220.0, 240.0]), np.array([420.0, 240.0])), _EYES, strict=True
    ):
        left = centre - unit * eye_width / 2
        right = centre + unit * eye_width / 2
        points[left_idx] = left
        points[right_idx] = right
        points[iris_idx] = left + unit * iris_h * eye_width + perp * iris_v * eye_width
    return points


def project_pose(yaw_deg: float, pitch_deg: float) -> np.ndarray:
    """Landmark array whose pose landmarks are the head model rotated by yaw/pitch."""
    yaw, pitch = np.deg2rad(yaw_deg), np.deg2rad(pitch_deg)
    ry = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
    rx = np.array(
        [[1, 0, 0], [0, np.cos(pitch), -np.sin(pitch)], [0, np.sin(pitch), np.cos(pitch)]]
    )
    rvec, _ = cv2.Rodrigues(ry @ rx)
    tvec = np.array([0.0, 0.0, 1500.0])
    camera = np.array([[WIDTH, 0, WIDTH / 2], [0, WIDTH, HEIGHT / 2], [0, 0, 1.0]])
    projected, _ = cv2.projectPoints(_POSE_MODEL_POINTS, rvec, tvec, camera, np.zeros(4))
    points = np.zeros((478, 2))
    points[list(_POSE_LANDMARKS)] = projected.reshape(-1, 2)
    return points


def test_centered_iris_gives_half_horizontal_and_zero_vertical():
    h, v = compute_gaze_ratios(make_landmarks())
    assert h == pytest.approx(0.5)
    assert v == pytest.approx(0.0)


def test_iris_offsets_are_reported():
    h, v = compute_gaze_ratios(make_landmarks(iris_h=0.7, iris_v=0.1))
    assert h == pytest.approx(0.7)
    assert v == pytest.approx(0.1)


def test_ratios_are_invariant_to_head_roll_and_scale():
    base = compute_gaze_ratios(make_landmarks(iris_h=0.6, iris_v=0.05))
    rolled = compute_gaze_ratios(make_landmarks(iris_h=0.6, iris_v=0.05, roll_deg=25))
    scaled = compute_gaze_ratios(make_landmarks(iris_h=0.6, iris_v=0.05, eye_width=120))
    assert rolled == pytest.approx(base)
    assert scaled == pytest.approx(base)


def test_degenerate_eye_returns_none():
    assert compute_gaze_ratios(np.zeros((478, 2))) is None


@pytest.mark.parametrize("yaw,pitch", [(0, 0), (20, 0), (-30, 0), (0, 15), (0, -20), (25, -10)])
def test_head_pose_recovers_known_rotation(yaw, pitch):
    pose = estimate_head_pose(project_pose(yaw, pitch), WIDTH, HEIGHT)
    assert pose is not None
    assert pose[0] == pytest.approx(yaw, abs=1.0)
    assert pose[1] == pytest.approx(pitch, abs=1.0)


def test_measure_combines_ratios_and_pose():
    points = make_landmarks(iris_h=0.55, iris_v=0.02)
    points[list(_POSE_LANDMARKS)] = project_pose(10, 5)[list(_POSE_LANDMARKS)]
    # The pose landmarks 33 and 263 coincide with eye corners; keep the eye geometry consistent.
    result = measure(points, WIDTH, HEIGHT)
    assert result is not None
    assert result.yaw == pytest.approx(10, abs=2.0)
    assert result.pitch == pytest.approx(5, abs=2.0)

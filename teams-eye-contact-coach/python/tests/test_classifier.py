from gaze.classifier import (
    ZONE_AWAY,
    ZONE_CAMERA,
    ZONE_SCREEN,
    GazeMeasurement,
    GazeThresholds,
    classify,
)


def m(h=0.5, v=0.0, yaw=0.0, pitch=0.0) -> GazeMeasurement:
    return GazeMeasurement(h_ratio=h, v_ratio=v, yaw=yaw, pitch=pitch)


def test_no_face_is_away():
    assert classify(None) == (ZONE_AWAY, 1.0)


def test_centered_frontal_is_camera_with_full_confidence():
    assert classify(m()) == (ZONE_CAMERA, 1.0)


def test_small_deviation_is_still_camera_with_lower_confidence():
    zone, confidence = classify(m(h=0.54))
    assert zone == ZONE_CAMERA
    assert 0.5 < confidence < 1.0


def test_iris_looking_down_is_screen():
    assert classify(m(v=0.15))[0] == ZONE_SCREEN


def test_iris_looking_sideways_is_screen():
    assert classify(m(h=0.7))[0] == ZONE_SCREEN
    assert classify(m(h=0.3))[0] == ZONE_SCREEN


def test_moderate_head_turn_is_screen():
    assert classify(m(yaw=25.0))[0] == ZONE_SCREEN
    assert classify(m(pitch=-25.0))[0] == ZONE_SCREEN


def test_extreme_head_rotation_is_away():
    assert classify(m(yaw=60.0)) == (ZONE_AWAY, 1.0)
    assert classify(m(pitch=-50.0)) == (ZONE_AWAY, 1.0)


def test_camera_boundary_is_inclusive():
    t = GazeThresholds()
    assert classify(m(h=t.h_center + t.h_tolerance), t)[0] == ZONE_CAMERA


def test_screen_confidence_grows_with_distance_and_is_capped():
    near = classify(m(v=0.06))[1]
    far = classify(m(v=0.5))[1]
    assert 0.5 <= near < far <= 1.0


def test_custom_thresholds_are_respected():
    loose = GazeThresholds(h_tolerance=0.3)
    assert classify(m(h=0.7))[0] == ZONE_SCREEN
    assert classify(m(h=0.7), loose)[0] == ZONE_CAMERA

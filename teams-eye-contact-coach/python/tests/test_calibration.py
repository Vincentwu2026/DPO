import dataclasses

import numpy as np
import pytest

from gaze.calibration import (
    MIN_SAMPLES,
    CalibrationSession,
    fit_thresholds,
    parse_thresholds,
    thresholds_to_dict,
)
from gaze.classifier import (
    ZONE_AWAY,
    ZONE_CAMERA,
    ZONE_SCREEN,
    GazeMeasurement,
    GazeThresholds,
    classify,
)

RNG = np.random.default_rng(7)


def samples(h, v, yaw, pitch, n=60, noise=(0.012, 0.008, 1.2, 1.2)) -> list[GazeMeasurement]:
    return [
        GazeMeasurement(
            h_ratio=h + RNG.normal(0, noise[0]),
            v_ratio=v + RNG.normal(0, noise[1]),
            yaw=yaw + RNG.normal(0, noise[2]),
            pitch=pitch + RNG.normal(0, noise[3]),
        )
        for _ in range(n)
    ]


def test_default_thresholds_are_unchanged_by_the_new_centres():
    t = GazeThresholds()
    assert (t.yaw_center, t.pitch_center) == (0.0, 0.0)
    assert classify(GazeMeasurement(0.5, 0.0, 0.0, 0.0), t)[0] == ZONE_CAMERA
    assert classify(GazeMeasurement(0.5, 0.0, 41.0, 0.0), t)[0] == ZONE_AWAY


def test_head_angles_are_measured_from_the_calibrated_centre():
    biased = GazeThresholds(yaw_center=12.0, pitch_center=-8.0)
    assert classify(GazeMeasurement(0.5, 0.0, 12.0, -8.0), biased)[0] == ZONE_CAMERA
    # The same pose is a camera look with the right centre, but not with the defaults.
    assert classify(GazeMeasurement(0.5, 0.0, 12.0, -8.0), GazeThresholds())[0] == ZONE_CAMERA
    assert classify(GazeMeasurement(0.5, 0.0, 30.0, -8.0), GazeThresholds())[0] == ZONE_SCREEN
    assert classify(GazeMeasurement(0.5, 0.0, 30.0, -8.0), biased)[0] == ZONE_SCREEN
    assert classify(GazeMeasurement(0.5, 0.0, 12.0 + 41.0, -8.0), biased)[0] == ZONE_AWAY


def test_fit_recovers_a_biased_user_that_the_defaults_misclassify():
    # Pose bias of +22 yaw / -18 pitch and an off-centre iris: the defaults call the lens look
    # "screen" (22 > 15 and 18 > 15 degrees from their assumed frontal pose).
    camera = samples(0.56, 0.035, 22.0, -18.0)
    screen = samples(0.56, 0.11, 22.0, -8.0)
    assert np.mean([classify(m)[0] == ZONE_CAMERA for m in camera]) < 0.2

    result = fit_thresholds(camera, screen)
    assert result is not None
    t = result.thresholds
    assert t.h_center == pytest.approx(0.56, abs=0.01)
    assert t.v_center == pytest.approx(0.035, abs=0.01)
    assert t.yaw_center == pytest.approx(22.0, abs=1.0)
    assert t.pitch_center == pytest.approx(-18.0, abs=1.0)
    assert result.camera_hit >= 0.9
    assert result.screen_hit >= 0.9
    assert result.good


def test_fit_keeps_the_camera_boundary_inside_the_screen_gaze():
    camera = samples(0.5, 0.0, 0.0, 0.0)
    screen = samples(0.5, 0.06, 0.0, 6.0)  # screen is only slightly below the lens
    result = fit_thresholds(camera, screen)
    assert result is not None
    assert result.thresholds.v_tolerance < 0.06
    assert result.thresholds.camera_max_pitch < 6.0 * 1.0 + 4.0
    assert result.screen_hit > 0.7


def test_fit_flags_a_poor_result_when_lens_and_screen_look_the_same():
    same = samples(0.5, 0.0, 0.0, 0.0)
    result = fit_thresholds(same, samples(0.5, 0.0, 0.0, 0.0))
    assert result is not None
    assert not result.good


def test_fit_needs_enough_frames_in_both_phases():
    enough = samples(0.5, 0.0, 0.0, 0.0, n=MIN_SAMPLES)
    assert fit_thresholds(enough[:-1], enough) is None
    assert fit_thresholds(enough, enough[:-1]) is None
    assert fit_thresholds(enough, enough) is not None


def test_fitted_thresholds_always_pass_validation():
    result = fit_thresholds(samples(0.5, 0.0, 0.0, 0.0), samples(0.6, 0.12, 20.0, 10.0))
    assert result is not None
    assert parse_thresholds(thresholds_to_dict(result.thresholds)) == result.thresholds


def test_session_collects_only_the_active_phase_and_ignores_missing_faces():
    session = CalibrationSession()
    m = GazeMeasurement(0.5, 0.0, 0.0, 0.0)
    session.add(m)  # no phase yet
    session.set_phase("camera")
    session.add(m)
    session.add(None)
    session.add(m)
    session.set_phase(None)
    session.add(m)
    session.set_phase("screen")
    session.add(m)
    assert (session.count("camera"), session.count("screen")) == (2, 1)
    session.set_phase("camera")  # redoing a step starts it afresh
    assert session.count("camera") == 0
    with pytest.raises(ValueError):
        session.set_phase("sideways")


def valid() -> dict:
    return thresholds_to_dict(GazeThresholds())


def test_parse_thresholds_accepts_the_defaults():
    assert parse_thresholds(valid()) == GazeThresholds()


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.pop("h_center"),
        lambda d: d.update(extra=1.0),
        lambda d: d.update(h_center="0.5"),
        lambda d: d.update(h_center=True),
        lambda d: d.update(h_center=float("nan")),
        lambda d: d.update(h_center=float("inf")),
        lambda d: d.update(h_tolerance=0.0),
        lambda d: d.update(camera_max_yaw=100.0),
        lambda d: d.update(yaw_center=90.0),
        lambda d: d.update(camera_max_yaw=40.0, away_yaw=42.0),
        lambda d: d.update(camera_max_pitch=30.0, away_pitch=33.0),
    ],
)
def test_parse_thresholds_rejects_bad_values(mutate):
    data = valid()
    mutate(data)
    assert parse_thresholds(data) is None


@pytest.mark.parametrize("data", [None, [], "x", 3, {}])
def test_parse_thresholds_rejects_non_dicts(data):
    assert parse_thresholds(data) is None


def test_every_threshold_field_is_covered_by_validation():
    assert {f.name for f in dataclasses.fields(GazeThresholds)} == set(valid())

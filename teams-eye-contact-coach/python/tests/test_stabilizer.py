import pytest

from gaze.classifier import ZONE_AWAY, ZONE_CAMERA, ZONE_SCREEN, GazeMeasurement, GazeThresholds
from gaze.stabilizer import DEFAULT_STABILITY, PRESETS, GazeStabilizer

T = GazeThresholds()
FPS = 30.0


def at_deviation(dev: float) -> GazeMeasurement:
    """A frontal head whose horizontal iris offset is exactly ``dev`` tolerance units."""
    return GazeMeasurement(
        h_ratio=T.h_center + dev * T.h_tolerance, v_ratio=0.0, yaw=0.0, pitch=0.0
    )


def run(stab: GazeStabilizer, devs, start: float = 0.0):
    """Feed deviations (None = no face) at 30 fps; return the committed zone after each frame."""
    zones = []
    for i, dev in enumerate(devs):
        m = None if dev is None else at_deviation(dev)
        zones.append(stab.update(start + i / FPS, m)[0])
    return zones


def flips(zones) -> int:
    return sum(1 for a, b in zip(zones, zones[1:], strict=False) if a != b)


def test_unknown_preset_is_rejected():
    with pytest.raises(ValueError):
        GazeStabilizer("nope")


def test_default_preset_exists():
    assert DEFAULT_STABILITY in PRESETS


def test_first_frame_is_committed_immediately():
    assert run(GazeStabilizer(), [0.2])[0] == ZONE_CAMERA
    assert run(GazeStabilizer(), [2.0])[0] == ZONE_SCREEN
    assert run(GazeStabilizer(), [None])[0] == ZONE_AWAY


@pytest.mark.parametrize("preset", sorted(PRESETS))
def test_jitter_around_the_boundary_does_not_flip(preset):
    # Alternating 0.8 / 1.2 every frame: the raw classifier flips on every single frame.
    devs = [0.8 if i % 2 == 0 else 1.2 for i in range(90)]
    zones = run(GazeStabilizer(preset), devs)
    assert flips(zones) == 0


def test_raw_classification_of_the_same_jitter_does_flip():
    from gaze.classifier import classify

    zones = [classify(at_deviation(0.8 if i % 2 == 0 else 1.2), T)[0] for i in range(90)]
    assert flips(zones) == 89


def test_sustained_look_away_switches_to_screen_then_back():
    stab = GazeStabilizer("balanced")
    zones = run(stab, [0.3] * 30 + [2.0] * 60 + [0.3] * 60)
    assert zones[29] == ZONE_CAMERA
    assert zones[89] == ZONE_SCREEN
    assert zones[-1] == ZONE_CAMERA
    assert flips(zones) == 2


def test_switch_happens_within_a_second_of_a_real_look_away():
    stab = GazeStabilizer("balanced")
    zones = run(stab, [0.3] * 30 + [2.0] * 60)
    first_screen = zones.index(ZONE_SCREEN)
    assert (first_screen - 30) / FPS < 1.0


def test_steady_is_slower_than_responsive():
    devs = [0.3] * 30 + [2.0] * 90

    def delay(preset: str) -> int:
        return run(GazeStabilizer(preset), devs).index(ZONE_SCREEN) - 30

    assert delay("responsive") < delay("balanced") < delay("steady")


def test_a_blink_sized_dropout_does_not_leave_camera():
    stab = GazeStabilizer("balanced")
    zones = run(stab, [0.3] * 30 + [None] * 6 + [0.3] * 30)  # 0.2 s without a face
    assert set(zones) == {ZONE_CAMERA}


def test_a_long_dropout_becomes_away_and_recovers():
    stab = GazeStabilizer("balanced")
    zones = run(stab, [0.3] * 30 + [None] * 60 + [0.3] * 60)
    assert zones[89] == ZONE_AWAY
    assert zones[-1] == ZONE_CAMERA


def test_head_turned_beyond_away_limit_is_away():
    stab = GazeStabilizer("balanced")
    turned = GazeMeasurement(h_ratio=0.5, v_ratio=0.0, yaw=60.0, pitch=0.0)
    zones = [stab.update(i / FPS, turned)[0] for i in range(60)]
    assert zones[-1] == ZONE_AWAY


def test_dead_band_keeps_zone_until_clearly_crossed():
    stab = GazeStabilizer("balanced")  # hysteresis 0.20
    # 1.1 is over the raw boundary but inside the dead band: stays camera.
    assert set(run(stab, [0.3] * 15 + [1.1] * 90)) == {ZONE_CAMERA}
    # 1.4 is clearly beyond it.
    assert run(GazeStabilizer("balanced"), [0.3] * 15 + [1.4] * 90)[-1] == ZONE_SCREEN


def test_confidence_is_in_range():
    stab = GazeStabilizer()
    for i, dev in enumerate([0.1, 0.9, 1.5, 3.0, None, None]):
        m = None if dev is None else at_deviation(dev)
        _, confidence = stab.update(i / FPS, m)
        assert 0.5 <= confidence <= 1.0


def test_irregular_frame_spacing_is_handled():
    stab = GazeStabilizer("balanced")
    zones = []
    t = 0.0
    for dev in [0.3] * 10 + [2.0] * 10:
        t += 0.2  # a slow, 5 fps camera
        zones.append(stab.update(t, at_deviation(dev))[0])
    assert zones[-1] == ZONE_SCREEN


def test_duplicate_timestamps_do_not_crash():
    stab = GazeStabilizer()
    for _ in range(5):
        stab.update(1.0, at_deviation(0.5))
    assert stab.zone == ZONE_CAMERA

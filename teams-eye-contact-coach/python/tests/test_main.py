import json

import pytest

from gaze.calibration import CalibrationSession, thresholds_to_dict
from gaze.camera import parse_macos_camera_names
from gaze.classifier import GazeMeasurement, GazeThresholds
from main import build_parser, calibration_message, calibration_result_message, parse_command


def test_parse_macos_camera_names():
    payload = json.dumps(
        {"SPCameraDataType": [{"_name": "MacBook Pro Camera"}, {"_name": "Logitech C920"}, {}]}
    )
    assert parse_macos_camera_names(payload) == ["MacBook Pro Camera", "Logitech C920"]


@pytest.mark.parametrize("payload", ["", "not json", "[]", '{"other": 1}'])
def test_parse_macos_camera_names_handles_bad_input(payload):
    assert parse_macos_camera_names(payload) == []


def test_parse_command_accepts_valid_commands():
    assert parse_command('{"cmd": "set_camera", "index": 2}') == {"cmd": "set_camera", "index": 2}
    assert parse_command('{"cmd": "set_stability", "preset": "steady"}') == {
        "cmd": "set_stability",
        "preset": "steady",
    }
    assert parse_command('{"cmd": "set_confidence_threshold", "value": 1}') == {
        "cmd": "set_confidence_threshold",
        "value": 1.0,
    }


@pytest.mark.parametrize(
    "line",
    [
        "",
        "garbage",
        "[1]",
        '{"cmd": "set_camera"}',
        '{"cmd": "set_camera", "index": -1}',
        '{"cmd": "set_camera", "index": 10}',
        '{"cmd": "set_camera", "index": true}',
        '{"cmd": "set_camera", "index": "1"}',
        '{"cmd": "set_confidence_threshold", "value": 1.5}',
        '{"cmd": "set_stability"}',
        '{"cmd": "set_stability", "preset": "extreme"}',
        '{"cmd": "set_stability", "preset": 3}',
        '{"cmd": "unknown"}',
    ],
)
def test_parse_command_rejects_invalid_input(line):
    assert parse_command(line) is None


def test_cli_defaults_and_overrides():
    args = build_parser().parse_args([])
    assert (args.camera_index, args.confidence_threshold) == (0, 0.5)
    args = build_parser().parse_args(["--camera-index", "3", "--confidence-threshold", "0.7"])
    assert (args.camera_index, args.confidence_threshold) == (3, 0.7)
    assert build_parser().parse_args([]).stability == "balanced"
    assert build_parser().parse_args(["--stability", "steady"]).stability == "steady"


@pytest.mark.parametrize(
    "flag,value",
    [("--camera-index", "10"), ("--confidence-threshold", "2"), ("--stability", "extreme")],
)
def test_cli_rejects_out_of_range(flag, value):
    with pytest.raises(SystemExit):
        build_parser().parse_args([flag, value])


def test_list_devices_flag():
    assert build_parser().parse_args([]).list_devices is False
    assert build_parser().parse_args(["--list-devices"]).list_devices is True


def test_parse_command_calibration_commands():
    for cmd in ("calibration_start", "calibration_stop", "calibration_fit"):
        assert parse_command(json.dumps({"cmd": cmd})) == {"cmd": cmd}
    for phase in ("camera", "screen", None):
        line = json.dumps({"cmd": "calibration_phase", "phase": phase})
        assert parse_command(line) == {"cmd": "calibration_phase", "phase": phase}
    assert parse_command('{"cmd": "calibration_phase", "phase": "up"}') is None
    assert parse_command('{"cmd": "calibration_phase"}') == {
        "cmd": "calibration_phase",
        "phase": None,
    }


def test_parse_command_set_thresholds():
    line = json.dumps({"cmd": "set_thresholds", "thresholds": thresholds_to_dict(GazeThresholds())})
    assert parse_command(line) == {"cmd": "set_thresholds", "thresholds": GazeThresholds()}
    assert parse_command('{"cmd": "set_thresholds", "thresholds": null}') == {
        "cmd": "set_thresholds",
        "thresholds": None,
    }
    assert parse_command('{"cmd": "set_thresholds"}') is None
    assert parse_command('{"cmd": "set_thresholds", "thresholds": {"h_center": 0.5}}') is None
    assert parse_command('{"cmd": "set_thresholds", "thresholds": 5}') is None


def test_calibration_message_shape_with_and_without_a_face():
    session = CalibrationSession()
    session.set_phase("camera")
    m = GazeMeasurement(0.51234, 0.0149, 2.04, -1.06)
    session.add(m)
    msg = calibration_message(m, "camera", session, "abc")
    assert msg == {
        "type": "calibration",
        "face": True,
        "h": 0.512,
        "v": 0.015,
        "yaw": 2.0,
        "pitch": -1.1,
        "zone": "camera",
        "phase": "camera",
        "camera_samples": 1,
        "screen_samples": 0,
        "preview": "abc",
    }
    none = calibration_message(None, "away", session, None)
    assert none["face"] is False
    assert none["h"] is none["yaw"] is None
    json.dumps(msg)
    json.dumps(none)


def test_calibration_result_message_reports_not_enough_data():
    assert calibration_result_message(CalibrationSession()) == {
        "type": "calibration_result",
        "ok": False,
    }

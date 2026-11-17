import json

import pytest

from gaze.camera import parse_macos_camera_names
from main import build_parser, parse_command


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


@pytest.mark.parametrize("flag,value", [("--camera-index", "10"), ("--confidence-threshold", "2")])
def test_cli_rejects_out_of_range(flag, value):
    with pytest.raises(SystemExit):
        build_parser().parse_args([flag, value])


def test_list_devices_flag():
    assert build_parser().parse_args([]).list_devices is False
    assert build_parser().parse_args(["--list-devices"]).list_devices is True

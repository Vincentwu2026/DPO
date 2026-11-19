"""Small mirrored JPEG previews for the calibration window.

Only produced while the user has the calibration window open and asked for it. The preview goes
to the local Electron app over the child-process pipe; it is never written to disk or sent over the
network.
"""

from __future__ import annotations

import base64

import cv2
import numpy as np

PREVIEW_WIDTH = 320
PREVIEW_JPEG_QUALITY = 60


def encode_preview(frame_bgr: np.ndarray) -> str | None:
    """Mirrored (selfie view) JPEG of ``frame_bgr`` as a base64 string; ``None`` on failure."""
    height, width = frame_bgr.shape[:2]
    if width == 0 or height == 0:
        return None
    scale = PREVIEW_WIDTH / width
    small = cv2.resize(
        frame_bgr, (PREVIEW_WIDTH, max(1, round(height * scale))), interpolation=cv2.INTER_AREA
    )
    ok, buffer = cv2.imencode(
        ".jpg", cv2.flip(small, 1), [int(cv2.IMWRITE_JPEG_QUALITY), PREVIEW_JPEG_QUALITY]
    )
    return base64.b64encode(buffer.tobytes()).decode("ascii") if ok else None

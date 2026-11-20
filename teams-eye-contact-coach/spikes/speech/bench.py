"""SC-0 spike: benchmark faster-whisper on the synthetic clips.

Measures, per model and per clip: transcription time vs audio length (real-time factor),
word error rate, how many filler words were kept, and whether pauses were visible.
Spike code only; it is not part of the shipped app.
"""

from __future__ import annotations

import json
import re
import sys
import time
import wave
from pathlib import Path

import numpy as np
import psutil
from faster_whisper import WhisperModel

HERE = Path(__file__).parent
REFERENCE = json.loads((HERE / "audio" / "reference.json").read_text())
FILLERS = {"um", "uh", "hmm", "erm"}
FILLER_PHRASES = ("you know", "basically", "i guess", "kind of")


def words(text: str) -> list[str]:
    return re.findall(r"[a-z']+", text.lower())


def wer(ref: list[str], hyp: list[str]) -> float:
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
            prev, d[j] = d[j], cur
    return d[len(hyp)] / max(1, len(ref))


def duration(path: Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def load_audio(path: Path) -> np.ndarray:
    """16 kHz mono int16 WAV to float32, the same shape the live mic path will produce."""
    with wave.open(str(path)) as w:
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def count_fillers(tokens: list[str]) -> int:
    text = " ".join(tokens)
    return sum(t in FILLERS for t in tokens) + sum(text.count(p) for p in FILLER_PHRASES)


def run(model_name: str, prompt: str | None) -> list[dict]:
    t0 = time.perf_counter()
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    load_s = time.perf_counter() - t0
    rss = psutil.Process().memory_info().rss / 1e6
    rows = []
    for clip, ref_text in REFERENCE.items():
        path = HERE / "audio" / f"{clip}.wav"
        audio_s = duration(path)
        t0 = time.perf_counter()
        segments, _ = model.transcribe(
            load_audio(path),
            language="en",
            vad_filter=True,
            word_timestamps=True,
            initial_prompt=prompt,
            condition_on_previous_text=False,
        )
        segs = list(segments)
        took = time.perf_counter() - t0
        hyp = words(" ".join(s.text for s in segs))
        ref = words(re.sub(r"\[\[.*?\]\]", "", ref_text))
        word_list = [w for s in segs for w in (s.words or [])]
        gaps = [b.start - a.end for a, b in zip(word_list, word_list[1:], strict=False)]
        rows.append(
            {
                "model": model_name,
                "prompt": bool(prompt),
                "clip": clip,
                "audio_s": round(audio_s, 1),
                "took_s": round(took, 2),
                "rtf": round(took / audio_s, 3),
                "wer": round(wer(ref, hyp), 3),
                "fillers_ref": count_fillers(ref),
                "fillers_kept": count_fillers(hyp),
                "pauses_over_2s": int(sum(g > 2.0 for g in gaps)),
                "load_s": round(load_s, 1),
                "rss_mb": round(rss),
            }
        )
    return rows


if __name__ == "__main__":
    out = []
    prompt = "Um, uh, so, like, you know, I think, basically, I guess, sorry."
    for name in sys.argv[1:] or ["base.en"]:
        out += run(name, None)
        out += run(name, prompt)
    for r in out:
        print(json.dumps(r))

"""Record yourself for 40 s and report what the engine hears. Nothing is saved to disk.

Talk naturally about anything (a pitch, your weekend) and let real "um"/"uh" happen.
Then compare "fillers you counted" with "fillers heard".
Run:  .venv/bin/python user_mic_test.py
"""
import re, numpy as np, sounddevice as sd
from faster_whisper import WhisperModel

SR, SECONDS = 16000, 40
FILLERS = ("um", "uh", "erm", "hmm", "you know", "basically", "i guess", "kind of", "like")
model = WhisperModel("base.en", device="cpu", compute_type="int8")
input("Press Enter, then talk naturally for 40 seconds... ")
print("Recording...")
rec = sd.rec(SECONDS * SR, samplerate=SR, channels=1, dtype="float32"); sd.wait()
a = rec[:, 0]
segs, _ = model.transcribe(a, language="en", vad_filter=True, word_timestamps=True)
segs = list(segs)
text = " ".join(s.text.strip() for s in segs).lower()
tokens = re.findall(r"[a-z']+", text)
words = [w for s in segs for w in (s.words or [])]
gaps = [b.start - a_.end for a_, b in zip(words, words[1:])]
print(f"mic level: rms={np.sqrt((a**2).mean()):.4f} peak={np.abs(a).max():.3f}")
print(f"words heard: {len(tokens)}  (~{len(tokens) / (SECONDS / 60):.0f} per minute incl. silence)")
print("fillers heard:", {f: text.count(f) for f in FILLERS if f in text} or "none")
print(f"pauses over 2 s: {sum(g > 2 for g in gaps)}")
print("Count your own fillers and compare. Transcript is not saved.")

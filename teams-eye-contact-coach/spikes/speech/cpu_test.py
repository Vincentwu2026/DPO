"""Run the gaze tracker, then add Whisper load on top, and report CPU for each phase."""
import json, subprocess, sys, time, wave
from pathlib import Path
import numpy as np, psutil
from faster_whisper import WhisperModel

root = Path(__file__).resolve().parents[2]
tracker = subprocess.Popen([str(root / ".venv/bin/python"), "main.py"], cwd=root / "python",
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
events = []
import threading
def reader():
    for line in tracker.stdout:
        try: m = json.loads(line)
        except Exception: continue
        events.append((time.time(), m.get("type"), m.get("message")))
threading.Thread(target=reader, daemon=True).start()
time.sleep(5)  # let the tracker warm up
p = psutil.Process(tracker.pid)

def gaze_count(): return sum(1 for e in events if e[1] == "gaze")
def phase(label, seconds, work=None):
    p.cpu_percent(None); psutil.cpu_percent(None)
    g0 = gaze_count(); t0 = time.time()
    end = t0 + seconds
    while time.time() < end:
        if work: work()
        else: time.sleep(0.2)
    dt = time.time() - t0
    print(f"{label:28} tracker_cpu={p.cpu_percent(None):6.1f}%  system_cpu={psutil.cpu_percent(None):5.1f}%  gaze_events/s={(gaze_count()-g0)/dt:5.1f}")

def load(name):
    with wave.open(str(Path(__file__).parent / "audio" / f"{name}.wav")) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
audio = load("fillers")
errs = [e for e in events if e[1] == "error"]
phase("tracker alone", 6)
for name in ("base.en", "small.en"):
    model = WhisperModel(name, device="cpu", compute_type="int8")
    def work(): list(model.transcribe(audio, language="en", vad_filter=True, word_timestamps=True)[0])
    phase(f"tracker + whisper {name}", 10, work)
print("tracker errors:", [e[2] for e in events if e[1] == "error"][:3], "ready:", any(e[1]=="ready" for e in events))
tracker.terminate()

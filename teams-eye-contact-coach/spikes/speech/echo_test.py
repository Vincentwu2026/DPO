"""Play speech through the speakers while recording the mic: does speaker audio leak into the mic?"""
import subprocess, time
import numpy as np, sounddevice as sd
from faster_whisper import WhisperModel

SR = 16000
model = WhisperModel("base.en", device="cpu", compute_type="int8")
def transcribe(a):
    segs, _ = model.transcribe(a, language="en", vad_filter=True)
    return " ".join(s.text.strip() for s in segs)

print("input device:", sd.query_devices(sd.default.device[0])["name"], "| output:", sd.query_devices(sd.default.device[1])["name"])
for label, volume in (("low (25%)", 25), ("normal (50%)", 50)):
    old = subprocess.run(["osascript","-e","output volume of (get volume settings)"],capture_output=True,text=True).stdout.strip()
    subprocess.run(["osascript","-e",f"set volume output volume {volume}"])
    rec = sd.rec(int(14*SR), samplerate=SR, channels=1, dtype="float32")
    time.sleep(0.5)
    subprocess.run(["afplay","audio/clean.wav"])
    sd.wait()
    subprocess.run(["osascript","-e",f"set volume output volume {old}"])
    a = rec[:,0]
    print(f"[{label}] mic rms={np.sqrt((a**2).mean()):.4f} peak={np.abs(a).max():.3f}")
    print("   transcribed from mic:", transcribe(a)[:160] or "(nothing)")

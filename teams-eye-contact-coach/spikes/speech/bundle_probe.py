import multiprocessing, sys
import numpy as np
multiprocessing.freeze_support()
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[1], device="cpu", compute_type="int8")
segs, _ = m.transcribe(np.zeros(16000, dtype=np.float32), language="en")
print("ok", len(list(segs)))

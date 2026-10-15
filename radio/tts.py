"""Renders a Fryer Radio episode script to mp3 with Kokoro (free, open-source, runs offline).

Usage: python radio/tts.py radio/episodes/wk01-preview.json [models_dir]
"""
import json, os, re, subprocess, sys, tempfile
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

VOICES = {
    "KEV": {"voice": "am_puck", "speed": 1.12, "lang": "en-us", "gain": 1.0},
    "NIGEL": {"voice": "bm_george", "speed": 1.0, "lang": "en-gb", "gain": 0.95},
}
GAP = {"same": 0.18, "switch": 0.32}


def clean(text):
    # Spell out things the voice model reads badly.
    text = text.replace("%", " percent").replace("&", " and ")
    text = re.sub(r"\$(\d+)", r"\1 dollars", text)
    # All-caps words get spelled out letter by letter, so soften them.
    text = re.sub(r"\b([A-Z]{4,})\b", lambda m: m.group(1).capitalize(), text)
    return re.sub(r"\s+", " ", text).strip()


def sting(sr, secs=1.1):
    """A short synthesized 'fryer' sting: rising tone over a crackle. No samples, no licences."""
    t = np.linspace(0, secs, int(sr * secs), False)
    rng = np.random.default_rng(416)
    crackle = (rng.random(t.size) < 0.004) * rng.uniform(-0.5, 0.5, t.size)
    crackle = np.convolve(crackle, np.exp(-np.arange(200) / 30), mode="same")
    freq = 220 * 2 ** (t / secs * 1.5)
    tone = 0.18 * np.sin(2 * np.pi * np.cumsum(freq) / sr) * np.minimum(1, (secs - t) * 4)
    env = np.minimum(1, t * 8)
    return ((tone + 0.25 * crackle) * env).astype(np.float32)


def main():
    path = sys.argv[1]
    models = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("KOKORO_DIR", "radio/models")
    ep = json.load(open(path))
    k = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
    sr = 24000
    parts, prev = [sting(sr), np.zeros(int(sr * 0.25), np.float32)], None
    for line in ep["lines"]:
        v = VOICES.get(line["host"], VOICES["KEV"])
        audio, sr = k.create(clean(line["text"]), voice=v["voice"], speed=v["speed"], lang=v["lang"])
        if prev is not None:
            parts.append(np.zeros(int(sr * GAP["same" if prev == line["host"] else "switch"]), np.float32))
        parts.append((audio * v["gain"]).astype(np.float32))
        prev = line["host"]
    parts += [np.zeros(int(sr * 0.3), np.float32), sting(sr, 0.8)[::-1].copy()]
    full = np.concatenate(parts)
    full = full / max(1e-6, np.abs(full).max()) * 0.89
    out_mp3 = os.path.splitext(path)[0] + ".mp3"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        sf.write(tmp.name, full, sr)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name,
                        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-b:a", "64k", out_mp3], check=True)
        os.unlink(tmp.name)
    ep["seconds"] = round(len(full) / sr)
    json.dump(ep, open(path, "w"), indent=1)
    print(f"{out_mp3}: {ep['seconds']}s")


if __name__ == "__main__":
    main()

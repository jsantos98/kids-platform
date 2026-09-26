"""Record the game's spoken lines with Piper voices (G9).

Every line comes from src/i18n (via tools/voice-lines.ts), is spoken by an
offline Piper voice and saved as a small MP3 in
public/audio/voice/<lang>/<id>.mp3, with public/audio/voice/manifest.json
listing the text each clip says (tools/check-i18n.ts fails on a clip that no
longer matches its dictionary text). Only new or changed lines are recorded.

Voices (https://huggingface.co/rhasspy/piper-voices), downloaded once into
.voices/ (git-ignored, ~63 MB each):
  pt  pt_PT-tugão-medium  (Portuguese, Portugal; dataset CC0, fine-tuned
                           from Piper's US-English "lessac" voice)
  en  en_GB-cori-medium   (British English; LibriVox recordings, public domain)

Needs: Python 3.10+, `pip install piper-tts`, ffmpeg on the PATH, Node (npx).
Run from the repository root:  python tools/make-voice.py  [--all]
"""
import json
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.voices'
OUT = ROOT / 'public' / 'audio' / 'voice'
BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
VOICES = {
    'pt': ('pt/pt_PT/tugão/medium', 'pt_PT-tugão-medium'),
    'en': ('en/en_GB/cori/medium', 'en_GB-cori-medium'),
}
# a touch slower than the voices' own pace: the listeners are four
LENGTH_SCALE = 1.12


def fetch(lang: str) -> Path:
    folder, name = VOICES[lang]
    CACHE.mkdir(exist_ok=True)
    model = CACHE / f'{name}.onnx'
    for suffix in ('.onnx', '.onnx.json'):
        dst = CACHE / f'{name}{suffix}'
        if not dst.exists():
            url = BASE + urllib.parse.quote(f'{folder}/{name}{suffix}')
            print(f'downloading {url}')
            urllib.request.urlretrieve(url, dst)
    return model


def lines() -> dict:
    res = subprocess.run('npx tsx tools/voice-lines.ts', cwd=ROOT, shell=True,
                         capture_output=True, check=True)
    return json.loads(res.stdout.decode('utf-8'))


def main() -> None:
    redo = '--all' in sys.argv
    manifest_path = OUT / 'manifest.json'
    old = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {}
    want = lines()
    manifest = {'voices': {l: VOICES[l][1] for l in VOICES}}
    for lang, entries in want.items():
        voice = PiperVoice.load(fetch(lang))
        cfg = SynthesisConfig(length_scale=LENGTH_SCALE)
        (OUT / lang).mkdir(parents=True, exist_ok=True)
        done = old.get(lang, {})
        manifest[lang] = {}
        for cid, text in entries.items():
            mp3 = OUT / lang / f'{cid}.mp3'
            manifest[lang][cid] = text
            if not redo and done.get(cid) == text and mp3.exists():
                continue
            with tempfile.TemporaryDirectory() as tmp:
                wav = Path(tmp) / 'line.wav'
                # Piper now and then babbles on past the end of a line (a
                # three-word line came out 4 s long): a take much longer than
                # the text needs is recorded again (the voices vary a little
                # take to take), keeping the shortest
                limit = 0.6 + 0.12 * len(text)
                best = None
                for take in range(6):
                    t = Path(tmp) / f'take{take}.wav'
                    with wave.open(str(t), 'wb') as wf:
                        voice.synthesize_wav(text, wf, syn_config=cfg)
                    with wave.open(str(t), 'rb') as wf:
                        secs = wf.getnframes() / wf.getframerate()
                    if best is None or secs < best[0]:
                        best = (secs, t)
                    if secs <= limit:
                        break
                if best[0] > limit:
                    print(f'  warning: {lang}/{cid} is still {best[0]:.1f} s (listen to it)')
                best[1].replace(wav)
                # mono MP3, loudness-matched so every line plays as loud
                subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(wav),
                                '-af', 'loudnorm=I=-16:TP=-1.5', '-ac', '1', '-ar', '22050',
                                '-b:a', '48k', str(mp3)], check=True)
            print(f'{lang}/{cid}.mp3  "{text}"')
        # clips of lines that are gone
        for f in (OUT / lang).glob('*.mp3'):
            if f.stem not in entries:
                f.unlink()
                print(f'removed {lang}/{f.name}')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(f'manifest: {manifest_path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()

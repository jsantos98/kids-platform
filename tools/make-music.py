"""Record the game's music (G12).

Every track in src/engine/musicList.ts (via tools/music-list.ts) — each
moment has several, which the game plays in turn — is composed by ElevenLabs'
music generation from its prompt and kept as it came in
.voices/music/<moment>-<n>.mp3 (git-ignored: re-cutting costs nothing). Each
is cut into a seamless loop — the longest stretch whose end carries on as its
start did, a whole number of bars (tools/music_loop.py) — crossfaded at the
join, set to one level and saved as public/audio/music/<moment>-<n>.ogg
(stereo, 44.1 kHz). public/audio/music/manifest.json lists each track's
prompt and loop. Only what is new or changed is composed; a track nobody likes
gets a `take` bumped in the list and is composed again.

Needs: Python 3.10+ with numpy, ffmpeg on the PATH, Node (npx), and
ELEVENLABS_API_KEY in .env.local — a paid plan (music: ~900 credits a minute).
Run from the repository root:  python tools/make-music.py [moment ...]
"""
import json
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from music_loop import make_loop  # noqa: E402
from seamless import fix_seam, level  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'audio' / 'music'
TAKES = ROOT / '.voices' / 'music'
API = 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192'
MODELS = ('music_v2_5', 'music_v1')
SR = 44100


def api_key() -> str:
    for line in (ROOT / '.env.local').read_text('utf-8').splitlines():
        if line.strip().startswith('ELEVENLABS_API_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    sys.exit('ELEVENLABS_API_KEY is missing from .env.local')


def tracks() -> dict:
    res = subprocess.run('npx tsx tools/music-list.ts', cwd=ROOT, shell=True, capture_output=True, check=True)
    return json.loads(res.stdout.decode('utf-8'))


def compose(key: str, d: dict, out: Path) -> str:
    """one track; the newest model that takes a prompt, else the first one"""
    for model in MODELS:
        body = {'prompt': d['prompt'], 'music_length_ms': int(d['seconds'] * 1000), 'model_id': model, 'force_instrumental': True}
        req = urllib.request.Request(API, method='POST', data=json.dumps(body).encode('utf-8'),
                                     headers={'xi-api-key': key, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                out.write_bytes(r.read())
            return model
        except urllib.error.HTTPError as e:
            msg = e.read().decode('utf-8', 'replace')[:300]
            if model == MODELS[-1]:
                sys.exit(f'music generation failed: {e.code} {msg}')
            print(f'  ({model}: {e.code} {msg} — trying {MODELS[-1]})')
    raise AssertionError


def decode(src: Path) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(src), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2)


def cut(src: Path, bpm: float, ogg: Path) -> dict:
    """a take as the game's loop: cut, crossfaded, levelled, OGG"""
    y, a, b, score = make_loop(decode(src), SR)
    y = np.stack([fix_seam(y[:, c], SR) for c in range(2)], 1)
    y = level(y, rms_db=-17.0)
    with tempfile.TemporaryDirectory() as tmp:
        f32 = Path(tmp) / 'loop.f32'
        y.astype(np.float32).tofile(f32)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', str(f32),
                        '-c:a', 'libvorbis', '-q:a', '5', '-ar', str(SR), str(ogg)], check=True)
    beats = (b - a) / SR / (60 / bpm)
    return {'from': round(a / SR, 3), 'to': round(b / SR, 3), 'beats': round(beats, 2), 'match': round(score, 2)}


def main() -> None:
    only = {a for a in sys.argv[1:] if not a.startswith('--')}
    want = tracks()
    OUT.mkdir(parents=True, exist_ok=True)
    TAKES.mkdir(parents=True, exist_ok=True)
    index_path = TAKES / 'takes.json'
    index = json.loads(index_path.read_text('utf-8')) if index_path.exists() else {}
    manifest_path = OUT / 'manifest.json'
    old = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {}
    key = None
    manifest = {}
    names = set()
    for moment, defs in want.items():
        for n, d in enumerate(defs):
            name = f'{moment}-{n + 1}'
            names.add(name)
            sig = {'prompt': d['prompt'], 'seconds': d['seconds'], 'take': d.get('take', 1)}
            raw, ogg = TAKES / f'{name}.mp3', OUT / f'{name}.ogg'
            if not raw.exists() or {k: index.get(name, {}).get(k) for k in sig} != sig:
                if only and moment not in only:
                    if name in old and ogg.exists():
                        manifest[name] = old[name]
                    print(f'  NOTE: {name} is new or changed — python tools/make-music.py {moment}')
                    continue
                key = key or api_key()
                model = compose(key, d, raw)
                index[name] = {**sig, 'model': model}
                index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + '\n', 'utf-8')
                print(f'{name}  composed, {d["seconds"]} s  ({model}, ~{round(d["seconds"] / 60 * 900)} credits)', flush=True)
            entry = {**sig, 'bpm': d['bpm']}
            if {k: old.get(name, {}).get(k) for k in entry} == entry and ogg.exists() and ogg.stat().st_mtime >= raw.stat().st_mtime:
                manifest[name] = old[name]
                continue
            info = cut(raw, d['bpm'], ogg)
            manifest[name] = {**entry, 'loop': info}
            bars = info['beats'] / 4
            warn = '' if abs(bars - round(bars)) < 0.1 else '  WARNING: not a whole number of bars — listen to the seam'
            print(f"{name}.ogg  loop {info['from']}–{info['to']} s ({info['to'] - info['from']:.0f} s), {info['beats']} beats, match {info['match']}{warn}")
    for f in OUT.glob('*.ogg'):
        if f.stem not in names:
            f.unlink()
            print(f'removed {f.name}')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(f'manifest: {manifest_path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()

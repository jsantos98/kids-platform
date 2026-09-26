"""Record the game's music (G12).

Every track in src/engine/musicList.ts (via tools/music-list.ts) is composed by
ElevenLabs' music generation from its prompt in two takes, kept as they came
in .voices/music/ (git-ignored: re-cutting them costs nothing). The picked take
of each track (tools/music-picks.json; until one is picked, the take with the
longest loop) is cut into
a seamless loop — the longest stretch whose end carries on as its start did,
a whole number of bars (tools/music_loop.py) — crossfaded at the join, set to
one level and saved as public/audio/music/<id>.ogg (stereo, 44.1 kHz).
public/audio/music/manifest.json lists each track's prompt, take and loop.

A page to pick the takes: .voices/music/index.html (served by the dev server:
http://localhost:8321/.voices/music/index.html) plays each take's loop on
repeat; «Guardar escolhas» saves the picks to concept-art/music-picks.json,
which the next run moves over tools/music-picks.json and installs.

Needs: Python 3.10+ with numpy, ffmpeg on the PATH, Node (npx), and
ELEVENLABS_API_KEY in .env.local — a paid plan (music: ~900 credits a minute).
Run from the repository root:  python tools/make-music.py [id ...] [--more]
  (--more: two more takes, C and D, of the tracks named)
"""
import json
import shutil
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
PICKS = ROOT / 'tools' / 'music-picks.json'
SAVED = ROOT / 'concept-art' / 'music-picks.json'
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
    """one take; the newest model that takes a prompt, else the first one"""
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


def seconds(f: Path) -> float:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], capture_output=True, check=True)
    return float(out.stdout.decode().strip() or 0)


def longest(tid: str, prompt: str, index: dict) -> str:
    loops = [(seconds(p), p.stem[len(tid) + 1]) for p in TAKES.glob(f'{tid}-?-loop.ogg')
             if index.get(p.stem[:-5], {}).get('prompt') == prompt]
    # (a tie, to the nearest second: the earlier take)
    return max(loops, key=lambda l: (round(l[0]), -ord(l[1])))[1] if loops else 'A'


def main() -> None:
    more = '--more' in sys.argv
    only = {a for a in sys.argv[1:] if not a.startswith('--')}
    want = tracks()
    OUT.mkdir(parents=True, exist_ok=True)
    TAKES.mkdir(parents=True, exist_ok=True)
    # (picks saved on the takes page come in over the tracked file)
    if SAVED.exists():
        shutil.move(SAVED, PICKS)
        print(f'picks: {SAVED.relative_to(ROOT)} -> {PICKS.relative_to(ROOT)}')
    picks = json.loads(PICKS.read_text('utf-8')) if PICKS.exists() else {}
    index_path = TAKES / 'takes.json'
    index = json.loads(index_path.read_text('utf-8')) if index_path.exists() else {}
    manifest_path = OUT / 'manifest.json'
    old = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {}
    key = None
    manifest = {}
    for tid, d in want.items():
        sig = {'prompt': d['prompt'], 'seconds': d['seconds']}
        # the takes: A and B (C and D with --more), recorded from this prompt
        tags = ['A', 'B'] + (['C', 'D'] if more and (not only or tid in only) else [])
        for tag in tags:
            raw = TAKES / f'{tid}-{tag}.mp3'
            if raw.exists() and index.get(f'{tid}-{tag}', {}).get('prompt') == d['prompt'] and index[f'{tid}-{tag}'].get('seconds') == d['seconds']:
                continue
            if only and tid not in only:
                continue
            key = key or api_key()
            model = compose(key, d, raw)
            index[f'{tid}-{tag}'] = {**sig, 'model': model}
            index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + '\n', 'utf-8')
            print(f'{tid}-{tag}  {d["seconds"]} s  ({model}, ~{round(d["seconds"] / 60 * 900)} credits)', flush=True)
        # every take's loop, to hear on the page
        for raw in sorted(TAKES.glob(f'{tid}-?.mp3')):
            prev = raw.with_name(raw.stem + '-loop.ogg')
            if index.get(raw.stem, {}).get('prompt') != d['prompt']:
                continue
            if not prev.exists() or prev.stat().st_mtime < raw.stat().st_mtime:
                cut(raw, d['bpm'], prev)
        # the picked take, installed (until one is picked: the longest loop —
        # a short loop is heard repeating)
        tag = picks.get(tid) or longest(tid, d['prompt'], index)
        raw = TAKES / f'{tid}-{tag}.mp3'
        if not raw.exists() or index.get(raw.stem, {}).get('prompt') != d['prompt']:
            if tid in old and (OUT / f'{tid}.ogg').exists():
                manifest[tid] = old[tid]
            print(f'  NOTE: {tid} has no take {tag} recorded from its prompt — python tools/make-music.py {tid}')
            continue
        entry = {**sig, 'bpm': d['bpm'], 'take': tag}
        if old.get(tid, {}).get('take') == tag and {k: old[tid].get(k) for k in entry} == entry and (OUT / f'{tid}.ogg').exists():
            manifest[tid] = old[tid]
            continue
        info = cut(raw, d['bpm'], OUT / f'{tid}.ogg')
        manifest[tid] = {**entry, 'loop': info}
        bars = info['beats'] / 4
        warn = '' if abs(bars - round(bars)) < 0.1 else '  WARNING: not a whole number of bars — listen to the seam'
        print(f"{tid}.ogg  take {tag}: loop {info['from']}–{info['to']} s, {info['beats']} beats, match {info['match']}{warn}")
    for f in OUT.glob('*.ogg'):
        if f.stem not in want:
            f.unlink()
            print(f'removed {f.name}')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    page(want, {tid: e['take'] for tid, e in manifest.items()})
    print(f'manifest: {manifest_path.relative_to(ROOT)}   takes page: http://localhost:8321/.voices/music/index.html')


def page(want: dict, picks: dict) -> None:
    rows = []
    for tid, d in want.items():
        cells = ''.join(
            f'<label><input type="radio" name="{tid}" value="{p.stem[len(tid) + 1]}"><audio controls loop preload="none" src="{p.name}"></audio>'
            f'<small>take {p.stem[len(tid) + 1]}</small></label>'
            for p in sorted(TAKES.glob(f'{tid}-?-loop.ogg')))
        rows.append(f'<tr data-id="{tid}" data-pick="{picks.get(tid, "A")}"><td class="t"><b>{tid}</b><br><small>{d["prompt"]}</small></td><td class="c">{cells}</td></tr>')
    (TAKES / 'index.html').write_text(PAGE.replace('%ROWS%', '\n'.join(rows)), 'utf-8')


PAGE = """<!doctype html><meta charset="utf-8"><title>Escolher as músicas</title>
<style>body{font:15px system-ui;margin:20px 20px 90px;background:#faf7ef;color:#333}table{border-collapse:collapse;width:100%}
td{border-bottom:1px solid #e3ddd0;padding:8px;vertical-align:top;background:#fff}td.t{width:420px}td.t small{color:#888}
td.c{display:flex;flex-wrap:wrap;gap:10px}label{display:flex;flex-direction:column;align-items:flex-start;padding:6px;border-radius:10px;border:2px solid transparent;cursor:pointer}
label:has(input:checked){border-color:#e25c5c;background:#fff5f2}audio{width:300px;height:34px}small{color:#777}
#bar{position:fixed;left:0;right:0;bottom:0;padding:12px 20px;background:#fffdf6;border-top:1px solid #e3ddd0;display:flex;gap:16px;align-items:center}
button{font:inherit;padding:8px 18px;border-radius:999px;border:0;background:#e25c5c;color:#fff;cursor:pointer}</style>
<h1>🎵 Escolher as músicas</h1>
<p>Cada música tem duas versões, já cortadas em loop (tocam em repetição: ouve a emenda quando volta ao início). Escolhe a melhor de cada
e carrega em «Guardar escolhas». A marcada à partida é a que está no jogo agora.</p>
<table>%ROWS%</table>
<div id="bar"><button id="save">Guardar escolhas</button><span id="msg"></span></div>
<script>
const picks = {};
for (const tr of document.querySelectorAll('tr[data-id]')) {
  const id = tr.dataset.id;
  picks[id] = tr.dataset.pick;
  for (const r of tr.querySelectorAll('input')) {
    if (r.value === picks[id]) r.checked = true;
    r.onchange = () => { picks[id] = r.value; };
  }
}
document.addEventListener('play', e => { for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause(); }, true);
document.getElementById('save').onclick = async () => {
  const body = 'data:application/json;base64,' + btoa(JSON.stringify(picks, null, 1));
  const r = await fetch('/save?name=music-picks.json', { method: 'POST', body });
  document.getElementById('msg').textContent = r.ok ? '✔ guardado' : '✘ não guardou';
};
</script>"""

if __name__ == '__main__':
    main()

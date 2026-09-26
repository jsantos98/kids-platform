"""Record several ElevenLabs takes of every Portuguese line in one voice, and a
page to pick the best of each (G9). The takes stay in .voices/takes/<voice>/
(git-ignored) with takes.json, the text each line's takes were recorded from;
the page saves the picks to concept-art/voice-picks-<voice>.json through the
dev server's /save endpoint — copy them over tools/voice-picks-<voice>.json,
from which tools/make-voice.py installs the picked take of each line.

Why several takes, two models: ElevenLabs treats Portuguese as one language and
Brazilian dominates it, so a Portugal voice drifts Brazilian on some lines
("ga-tchi-nho"). The takes:
  A, B  multilingual v2 — follows the voice's own accent best — with a
        European-Portuguese sentence given as the line's preceding context
  C, D  v3 — the expressive model — with a neutral European-Portuguese accent cue and the line's
        emotion cue
Run from the repository root:  python tools/voice-takes.py <voice_id> <name> [id ...] [--more]
  (--more: eight more takes E–L of the lines named, for a line none of A–D got right)
Needs ELEVENLABS_API_KEY in .env.local (a paid plan for a library voice).
"""
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAG = {'excited': '[excited]', 'cheer': '[cheerful]', 'warm': '[warmly]', 'lively': '[friendly]'}
ACCENT = '[neutral standard European Portuguese accent, from Portugal]'
# a sentence only a Portugal speaker would say, heard "before" each v2 line
CONTEXT = 'Olá! Então, estás bom? Vamos lá, que se faz tarde, está bem?'
# v2's expressiveness per mood: (stability, style) — lower stability, more style = livelier
V2 = {'excited': (0.3, 0.6), 'cheer': (0.35, 0.5), 'warm': (0.55, 0.25), 'lively': (0.45, 0.35)}
TRIM = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,'
        'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,loudnorm=I=-16:TP=-1.5')


def key() -> str:
    for line in (ROOT / '.env.local').read_text('utf-8').splitlines():
        if line.startswith('ELEVENLABS_API_KEY='):
            return line.split('=', 1)[1].strip()
    sys.exit('ELEVENLABS_API_KEY is missing from .env.local')


def tts(k: str, voice: str, body: dict, out: Path) -> None:
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128', method='POST',
                                 data=json.dumps(body).encode('utf-8'), headers={'xi-api-key': k, 'Content-Type': 'application/json'})
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / 'raw.mp3'
        raw.write_bytes(urllib.request.urlopen(req, timeout=180).read())
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(raw), '-af', TRIM, '-ac', '1', '-ar', '24000', '-b:a', '48k', str(out)], check=True)


def takes_for(text: str, mood: str) -> dict:
    st, style = V2[mood]
    v2 = {'model_id': 'eleven_multilingual_v2', 'text': text, 'previous_text': CONTEXT,
          'voice_settings': {'stability': st, 'similarity_boost': 0.85, 'style': style, 'use_speaker_boost': True}}
    # (v3 stops mid-word on short lines — a trailing [long pause] lets it finish
    # the words and then fall silent; the trim takes the silence off)
    v3 = {'model_id': 'eleven_v3', 'text': f'{ACCENT} {TAG[mood]} {text} [long pause]', 'language_code': 'pt'}
    return {'A': {**v2, 'seed': 11}, 'B': {**v2, 'seed': 29}, 'C': {**v3, 'seed': 11}, 'D': {**v3, 'seed': 29}}


# a second European-Portuguese context sentence, for the extra v2 take
CONTEXT2 = 'Bom dia! Olha, anda cá ver isto, que é mesmo giro. Pois é, está visto!'


def more_takes(text: str, mood: str) -> dict:
    """eight more takes for a line none of A–D got right: steadier v2 (the
    accent holds better), v2 with another context, v3 with new seeds, and
    turbo v2.5 told the language is Portuguese"""
    st, style = V2[mood]
    v2 = {'model_id': 'eleven_multilingual_v2', 'text': text, 'previous_text': CONTEXT,
          'voice_settings': {'stability': max(st, 0.55), 'similarity_boost': 0.9, 'style': min(style, 0.3), 'use_speaker_boost': True}}
    v3 = takes_for(text, mood)['C']
    turbo = {'model_id': 'eleven_turbo_v2_5', 'text': text, 'language_code': 'pt', 'previous_text': CONTEXT,
             'voice_settings': {'stability': 0.5, 'similarity_boost': 0.85, 'style': 0.3, 'use_speaker_boost': True}}
    return {'E': {**v2, 'seed': 101}, 'F': {**v2, 'seed': 202}, 'G': {**v2, 'seed': 303},
            'H': {**v2, 'previous_text': CONTEXT2, 'seed': 404},
            'I': {**v3, 'seed': 101}, 'J': {**v3, 'seed': 202},
            'K': {**turbo, 'seed': 101}, 'L': {**turbo, 'seed': 202}}


LABEL = {'A': 'v2 + contexto PT', 'B': 'v2 + contexto PT', 'C': 'v3 + sotaque neutro', 'D': 'v3 + sotaque neutro',
         'E': 'v2 estável', 'F': 'v2 estável', 'G': 'v2 estável', 'H': 'v2 + outro contexto',
         'I': 'v3 + sotaque neutro', 'J': 'v3 + sotaque neutro', 'K': 'turbo v2.5 (pt)', 'L': 'turbo v2.5 (pt)'}


def main() -> None:
    voice, name = sys.argv[1], sys.argv[2]
    more = '--more' in sys.argv
    only = {a for a in sys.argv[3:] if not a.startswith('--')}
    got = json.loads(subprocess.run('npx tsx tools/voice-lines.ts', cwd=ROOT, shell=True, capture_output=True, check=True).stdout.decode('utf-8'))
    lines, moods = got['lines']['pt'], got['moods']
    out = ROOT / '.voices' / 'takes' / name
    out.mkdir(parents=True, exist_ok=True)
    k = key()
    # (what text each line's takes were recorded from: a take outlives no text change)
    index = json.loads((out / 'takes.json').read_text('utf-8')) if (out / 'takes.json').exists() else {}
    for cid, text in lines.items():
        if only and cid not in only:
            continue
        todo = takes_for(text, moods.get(cid, 'lively'))
        if more:
            todo.update(more_takes(text, moods.get(cid, 'lively')))
        for tag, body in todo.items():
            f = out / f'{cid}-{tag}.mp3'
            if f.exists():
                continue
            tts(k, voice, body, f)
        index[cid] = text
        print('ok', cid, flush=True)
    (out / 'takes.json').write_text(json.dumps(index, ensure_ascii=False, indent=1) + '\n', 'utf-8')
    # the picking page
    rows = []
    for cid, text in lines.items():
        have = [t for t in LABEL if (out / f'{cid}-{t}.mp3').exists()]
        cells = ''.join(
            f'<label><input type="radio" name="{cid}" value="{t}"><audio controls preload="none" src="{cid}-{t}.mp3"></audio>'
            f'<small>{t} · {LABEL[t]}</small></label>' for t in have)
        rows.append(f'<tr data-id="{cid}"><td class="t"><b>{text}</b><br><small>{cid} · {moods.get(cid, "lively")}</small></td>'
                    f'<td><audio controls preload="none" src="/audio/voice/pt/{cid}.mp3"></audio><small>atual</small></td><td class="c">{cells}</td></tr>')
    (out / 'index.html').write_text(PAGE.replace('%NAME%', name).replace('%ROWS%', '\n'.join(rows)), 'utf-8')
    print('page:', out / 'index.html')


PAGE = """<!doctype html><meta charset="utf-8"><title>Escolher as falas — %NAME%</title>
<style>body{font:15px system-ui;margin:20px 20px 90px;background:#faf7ef;color:#333}table{border-collapse:collapse;width:100%}
td{border-bottom:1px solid #e3ddd0;padding:8px;vertical-align:top;background:#fff}td.t{width:260px}
td.c{display:flex;flex-wrap:wrap;gap:10px}label{display:flex;flex-direction:column;align-items:flex-start;padding:6px;border-radius:10px;border:2px solid transparent;cursor:pointer}
label:has(input:checked){border-color:#e25c5c;background:#fff5f2}audio{width:210px;height:34px}small{color:#777}
#bar{position:fixed;left:0;right:0;bottom:0;padding:12px 20px;background:#fffdf6;border-top:1px solid #e3ddd0;display:flex;gap:16px;align-items:center}
button{font:inherit;padding:8px 18px;border-radius:999px;border:0;background:#e25c5c;color:#fff;cursor:pointer}tr.done td.t{background:#f3fbf1}body.only tr.done{display:none}</style>
<h1>Escolher as falas — %NAME%</h1>
<p>Para cada frase, ouve as 4 versões e escolhe a melhor (a que soa mesmo a português de Portugal). A e B: modelo v2 com contexto
português; C e D: modelo v3 (mais expressivo) com indicação de sotaque português neutro. As escolhas ficam guardadas neste browser; no fim carrega
em «Guardar escolhas». Se nenhuma versão servir, deixa a frase por escolher e diz-me qual é.</p>
<table>%ROWS%</table>
<div id="bar"><button id="save">Guardar escolhas</button><button id="only" style="background:#6b7480">Só as que faltam</button><span id="count"></span><span id="msg"></span></div>
<script>
const KEY = 'picks-%NAME%';
const picks = JSON.parse(localStorage.getItem(KEY) || '{}');
const rows = [...document.querySelectorAll('tr[data-id]')];
const show = () => {
  for (const tr of rows) tr.classList.toggle('done', !!picks[tr.dataset.id]);
  document.getElementById('count').textContent = `${Object.keys(picks).length} de ${rows.length} escolhidas`;
};
for (const tr of rows) {
  const id = tr.dataset.id;
  for (const r of tr.querySelectorAll('input')) {
    if (picks[id] === r.value) r.checked = true;
    r.onchange = () => { picks[id] = r.value; localStorage.setItem(KEY, JSON.stringify(picks)); show(); };
  }
}
// (one clip at a time)
document.addEventListener('play', e => { for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause(); }, true);
document.getElementById('save').onclick = async () => {
  const body = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(picks, null, 1))));
  const r = await fetch('/save?name=voice-picks-%NAME%.json', { method: 'POST', body });
  document.getElementById('msg').textContent = r.ok ? '✔ guardado' : '✘ não guardou';
};
document.getElementById('only').onclick = e => {
  const on = document.body.classList.toggle('only');
  e.target.textContent = on ? 'Mostrar todas' : 'Só as que faltam';
};
show();
</script>"""

if __name__ == '__main__':
    main()

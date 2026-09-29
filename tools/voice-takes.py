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
  (--more: eight more takes E–L of the lines named, for a line none of A–D got right;
   --again: eight more still, M–T, for a line none of A–L got right — v2 held
   steadier after other European-Portuguese sentences, v3 cued to a Lisbon accent)
Needs ELEVENLABS_API_KEY in .env.local (a paid plan for a library voice).
"""
import json
import subprocess
from html import escape
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


# other European-Portuguese sentences heard before a line (the third round)
CONTEXT3 = 'Então, miúdo, vamos a isso? Está calor lá fora, mas o autocarro já vem aí.'
CONTEXT4 = 'Ó pá, que giro! Anda, despacha-te, que a tua mãe está à tua espera na paragem.'
LISBON = '[European Portuguese accent from Lisbon, Portugal, not Brazilian]'


def again_takes(text: str, mood: str) -> dict:
    """eight more for a line none of A–L got right: v2 held steadier still
    after other European sentences, and v3 cued to a Lisbon accent"""
    st, style = V2[mood]
    v2 = {'model_id': 'eleven_multilingual_v2', 'text': text,
          'voice_settings': {'stability': max(st, 0.7), 'similarity_boost': 0.95, 'style': min(style, 0.2), 'use_speaker_boost': True}}
    v3 = {'model_id': 'eleven_v3', 'text': f'{LISBON} {TAG[mood]} {text} [long pause]', 'language_code': 'pt'}
    return {'M': {**v2, 'previous_text': CONTEXT3, 'seed': 505}, 'N': {**v2, 'previous_text': CONTEXT3, 'seed': 606},
            'O': {**v2, 'previous_text': CONTEXT4, 'seed': 707}, 'P': {**v2, 'previous_text': CONTEXT4, 'seed': 808},
            'Q': {**v3, 'seed': 505}, 'R': {**v3, 'seed': 606}, 'S': {**v3, 'seed': 707}, 'T': {**v3, 'seed': 808}}


LABEL = {'A': 'v2 + contexto PT', 'B': 'v2 + contexto PT', 'C': 'v3 + sotaque neutro', 'D': 'v3 + sotaque neutro',
         'E': 'v2 estável', 'F': 'v2 estável', 'G': 'v2 estável', 'H': 'v2 + outro contexto',
         'I': 'v3 + sotaque neutro', 'J': 'v3 + sotaque neutro', 'K': 'turbo v2.5 (pt)', 'L': 'turbo v2.5 (pt)',
         'M': 'v2 muito estável', 'N': 'v2 muito estável', 'O': 'v2 muito estável', 'P': 'v2 muito estável',
         'Q': 'v3 sotaque de Lisboa', 'R': 'v3 sotaque de Lisboa', 'S': 'v3 sotaque de Lisboa', 'T': 'v3 sotaque de Lisboa'}


def main() -> None:
    voice, name = sys.argv[1], sys.argv[2]
    more = '--more' in sys.argv
    again = '--again' in sys.argv
    only = {a for a in sys.argv[3:] if not a.startswith('--')}
    got = json.loads(subprocess.run('npx tsx tools/voice-lines.ts', cwd=ROOT, shell=True, capture_output=True, check=True).stdout.decode('utf-8'))
    lines, moods = got['lines']['pt'], got['moods']
    out = ROOT / '.voices' / 'takes' / name
    out.mkdir(parents=True, exist_ok=True)
    k = key()
    # (what text each line's takes were recorded from: a take outlives no text change)
    index = json.loads((out / 'takes.json').read_text('utf-8')) if (out / 'takes.json').exists() else {}
    picks_path = ROOT / 'tools' / f'voice-picks-{name}.json'
    picks = json.loads(picks_path.read_text('utf-8')) if picks_path.exists() else {}
    for cid, text in lines.items():
        if only and cid not in only:
            continue
        # (a line whose text changed: its old takes and its pick go — they
        # say something else)
        if cid in index and index[cid] != text:
            for f in out.glob(f'{cid}-?.mp3'):
                f.unlink()
            picks.pop(cid, None)
            print('  text changed:', cid, flush=True)
        todo = takes_for(text, moods.get(cid, 'lively'))
        if more:
            todo.update(more_takes(text, moods.get(cid, 'lively')))
        if again:
            todo.update(again_takes(text, moods.get(cid, 'lively')))
        for tag, body in todo.items():
            f = out / f'{cid}-{tag}.mp3'
            if f.exists():
                continue
            tts(k, voice, body, f)
        index[cid] = text
        print('ok', cid, flush=True)
    (out / 'takes.json').write_text(json.dumps(index, ensure_ascii=False, indent=1) + '\n', 'utf-8')
    picks_path.write_text(json.dumps(picks, ensure_ascii=False, indent=1) + '\n', 'utf-8')
    # the picking page
    rows = []
    for cid, text in lines.items():
        have = [t for t in LABEL if (out / f'{cid}-{t}.mp3').exists()]
        cells = ''.join(
            f'<label><input type="radio" name="{cid}" value="{t}"><audio controls preload="none" src="{cid}-{t}.mp3"></audio>'
            f'<small>{t} · {LABEL[t]}</small></label>' for t in have)
        rows.append(f'<tr data-id="{cid}" data-text="{escape(text)}"><td class="t"><b>{text}</b><br><small>{cid} · {moods.get(cid, "lively")}</small></td>'
                    f'<td><audio controls preload="none" src="/audio/voice/pt/{cid}.mp3"></audio><small>atual</small></td><td class="c">{cells}</td></tr>')
    (out / 'index.html').write_text(PAGE.replace('%NAME%', name).replace('%ROWS%', '\n'.join(rows))
                                    .replace('%PICKS%', json.dumps(picks)), 'utf-8')
    print('page:', out / 'index.html')


PAGE = """<!doctype html><meta charset="utf-8"><title>Escolher as falas — %NAME%</title>
<style>body{font:15px system-ui;margin:20px 20px 90px;background:#faf7ef;color:#333}table{border-collapse:collapse;width:100%}
td{border-bottom:1px solid #e3ddd0;padding:8px;vertical-align:top;background:#fff}td.t{width:260px}
td.c{display:flex;flex-wrap:wrap;gap:10px}label{display:flex;flex-direction:column;align-items:flex-start;padding:6px;border-radius:10px;border:2px solid transparent;cursor:pointer}
label:has(input:checked){border-color:#e25c5c;background:#fff5f2}audio{width:210px;height:34px}small{color:#777}
#bar{position:fixed;left:0;right:0;bottom:0;padding:12px 20px;background:#fffdf6;border-top:1px solid #e3ddd0;display:flex;gap:16px;align-items:center}
button{font:inherit;padding:8px 18px;border-radius:999px;border:0;background:#e25c5c;color:#fff;cursor:pointer}tr.done td.t{background:#f3fbf1}body.only tr.done{display:none}</style>
<h1>Escolher as falas — %NAME%</h1>
<p>Para cada frase, ouve as versões e escolhe a melhor (a que soa mesmo a português de Portugal). A e B: modelo v2 com contexto
português; C e D: modelo v3 (mais expressivo) com indicação de sotaque português neutro. As escolhas ficam guardadas neste browser; no fim carrega
em «Guardar escolhas». Se nenhuma versão servir, deixa a frase por escolher e diz-me qual é.</p>
<table>%ROWS%</table>
<div id="bar"><button id="save">Guardar escolhas</button><button id="only" style="background:#6b7480">Só as que faltam</button><span id="count"></span><span id="msg"></span></div>
<script>
const KEY = 'picks-%NAME%';
const BASE = %PICKS%;
const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
const rows = [...document.querySelectorAll('tr[data-id]')];
const picks = {};
for (const tr of rows) {
  const s = saved[tr.dataset.id];
  if (s && s.x === tr.dataset.text) picks[tr.dataset.id] = s.t;
  else if (BASE[tr.dataset.id]) picks[tr.dataset.id] = BASE[tr.dataset.id];
}
const store = () => localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(rows.filter(tr => picks[tr.dataset.id]).map(tr => [tr.dataset.id, { t: picks[tr.dataset.id], x: tr.dataset.text }]))));
const show = () => {
  for (const tr of rows) tr.classList.toggle('done', !!picks[tr.dataset.id]);
  document.getElementById('count').textContent = `${Object.keys(picks).length} de ${rows.length} escolhidas`;
};
for (const tr of rows) {
  const id = tr.dataset.id;
  for (const r of tr.querySelectorAll('input')) {
    if (picks[id] === r.value) r.checked = true;
    r.onchange = () => { picks[id] = r.value; store(); show(); };
  }
}
// (one clip at a time)
document.addEventListener('play', e => { for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause(); }, true);
document.getElementById('save').onclick = async () => {
  const body = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(picks, null, 1))));
  const r = await fetch('/save?name=voice-picks-%NAME%.json', { method: 'POST', body });
  document.getElementById('msg').textContent = r.ok ? '✔ guardado' : '✘ não guardou';
};
// ?only=say-arrive,say-hold,…: just those lines (an id, or the start of one —
// say-praise shows all its variants), to hunt down one that sounds wrong
const ONLY = (new URLSearchParams(location.search).get('only') || '').split(',').map(s => s.trim()).filter(Boolean);
if (ONLY.length) {
  for (const tr of rows) if (!ONLY.some(o => tr.dataset.id === o || tr.dataset.id.startsWith(o + '-'))) tr.style.display = 'none';
  document.querySelector('h1').textContent += ` — ${rows.filter(tr => tr.style.display !== 'none').length} frases`;
}
document.getElementById('only').onclick = e => {
  const on = document.body.classList.toggle('only');
  e.target.textContent = on ? 'Mostrar todas' : 'Só as que faltam';
};
show();
</script>"""

if __name__ == '__main__':
    main()

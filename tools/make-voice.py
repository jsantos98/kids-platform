"""Record the game's spoken lines (G9).

Every line comes from src/i18n (via tools/voice-lines.ts), is spoken by the
language's voice and saved as a small MP3 in
public/audio/voice/<lang>/<id>.mp3, silence trimmed from both ends and
loudness-matched, with public/audio/voice/manifest.json listing the text each
clip says and the voice that said it (tools/check-i18n.ts fails on a clip
that no longer matches its dictionary text). Only new or changed lines are
recorded; a language whose voice changed is recorded again in full.

Voices:
  pt  ElevenLabs' "Benedita" (a Portugal-Portuguese voice from its library).
      Every line was recorded in several takes (tools/voice-takes.py — two
      models, since ElevenLabs drifts Brazilian on some lines) and a person
      picked the best of each by ear; the picks live in
      tools/voice-picks-pt-benedita.json and the takes in
      .voices/takes/pt-benedita/ (git-ignored). This installs the picked take
      of each line; a new or changed line gets a fresh default take (v2 with a
      European-Portuguese context) and a warning to listen to it and pick —
      `python tools/voice-takes.py <voice> pt-benedita <id> [--more]`, then
      the page's picks copied over the JSON. Needs ELEVENLABS_API_KEY in
      .env.local (a paid plan: a library voice).
      (Before: Microsoft's pt-PT-RaquelNeural via Azure / edge-tts — the
      'microsoft' engine is kept.)
  en  Piper's en_GB-cori-medium (British English; LibriVox recordings, public
      domain), offline: downloaded once into .voices/ (git-ignored, ~63 MB).

Needs: Python 3.10+, ffmpeg on the PATH, Node (npx), `pip install piper-tts`
(English), and an ElevenLabs key (Portuguese).
Run from the repository root:  python tools/make-voice.py  [--all]
"""
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import wave
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.voices'
OUT = ROOT / 'public' / 'audio' / 'voice'
PIPER_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
# each language's voice: its engine and name (a Piper voice also its folder)
VOICES = {
    'pt': {'engine': 'elevenlabs', 'name': 'Benedita', 'voice_id': 'NkpT2jezTenCDRKHkWiX',
           'takes': ROOT / '.voices' / 'takes' / 'pt-benedita', 'picks': ROOT / 'tools' / 'voice-picks-pt-benedita.json'},
    'en': {'engine': 'piper', 'name': 'en_GB-cori-medium', 'folder': 'en/en_GB/cori/medium'},
}
# how each mood is said (src/i18n/voice.ts voiceMood): neither voice can act
# an emotion on request (Raquel has no speaking styles, and edge-tts takes no
# custom SSML), so it's in the delivery — a win comes quicker, higher and
# louder, a bump softer and slower — and in the texts' own exclamations.
# The base pace is a touch slower than the voices' own: the listeners are four.
MOODS = {
    'lively':  {'ms': {'rate': '-6%', 'pitch': '+8Hz', 'volume': '+0%'},
                'piper': {'length_scale': 1.08, 'noise_scale': 0.72, 'noise_w_scale': 0.9}},
    'cheer':   {'ms': {'rate': '+0%', 'pitch': '+18Hz', 'volume': '+6%'},
                'piper': {'length_scale': 1.0, 'noise_scale': 0.78, 'noise_w_scale': 1.0}},
    'excited': {'ms': {'rate': '+6%', 'pitch': '+30Hz', 'volume': '+12%'},
                'piper': {'length_scale': 0.94, 'noise_scale': 0.85, 'noise_w_scale': 1.1}},
    'warm':    {'ms': {'rate': '-12%', 'pitch': '+2Hz', 'volume': '-4%'},
                'piper': {'length_scale': 1.16, 'noise_scale': 0.6, 'noise_w_scale': 0.8}},
}


# ---- Microsoft (Azure, or edge-tts) ----
def microsoft_route() -> str:
    return 'azure' if os.environ.get('AZURE_SPEECH_KEY') else 'edge-tts'


def microsoft(text: str, v: dict, out: Path, mood: str) -> None:
    m = MOODS[mood]['ms']
    if microsoft_route() == 'azure':
        region = os.environ.get('AZURE_SPEECH_REGION', 'westeurope')
        ssml = (f"<speak version='1.0' xml:lang='{v['lang']}'><voice name='{v['name']}'>"
                f"<prosody rate='{m['rate']}' pitch='{m['pitch']}' volume='{m['volume']}'>{escape(text)}</prosody></voice></speak>")
        req = urllib.request.Request(
            f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1',
            data=ssml.encode('utf-8'), method='POST',
            headers={'Ocp-Apim-Subscription-Key': os.environ['AZURE_SPEECH_KEY'],
                     'Content-Type': 'application/ssml+xml',
                     'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
                     'User-Agent': 'kids-platform-make-voice'})
        with urllib.request.urlopen(req) as res:
            out.write_bytes(res.read())
    else:
        import edge_tts
        asyncio.run(edge_tts.Communicate(text, v['name'], rate=m['rate'], pitch=m['pitch'], volume=m['volume']).save(str(out)))


# ---- Piper (offline) ----
_piper = {}


def piper(text: str, v: dict, out: Path, mood: str) -> None:
    from piper import PiperVoice, SynthesisConfig
    if v['name'] not in _piper:
        CACHE.mkdir(exist_ok=True)
        for suffix in ('.onnx', '.onnx.json'):
            dst = CACHE / f"{v['name']}{suffix}"
            if not dst.exists():
                url = PIPER_BASE + urllib.parse.quote(f"{v['folder']}/{v['name']}{suffix}")
                print(f'downloading {url}')
                urllib.request.urlretrieve(url, dst)
        _piper[v['name']] = PiperVoice.load(CACHE / f"{v['name']}.onnx")
    voice = _piper[v['name']]
    cfg = SynthesisConfig(**MOODS[mood]['piper'])
    # Piper now and then babbles on past the end of a line (a three-word line
    # came out 4 s long): a take much longer than the text needs is recorded
    # again (it varies a little take to take), keeping the shortest
    limit = 0.6 + 0.12 * len(text)
    best = None
    for take in range(6):
        t = out.with_name(f'take{take}.wav')
        with wave.open(str(t), 'wb') as wf:
            voice.synthesize_wav(text, wf, syn_config=cfg)
        with wave.open(str(t), 'rb') as wf:
            secs = wf.getnframes() / wf.getframerate()
        if best is None or secs < best[0]:
            best = (secs, t)
        if secs <= limit:
            break
    if best[0] > limit:
        print(f'  warning: "{text}" is still {best[0]:.1f} s (listen to it)')
    best[1].replace(out)


def record(text: str, v: dict, mp3: Path, mood: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / ('raw.wav' if v['engine'] == 'piper' else 'raw.mp3')
        (piper if v['engine'] == 'piper' else microsoft)(text, v, raw, mood)
        # silence off both ends (the Microsoft voices trail ~1 s of it), then
        # a mono MP3, loudness-matched so every line plays as loud
        trim = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,'
                'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,'
                'loudnorm=I=-16:TP=-1.5')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(raw), '-af', trim,
                        '-ac', '1', '-ar', '24000', '-b:a', '48k', str(mp3)], check=True)


# ---- ElevenLabs: the take a person picked by ear ----
_vt = None


def takes_tool():
    global _vt
    if _vt is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location('voice_takes', ROOT / 'tools' / 'voice-takes.py')
        _vt = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_vt)
    return _vt


# (v3's trailing [long pause] leaves a faint hiss the takes' -45 dB trim keeps —
# up to 6 s of it after the words, sometimes ending in a click; -40 dB takes it
# off, both ends, stopping only at 60 ms of sound)
CLIP_TRIM = ('silenceremove=start_periods=1:start_threshold=-40dB:start_duration=0.06:start_silence=0.08,areverse,'
             'silenceremove=start_periods=1:start_threshold=-40dB:start_duration=0.06:start_silence=0.15,areverse')


def clip(take: Path, mp3: Path) -> None:
    """a take, as the game's clip: its silent ends off"""
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(take), '-af', CLIP_TRIM,
                    '-ac', '1', '-ar', '24000', '-b:a', '48k', '-map_metadata', '-1', str(mp3)], check=True)


def elevenlabs(cid: str, text: str, mood: str, v: dict, mp3: Path) -> None:
    """the picked take of this line, if it was recorded from this text; else a
    fresh default take, to be listened to and picked"""
    picks = json.loads(v['picks'].read_text('utf-8')) if v['picks'].exists() else {}
    index_path = v['takes'] / 'takes.json'
    index = json.loads(index_path.read_text('utf-8')) if index_path.exists() else {}
    tag = picks.get(cid)
    take = v['takes'] / f'{cid}-{tag}.mp3' if tag else None
    if take and take.exists() and index.get(cid) == text:
        clip(take, mp3)
        return
    vt = takes_tool()
    v['takes'].mkdir(parents=True, exist_ok=True)
    fresh = v['takes'] / f'{cid}-A.mp3'
    vt.tts(vt.key(), v['voice_id'], vt.takes_for(text, mood)['A'], fresh)
    index[cid] = text
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + '\n', 'utf-8')
    clip(fresh, mp3)
    print(f'  NOTE: {cid} got a fresh default take — listen and pick: python tools/voice-takes.py {v["voice_id"]} pt-benedita {cid}')


def voice_label(v: dict) -> str:
    if v['engine'] == 'elevenlabs':
        return f"{v['name']} (ElevenLabs, picked takes)"
    return f"{v['name']} ({microsoft_route()})" if v['engine'] == 'microsoft' else f"{v['name']} (piper)"


def lines() -> dict:
    res = subprocess.run('npx tsx tools/voice-lines.ts', cwd=ROOT, shell=True,
                         capture_output=True, check=True)
    return json.loads(res.stdout.decode('utf-8'))


def main() -> None:
    redo = '--all' in sys.argv
    manifest_path = OUT / 'manifest.json'
    old = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {}
    got = lines()
    want, moods = got['lines'], got['moods']
    old_moods = old.get('moods', {})
    manifest = {'voices': {l: voice_label(VOICES[l]) for l in VOICES}, 'moods': moods}
    for lang, entries in want.items():
        v = VOICES[lang]
        (OUT / lang).mkdir(parents=True, exist_ok=True)
        # (a new voice: every line of the language again)
        same_voice = old.get('voices', {}).get(lang) == manifest['voices'][lang]
        done = old.get(lang, {}) if same_voice else {}
        manifest[lang] = {}
        for cid, text in entries.items():
            mp3 = OUT / lang / f'{cid}.mp3'
            manifest[lang][cid] = text
            mood = moods.get(cid, 'lively')
            # (a line whose text or mood changed is recorded again)
            if v['engine'] == 'elevenlabs':
                # (always: a pick changed on the takes page is installed too)
                before = mp3.read_bytes() if mp3.exists() else b''
                elevenlabs(cid, text, mood, v, mp3)
                if mp3.read_bytes() == before:
                    continue
            else:
                if not redo and done.get(cid) == text and old_moods.get(cid, 'lively') == mood and mp3.exists():
                    continue
                record(text, v, mp3, mood)
            print(f'{lang}/{cid}.mp3  [{mood}] "{text}"')
        # clips of lines that are gone
        for f in (OUT / lang).glob('*.mp3'):
            if f.stem not in entries:
                f.unlink()
                print(f'removed {lang}/{f.name}')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(f"manifest: {manifest_path.relative_to(ROOT)}  (Portuguese: {manifest['voices']['pt']})")


if __name__ == '__main__':
    main()

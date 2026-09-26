"""Record the game's spoken lines (G9).

Every line comes from src/i18n (via tools/voice-lines.ts), is spoken by the
language's voice and saved as a small MP3 in
public/audio/voice/<lang>/<id>.mp3, silence trimmed from both ends and
loudness-matched, with public/audio/voice/manifest.json listing the text each
clip says and the voice that said it (tools/check-i18n.ts fails on a clip
that no longer matches its dictionary text). Only new or changed lines are
recorded; a language whose voice changed is recorded again in full.

Voices:
  pt  Microsoft's pt-PT-RaquelNeural (Portuguese, Portugal), through
        - Azure AI Speech when AZURE_SPEECH_KEY (and AZURE_SPEECH_REGION,
          default westeurope) are set: the licensed route, whose audio is
          yours to publish (the free F0 tier covers these few lines), or
        - edge-tts otherwise (`pip install edge-tts`): the same voice through
          Microsoft Edge's read-aloud service, no account needed.
  en  Piper's en_GB-cori-medium (British English; LibriVox recordings, public
      domain), offline: downloaded once into .voices/ (git-ignored, ~63 MB).

Needs: Python 3.10+, ffmpeg on the PATH, Node (npx), `pip install piper-tts`
(English), and edge-tts or an Azure key (Portuguese).
Run from the repository root:  python tools/make-voice.py  [--all]
"""
import asyncio
import json
import os
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
    'pt': {'engine': 'microsoft', 'name': 'pt-PT-RaquelNeural', 'lang': 'pt-PT'},
    'en': {'engine': 'piper', 'name': 'en_GB-cori-medium', 'folder': 'en/en_GB/cori/medium'},
}
# a touch slower than the voices' own pace: the listeners are four
PIPER_LENGTH_SCALE = 1.12
MS_RATE = '-10%'


# ---- Microsoft (Azure, or edge-tts) ----
def microsoft_route() -> str:
    return 'azure' if os.environ.get('AZURE_SPEECH_KEY') else 'edge-tts'


def microsoft(text: str, v: dict, out: Path) -> None:
    if microsoft_route() == 'azure':
        region = os.environ.get('AZURE_SPEECH_REGION', 'westeurope')
        ssml = (f"<speak version='1.0' xml:lang='{v['lang']}'><voice name='{v['name']}'>"
                f"<prosody rate='{MS_RATE}'>{escape(text)}</prosody></voice></speak>")
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
        asyncio.run(edge_tts.Communicate(text, v['name'], rate=MS_RATE).save(str(out)))


# ---- Piper (offline) ----
_piper = {}


def piper(text: str, v: dict, out: Path) -> None:
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
    cfg = SynthesisConfig(length_scale=PIPER_LENGTH_SCALE)
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


def record(text: str, v: dict, mp3: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / ('raw.wav' if v['engine'] == 'piper' else 'raw.mp3')
        (piper if v['engine'] == 'piper' else microsoft)(text, v, raw)
        # silence off both ends (the Microsoft voices trail ~1 s of it), then
        # a mono MP3, loudness-matched so every line plays as loud
        trim = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,'
                'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,'
                'loudnorm=I=-16:TP=-1.5')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(raw), '-af', trim,
                        '-ac', '1', '-ar', '24000', '-b:a', '48k', str(mp3)], check=True)


def voice_label(v: dict) -> str:
    return f"{v['name']} ({microsoft_route()})" if v['engine'] == 'microsoft' else f"{v['name']} (piper)"


def lines() -> dict:
    res = subprocess.run('npx tsx tools/voice-lines.ts', cwd=ROOT, shell=True,
                         capture_output=True, check=True)
    return json.loads(res.stdout.decode('utf-8'))


def main() -> None:
    redo = '--all' in sys.argv
    manifest_path = OUT / 'manifest.json'
    old = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {}
    want = lines()
    manifest = {'voices': {l: voice_label(VOICES[l]) for l in VOICES}}
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
            if not redo and done.get(cid) == text and mp3.exists():
                continue
            record(text, v, mp3)
            print(f'{lang}/{cid}.mp3  "{text}"')
        # clips of lines that are gone
        for f in (OUT / lang).glob('*.mp3'):
            if f.stem not in entries:
                f.unlink()
                print(f'removed {lang}/{f.name}')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(f"manifest: {manifest_path.relative_to(ROOT)}  (Portuguese via {microsoft_route()})")


if __name__ == '__main__':
    main()

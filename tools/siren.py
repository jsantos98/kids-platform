"""A European two-tone siren, built rather than generated (G11): ElevenLabs'
sirens came out as irregular warbles that never looped. A real hi-lo siren
is two electronic tones, so this makes exactly that — a horn-like wave (odd
harmonics, a little even for the horn's bite, gently saturated) through a
speaker's band, with a quick glide at each tone change and a small room — as
a loop that repeats sample-exactly: the frequencies are nudged so the loop
holds a whole number of wave cycles, and every filter works circularly on the
whole loop, so the end runs into the start with no seam at all.

    build(lo, hi, tone, cycles, sr=44100) -> mono float samples
"""
import numpy as np


def _circular_smooth(x: np.ndarray, width: int) -> np.ndarray:
    k = np.zeros(len(x))
    half = width // 2
    k[:half + 1] = 1
    k[-half:] = 1
    k /= k.sum()
    return np.real(np.fft.ifft(np.fft.fft(x) * np.fft.fft(k)))


def build(lo: float, hi: float, tone: float, cycles: int, sr: int = 44100) -> np.ndarray:
    n_tone = int(round(tone * sr))
    n = cycles * 2 * n_tone
    # the pitch: lo, hi, lo, hi … with a ~20 ms glide at every change (the wrap included)
    f = np.tile(np.concatenate([np.full(n_tone, lo), np.full(n_tone, hi)]), cycles).astype(np.float64)
    f = _circular_smooth(f, int(0.02 * sr))
    # a whole number of wave cycles over the loop: scale the pitch a hair
    turns = f.sum() / sr
    f *= round(turns) / turns
    phase = 2 * np.pi * np.cumsum(f) / sr
    wave = sum(np.sin(h * phase) / h for h in (1, 3, 5, 7, 9, 11)) + 0.18 * np.sin(2 * phase)
    # the speaker: a band round ~1.6 kHz, rolled off below 300 Hz and above 6 kHz
    spec = np.fft.rfft(wave)
    fr = np.fft.rfftfreq(n, 1 / sr)
    band = np.exp(-0.5 * (np.log2(np.maximum(fr, 1) / 1600) / 1.3) ** 2)
    band *= 1 / (1 + (300 / np.maximum(fr, 1)) ** 4) / (1 + (fr / 6000) ** 4)
    wave = np.fft.irfft(spec * band, n)
    wave = np.tanh(2.2 * wave / (np.abs(wave).max() + 1e-9)) / np.tanh(2.2)
    # a small room: circular convolution with a short decaying noise tail
    rng = np.random.default_rng(7)
    tail = int(0.35 * sr)
    ir = np.zeros(n)
    ir[0] = 1
    ir[1:tail] = rng.standard_normal(tail - 1) * np.exp(-np.arange(1, tail) / (0.08 * sr)) * 0.05
    wave = np.real(np.fft.ifft(np.fft.fft(wave) * np.fft.fft(ir)))
    return (wave / (np.abs(wave).max() + 1e-9) * 0.9).astype(np.float32)

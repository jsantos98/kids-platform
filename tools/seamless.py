"""Make a recorded loop seamless (G11): find where the sound's own pattern
repeats best — a siren's hi-lo, an engine's rhythm — cut the loop there, a
whole number of cycles, and blend the join with a short crossfade from what
follows the cut into the start. A generated "loop" isn't reliably one: the
sirens' two-tone cycle didn't fit their 4 s, and some ended quieter than they
began, so every repeat broke the pattern or jumped in level.

    loop_points(x, sr) -> (L, score)    x: mono float samples
    make_seamless(x, sr) -> y, score    y: the loop (a sound without a clear
                                        pattern keeps its whole length)
"""
import numpy as np

HOP_S = 0.01
CROSS_S = 0.06


def _features(x: np.ndarray, sr: int) -> np.ndarray:
    """per 10 ms: loudness (dB) and the dominant pitch (log Hz, 150–3000 Hz)"""
    hop = int(HOP_S * sr)
    win = hop * 4
    w = np.hanning(win)
    freqs = np.fft.rfftfreq(win, 1 / sr)
    band = (freqs > 150) & (freqs < 3000)
    rows = []
    for i in range(0, len(x) - win, hop):
        seg = x[i:i + win] * w
        spec = np.abs(np.fft.rfft(seg))
        f = freqs[band][np.argmax(spec[band])]
        rows.append((20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-6), np.log2(f)))
    feat = np.array(rows)
    return (feat - feat.mean(0)) / (feat.std(0) + 1e-6)


def loop_points(x: np.ndarray, sr: int, min_s: float = 1.5) -> tuple[int, float]:
    """the loop length (samples) whose continuation best matches the start"""
    f = _features(x, sr)
    ref = int(0.6 / HOP_S)                     # the first 0.6 s of pattern
    tail = int((CROSS_S + 0.05) / HOP_S)       # keep room past the cut for the crossfade
    best, best_k = -9.0, None
    for k in range(int(min_s / HOP_S), len(f) - ref - tail):
        a, b = f[:ref], f[k:k + ref]
        score = float(np.mean(a * b))          # (standardized features: ~correlation)
        # (prefer the longer loop among near-equals: fewer repeats heard)
        if score > best + 0.02 or (score > best - 0.02 and best_k is not None and k > best_k and score >= best):
            best, best_k = max(score, best), k
    hop = int(HOP_S * sr)
    L = best_k * hop
    # refine to the sample: the waveform right after L most like the start
    n = int(0.02 * sr)
    seg = x[:n]
    lo, hi = max(n, L - hop), min(len(x) - n - int(CROSS_S * sr) - 1, L + hop)
    cand = [(float(np.dot(seg, x[j:j + n])) / (np.linalg.norm(x[j:j + n]) * np.linalg.norm(seg) + 1e-9), j) for j in range(lo, hi)]
    L = max(cand)[1] if cand else L
    return L, best


#: below this, a sound has no clear repeating pattern (birdsong, a hose's
#: hiss, a propeller's drone): keep all of it — a short cut of it would be
#: heard repeating — and only crossfade the join
RHYTHMIC = 0.6


def make_seamless(x: np.ndarray, sr: int) -> tuple[np.ndarray, float]:
    L, score = loop_points(x, sr)
    cf = int(CROSS_S * sr)
    if score < RHYTHMIC:
        L = len(x) - cf - 1
    y = x[:L].copy()
    t = np.linspace(0, np.pi / 2, cf)
    # the loop's start fades from what follows the cut (so the wrap from
    # y[L-1] continues as x did) into the true start — equal power
    y[:cf] = x[:cf] * np.sin(t) + x[L:L + cf] * np.cos(t)
    return y, score

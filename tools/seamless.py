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


def fix_seam(y: np.ndarray, sr: int, ms: float = 12) -> np.ndarray:
    """ease away any leftover step where the loop wraps: the difference
    between its first sample and where its last would continue to, spread
    over the last `ms` as a gentle ramp"""
    k = int(ms / 1000 * sr)
    y = y.astype(np.float64).copy()
    want = 2 * y[-1] - y[-2]                  # where the last sample was heading
    step = y[0] - want
    y[-k:] += step * np.linspace(0, 1, k) ** 2
    return y.astype(np.float32)


def level(y: np.ndarray, rms_db: float = -20.0, peak: float = 0.89) -> np.ndarray:
    """one constant gain to a loudness (RMS dBFS), kept under a peak — no
    resampling (ffmpeg's loudnorm resamples to 192 kHz, which isn't
    loop-aware and clicked at the seam)"""
    r = float(np.sqrt(np.mean(y.astype(np.float64) ** 2))) + 1e-9
    g = min(10 ** (rms_db / 20) / r, peak / (float(np.abs(y).max()) + 1e-9))
    return (y * g).astype(np.float32)


def resample_loop(y: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    """resample a loop circularly (in the frequency domain), so its seam stays one"""
    n_out = int(round(len(y) * sr_out / sr_in))
    spec = np.fft.rfft(y.astype(np.float64))
    out = np.zeros(n_out // 2 + 1, complex)
    m = min(len(out), len(spec))
    out[:m] = spec[:m]
    return (np.fft.irfft(out, n_out) * n_out / len(y)).astype(np.float32)


"""Make a generated music track loop (G12). A generated track has a start and
an end — a lead-in, a last chord, a fade — so it can't simply repeat, and
tools/seamless.py's loudness-and-pitch match is made for engines and sirens,
not for chords. Here: find the stretch [a, b) where the music at b carries on
as it did at a — the same harmony and the same sound over several seconds
(which lands b − a on a whole number of bars) — as long as possible, skip
what comes before a and after b, and crossfade the join.

    find_loop(x, sr) -> (a, b, score)   x: (n, channels) float samples
    make_loop(x, sr) -> (y, a, b, score)
"""
import numpy as np

HOP = 1024
#: how long the music after the cut must match the music after the loop's
#: start (s) — long enough to span a couple of bars
MATCH_S = 5.0
#: the join's crossfade (s)
CROSS_S = 0.4
#: how much worse a match a longer loop may have and still be taken
LONG_SLACK = 0.07


def _features(mono: np.ndarray, sr: int) -> np.ndarray:
    """per hop: chroma (the harmony, 12 pitch classes) and 8 band energies (the
    sound), each standardized over the track"""
    win = HOP * 4
    w = np.hanning(win)
    freqs = np.fft.rfftfreq(win, 1 / sr)
    ok = (freqs > 55) & (freqs < 5000)
    pc = np.zeros(len(freqs), int)
    pc[ok] = np.round(12 * np.log2(freqs[ok] / 440.0)).astype(int) % 12
    edges = np.geomspace(40, 12000, 9)
    band = np.digitize(freqs, edges) - 1
    rows = []
    for i in range(0, len(mono) - win, HOP):
        s = np.abs(np.fft.rfft(mono[i:i + win] * w)) ** 2
        chroma = np.bincount(pc[ok], weights=s[ok], minlength=12)
        chroma = chroma / (chroma.sum() + 1e-12)
        bands = np.array([s[band == k].sum() for k in range(8)])
        rows.append(np.concatenate([chroma, 0.5 * np.log10(bands + 1e-9)]))
    f = np.array(rows)
    f = (f - f.mean(0)) / (f.std(0) + 1e-9)
    return f / (np.linalg.norm(f, axis=1, keepdims=True) + 1e-9)


def find_loop(x: np.ndarray, sr: int, min_s: float = 12.0) -> tuple[int, int, float]:
    mono = x.mean(1) if x.ndim > 1 else x
    f = _features(mono, sr)
    n = len(f)
    W = int(MATCH_S * sr / HOP)
    tail = int((CROSS_S + 0.2) * sr / HOP)
    S = f @ f.T
    # (the loop starts after a lead-in, in the first third; it ends before
    # the last seconds, where a track winds down)
    a_max = n // 3
    end_max = n - W - tail - int(2.0 * sr / HOP)
    cands = []                                # (match, start frame, lag) per loop length
    for lag in range(int(min_s * sr / HOP), end_max):
        d = np.diagonal(S, lag)               # d[i] = S[i, i + lag]
        c = np.concatenate([[0], np.cumsum(d)])
        m = (c[W:] - c[:-W]) / W              # mean over the window from i
        hi = min(a_max, end_max - lag, len(m) - 1)
        if hi < 1:
            continue
        i = int(np.argmax(m[1:hi + 1])) + 1   # (never frame 0: no lead-in to skip there)
        cands.append((float(m[i]), i, lag))
    # the LONGEST loop that matches nearly as well as the best: a short one is
    # heard repeating (the best match alone picked 15 s loops out of 90 s)
    top = max(c[0] for c in cands)
    good = [c for c in cands if c[0] >= max(top - LONG_SLACK, 0.7)] or [max(cands)]
    _, i, lag = max(good, key=lambda c: c[2])
    a, b = i * HOP, (i + lag) * HOP
    # refine b to the sample: the waveform right after b most like that after a
    k = int(0.03 * sr)
    ref = mono[a:a + k]
    lo, hi = b - HOP, b + HOP
    cand = [(float(np.dot(ref, mono[j:j + k])) / (np.linalg.norm(mono[j:j + k]) * np.linalg.norm(ref) + 1e-9), j) for j in range(lo, hi)]
    b = max(cand)[1]
    return a, b, float(np.diagonal(S, lag)[i:i + W].mean())


def make_loop(x: np.ndarray, sr: int) -> tuple[np.ndarray, int, int, float]:
    a, b, score = find_loop(x, sr)
    cf = int(CROSS_S * sr)
    y = x[a:b].copy()
    t = np.linspace(0, np.pi / 2, cf)[:, None]
    # the loop's head fades from what followed the cut into the true start,
    # so the wrap from its last sample carries on as the track did (equal power)
    y[:cf] = x[a:a + cf] * np.sin(t) + x[b:b + cf] * np.cos(t)
    return y, a, b, score

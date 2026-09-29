"""LiveX AI City — procedural score + sound design engine.

Everything you hear is synthesised here from first principles (oscillators,
filtered noise, convolution reverb) so the soundtrack is exactly as
deterministic and frame-accurate as the picture.

Instruments are plain functions that *add* into stereo buses. A score
(score.py) places them on the timeline; mix() renders the stems.
"""
import numpy as np
from scipy import signal
from numba import njit

SR = 48000
DUR = 60.0
N = int(SR * DUR)
rng = np.random.default_rng(20260929)


def T(sec):
    return int(round(sec * SR))


def note(n):
    """'D4' / 'F#5' / 'Bb3' -> Hz (A4 = 440)."""
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    k = names[n[0]]
    i = 1
    if n[1] in '#b':
        k += 1 if n[1] == '#' else -1
        i = 2
    octv = int(n[i:])
    return 440.0 * 2 ** ((k + 12 * (octv + 1) - 69) / 12)


class Bus:
    def __init__(self, name):
        self.name = name
        self.x = np.zeros((2, N), dtype=np.float64)

    def add(self, t0, sig, gain=1.0, pan=0.0):
        """Add mono (n,) or stereo (2,n) signal at time t0 (s). pan in [-1, 1]."""
        i0 = T(t0)
        if i0 >= N:
            return
        if sig.ndim == 1:
            l = np.cos((pan + 1) * np.pi / 4)
            r = np.sin((pan + 1) * np.pi / 4)
            sig = np.vstack([sig * l, sig * r]) * np.sqrt(2)
        n = min(sig.shape[1], N - max(i0, 0))
        s0 = max(0, -i0)
        i0 = max(0, i0)
        if n - s0 <= 0:
            return
        self.x[:, i0:i0 + n - s0] += sig[:, s0:n] * gain


# ------------------------------------------------------------------ helpers
def env_adsr(n, a=0.01, d=0.1, s=0.7, r=0.2, sr=SR):
    a_, d_, r_ = int(a * sr), int(d * sr), int(r * sr)
    s_ = max(0, n - a_ - d_ - r_)
    e = np.concatenate([
        np.linspace(0, 1, max(a_, 1), endpoint=False) ** 1.5,
        np.linspace(1, s, max(d_, 1), endpoint=False),
        np.full(s_, s),
        np.linspace(s, 0, max(r_, 1)) ** 1.3,
    ])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))


def expdecay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def lp(x, fc, order=2):
    b, a = signal.butter(order, min(fc, SR * 0.45) / (SR / 2), 'low')
    return signal.lfilter(b, a, x, axis=-1)


def hp(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), 'high')
    return signal.lfilter(b, a, x, axis=-1)


def bp(x, f1, f2, order=2):
    b, a = signal.butter(order, [f1 / (SR / 2), min(f2, SR * 0.45) / (SR / 2)], 'band')
    return signal.lfilter(b, a, x, axis=-1)


def svf_sweep(x, f_start, f_end, q=0.7, mode='lp'):
    """Time-varying state-variable filter (Chamberlin), exponential sweep."""
    n = len(x)
    f = f_start * (f_end / f_start) ** (np.arange(n) / max(n - 1, 1))
    F = 2 * np.sin(np.pi * np.minimum(f, SR * 0.2) / SR)
    return _svf(np.ascontiguousarray(x, dtype=np.float64), F, 1.0 / q, {'lp': 0, 'bp': 1, 'hp': 2}[mode])


@njit(cache=True)
def _svf(x, F, k, mode):
    n = len(x)
    y = np.zeros(n)
    low = 0.0
    band = 0.0
    for i in range(n):
        high = x[i] - low - k * band
        band += F[i] * high
        low += F[i] * band
        y[i] = low if mode == 0 else (band if mode == 1 else high)
    return y


def noise(n):
    return rng.standard_normal(n)


def pink(n):
    w = rng.standard_normal(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return signal.lfilter(b, a, w) * 3.5


def brown(n):
    y = np.cumsum(rng.standard_normal(n))
    y = hp(y, 20)
    return y / (np.abs(y).max() + 1e-9)


# ------------------------------------------------------------------ reverb
def make_ir(seconds=2.5, predelay=0.02, damp=4000, early=True, seed=1):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    for ch in range(2):
        tail = r.standard_normal(n) * np.exp(-6.9 * t / seconds)
        # frequency-dependent decay: progressively darker tail
        dark = lp(tail, damp * 0.35)
        mixk = np.clip(t / seconds * 1.4, 0, 1)
        tail = tail * (1 - mixk) + dark * mixk
        ir[ch] = tail
    if early:
        for k in range(12):
            d = int((predelay + r.uniform(0.004, 0.06)) * SR)
            ir[:, d] += r.uniform(-0.6, 0.6, 2)
    pd = int(predelay * SR)
    ir = np.pad(ir, ((0, 0), (pd, 0)))[:, :n]
    return ir / np.sqrt((ir ** 2).sum(axis=1, keepdims=True))


def convolve(x, ir):
    y = np.zeros_like(x)
    for ch in range(2):
        y[ch] = signal.fftconvolve(x[ch], ir[ch])[:x.shape[1]]
    return y


# ------------------------------------------------------------------ instruments
def felt_piano(freq, dur=3.5, vel=0.8):
    """Muted felt piano: inharmonic partials, per-partial decay, soft hammer."""
    n = T(dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    B = 0.0004
    for k in range(1, 12):
        fk = freq * k * np.sqrt(1 + B * k * k)
        if fk > 9000:
            break
        amp = (1 / k ** 1.25) * (0.6 + 0.4 * vel)
        tau = 1.6 / (1 + 0.45 * k)
        det = 1 + (0.0007 * (k % 3 - 1))
        y += amp * np.sin(2 * np.pi * fk * det * t + rng.uniform(0, 6.28)) * np.exp(-t / tau)
    ham = lp(noise(T(0.03)), 1800) * expdecay(T(0.03), 0.006) * 0.25
    y[:len(ham)] += ham
    y *= env_adsr(n, a=0.004, d=0.1, s=1, r=0.25)
    return lp(y, 2400 + 2600 * vel) * 0.35


def glass(freq, dur=4.0, vel=0.8, bright=1.0):
    """FM glass/bell — Lyra's voice in the music."""
    n = T(dur)
    t = np.arange(n) / SR
    idx = (1.6 * bright) * np.exp(-t / 0.25) + 0.25
    mod = np.sin(2 * np.pi * freq * 3.5 * t)
    car = np.sin(2 * np.pi * freq * t + idx * mod)
    car += 0.3 * np.sin(2 * np.pi * freq * 2.0 * t + 0.5 * idx * mod) * np.exp(-t / 0.6)
    y = car * np.exp(-t / (dur * 0.35)) * env_adsr(n, a=0.002, d=0.05, s=1, r=0.4)
    return y * 0.22 * vel


def saw(freq, n, phase=0.0):
    t = np.arange(n) / SR
    ph = (freq * t + phase) % 1.0
    # polyBLEP-lite: soften with slight lowpass later
    return 2 * ph - 1


def pad(freqs, dur, attack=1.2, release=2.0, cutoff=(600, 1800), vol=0.12, width=0.8):
    """Warm detuned pad (3 saws/voice), slow filter motion, wide stereo."""
    n = T(dur)
    L = np.zeros(n)
    R = np.zeros(n)
    for f in freqs:
        for j, cents in enumerate((-7, 0, 7)):
            ff = f * 2 ** (cents / 1200)
            s = saw(ff, n, rng.uniform())
            p = (j - 1) * width
            L += s * np.cos((p + 1) * np.pi / 4)
            R += s * np.sin((p + 1) * np.pi / 4)
    e = env_adsr(n, a=attack, d=0.5, s=0.9, r=release)
    c0, c1 = cutoff
    L = svf_sweep(L * e, c0, c1, q=0.8)
    R = svf_sweep(R * e, c0 * 1.03, c1 * 0.97, q=0.8)
    return np.vstack([L, R]) * vol / max(1, len(freqs))


def sub(freq, dur, vol=0.35, attack=0.02, release=0.2, drive=1.2):
    n = T(dur)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * freq * t) + 0.18 * np.sin(4 * np.pi * freq * t)
    y = np.tanh(drive * y) / np.tanh(drive)
    return y * env_adsr(n, a=attack, d=0.05, s=1, r=release) * vol


def kick(vol=0.9, pitch=(115, 44), tau=0.32, click=0.35):
    n = T(0.9)
    t = np.arange(n) / SR
    f = pitch[1] + (pitch[0] - pitch[1]) * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / tau)
    c = hp(noise(T(0.012)), 2500) * expdecay(T(0.012), 0.003) * click
    y[:len(c)] += c
    return np.tanh(y * 1.4) * vol


def rim(freq=900, vol=0.25, q=18):
    """Organic wood click (resonant bandpassed impulse)."""
    n = T(0.25)
    x = np.zeros(n)
    x[0] = 1
    x[1:40] += noise(39) * 0.2
    w0 = freq / (SR / 2)
    b, a = signal.iirpeak(w0, q)
    y = signal.lfilter(b, a, x) * expdecay(n, 0.05)
    return y / (np.abs(y).max() + 1e-9) * vol


def hat(vol=0.12, tau=0.035, open_=False):
    n = T(0.4 if open_ else 0.12)
    y = hp(noise(n), 7000) * expdecay(n, 0.12 if open_ else tau)
    return y * vol


def shaker(vol=0.08, dur=0.14):
    n = T(dur)
    e = np.sin(np.pi * np.linspace(0, 1, n)) ** 3
    return bp(noise(n), 4000, 11000) * e * vol


def clap(vol=0.3):
    n = T(0.5)
    y = np.zeros(n)
    for k, d in enumerate((0, 0.009, 0.019, 0.028)):
        m = T(0.4)
        seg = bp(noise(m), 900, 5000) * expdecay(m, 0.012 if k < 3 else 0.12)
        i = T(d)
        y[i:i + m] += seg[:n - i]
    return y * vol


def riser(dur, vol=0.25, f0=300, f1=9000):
    n = T(dur)
    x = noise(n)
    y = svf_sweep(x, f0, f1, q=2.5, mode='bp')
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * np.cumsum(80 * (8 ** (t / dur))) / SR) * 0.3
    e = (t / dur) ** 2.2
    return (y + tone) * e * vol


def boom(vol=0.8, f0=62, f1=28, tau=2.2):
    n = T(4.0)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.5)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tau)
    y += lp(noise(n), 400) * np.exp(-t / 0.35) * 0.35
    return np.tanh(y * 1.3) * vol


def whoosh(dur=0.9, vol=0.3, f0=500, f1=5000, pan_from=-0.8, pan_to=0.8):
    n = T(dur)
    x = noise(n)
    y = svf_sweep(x, f0, f1, q=1.2, mode='bp')
    e = np.sin(np.pi * np.linspace(0, 1, n) ** 0.7) ** 2
    y = y * e * vol
    p = np.linspace(pan_from, pan_to, n)
    return np.vstack([y * np.cos((p + 1) * np.pi / 4), y * np.sin((p + 1) * np.pi / 4)]) * np.sqrt(2)


def reverse_swell(dur=1.2, freq=440, vol=0.2):
    g = glass(freq, dur, 0.9)
    return g[::-1] * np.linspace(0, 1, len(g)) ** 2 * vol * 4


def ui_tick(freq=2600, vol=0.18):
    n = T(0.06)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t) * expdecay(n, 0.012) * vol


def ui_confirm(f1=1760, f2=2637, vol=0.14):
    a = ui_tick(f1, vol)
    b = ui_tick(f2, vol)
    y = np.zeros(T(0.2))
    y[:len(a)] += a
    y[T(0.07):T(0.07) + len(b)] += b
    return y


def heel(vol=0.25, bright=3000):
    n = T(0.18)
    t = np.arange(n) / SR
    y = bp(noise(n), 250, bright) * expdecay(n, 0.018)
    y += np.sin(2 * np.pi * 180 * t) * expdecay(n, 0.02) * 0.4
    return y * vol


def breath(dur=1.4, vol=0.05):
    n = T(dur)
    e = np.sin(np.pi * np.linspace(0, 1, n)) ** 2
    return bp(pink(n), 400, 2500) * e * vol


# ------------------------------------------------------------------ ambience beds
def room_tone(dur, vol=0.03):
    n = T(dur)
    return lp(pink(n), 900) * vol


def crowd(dur, vol=0.05, seed=3):
    n = T(dur)
    r = np.random.default_rng(seed)
    y = np.zeros(n)
    for k in range(10):
        v = bp(r.standard_normal(n), 250 + k * 60, 900 + k * 180)
        am = lp(np.abs(r.standard_normal(n)), 3 + k * 0.5)
        y += v * am / (am.max() + 1e-9)
    return y / (np.abs(y).max() + 1e-9) * vol


def city_bed(dur, vol=0.06):
    n = T(dur)
    rumble = lp(brown(n), 180) * 1.2
    air = bp(pink(n), 800, 6000) * 0.15
    return (rumble + air) * vol


def stadium_bed(dur, vol=0.08):
    return crowd(dur, vol, seed=11) + lp(pink(T(dur)), 400) * vol * 0.4


# ------------------------------------------------------------------ mix
def compress(x, thresh=0.35, ratio=3.0, attack=0.01, release=0.15):
    lvl = np.abs(x).max(axis=0)
    env = _follow(lvl, np.exp(-1 / (attack * SR)), np.exp(-1 / (release * SR)))
    gain = np.ones_like(env)
    over = env > thresh
    gain[over] = (thresh + (env[over] - thresh) / ratio) / env[over]
    return x * gain


def sidechain(x, times, depth=0.6, release=0.28):
    """Duck a bus on each kick time (musical pumping, very gentle)."""
    g = np.ones(x.shape[1])
    for t in times:
        i = T(t)
        n = T(release)
        if i >= len(g):
            continue
        seg = 1 - depth * (1 - np.linspace(0, 1, n)) ** 2
        m = min(n, len(g) - i)
        g[i:i + m] = np.minimum(g[i:i + m], seg[:m])
    return x * g


@njit(cache=True)
def _follow(lvl, a, r):
    env = np.zeros_like(lvl)
    e = 0.0
    for i in range(len(lvl)):
        v = lvl[i]
        if v > e:
            e = a * e + (1 - a) * v
        else:
            e = r * e + (1 - r) * v
        env[i] = e
    return env


@njit(cache=True)
def _release(need, r):
    g = np.empty_like(need)
    cur = 1.0
    for i in range(len(need)):
        if need[i] < cur:
            cur = need[i]
        else:
            cur = r * cur + (1 - r) * need[i]
        g[i] = cur
    return g


def limiter(x, ceiling=0.93, look=0.004, release=0.08):
    from scipy.ndimage import maximum_filter1d
    peak = np.abs(x).max(axis=0)
    pk = maximum_filter1d(peak, size=T(look) * 2 + 1)
    need = np.minimum(1.0, ceiling / np.maximum(pk, 1e-9))
    return x * _release(need, np.exp(-1 / (release * SR)))


# ------------------------------------------------------------------ place sounds (foley / ambience)
def elevator_ding(vol=0.18, f=1318.5):
    n = T(1.6)
    t = np.arange(n) / SR
    y = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.2)) * np.exp(-t / 0.55)
    return y * vol


def pa_chime(vol=0.14, notes=('C5', 'E5', 'G5')):
    """Three-tone public-address chime (airport / hospital)."""
    y = np.zeros(T(2.4))
    for i, n in enumerate(notes):
        s = glass(note(n), 1.6, 0.5, bright=0.3)
        i0 = T(i * 0.42)
        y[i0:i0 + len(s)] += s[:len(y) - i0]
    return y * vol * 4


def suitcase(dur=2.0, vol=0.05):
    n = T(dur)
    t = np.arange(n) / SR
    clicks = np.zeros(n)
    for k in np.arange(0, dur, 0.105):
        i = T(k + rng.uniform(-0.004, 0.004))
        if i < n - 200:
            clicks[i:i + 200] += bp(noise(200), 600, 3000) * expdecay(200, 0.002)
    rumble = lp(noise(n), 220) * 0.6
    return (clicks + rumble) * vol * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.4


def monitor_beep(vol=0.06, f=880):
    n = T(0.12)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t) * env_adsr(n, 0.005, 0.02, 0.8, 0.04) * vol


def auto_door(dur=1.2, vol=0.08):
    n = T(dur)
    x = svf_sweep(noise(n), 300, 1200, q=0.9, mode='bp')
    e = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5
    return x * e * vol


def rain_bed(dur, vol=0.05):
    n = T(dur)
    base = hp(pink(n), 1200) * 0.7
    drops = np.zeros(n)
    for _ in range(int(dur * 180)):
        i = rng.integers(0, n - 300)
        drops[i:i + 300] += bp(noise(300), 2500, 9000) * expdecay(300, 0.001) * rng.uniform(0.2, 1)
    return (base + drops) * vol


def wind_bed(dur, vol=0.04):
    n = T(dur)
    return svf_sweep(pink(n), 250, 700, q=1.5, mode='bp') * (0.6 + 0.4 * np.sin(np.linspace(0, 3.3, n))) * vol


def cheer(dur=3.0, vol=0.12):
    n = T(dur)
    y = crowd(dur, 1.0, seed=21) + bp(noise(n), 1500, 6000) * 0.25
    e = np.minimum(1, np.linspace(0, 1, n) * 4) * np.exp(-np.linspace(0, 1, n) * 1.2)
    return y * e * vol


def bus_bell(vol=0.16):
    n = T(0.9)
    t = np.arange(n) / SR
    y = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((1450, 1), (2310, 0.5), (3920, 0.25))) * np.exp(-t / 0.25)
    return y * vol


def heartbeat(vol=0.3):
    a = kick(1.0, pitch=(70, 38), tau=0.12, click=0.0)
    b = kick(0.7, pitch=(65, 36), tau=0.12, click=0.0)
    y = np.zeros(T(0.9))
    y[:len(a)] += a[:len(y)]
    i = T(0.22)
    y[i:i + len(b)] += b[:len(y) - i]
    return lp(y, 140) * vol


def page_flip(vol=0.08):
    n = T(0.35)
    return bp(noise(n), 1500, 8000) * (np.sin(np.pi * np.linspace(0, 1, n)) ** 3) * vol


def lowpass_world(x, t0, t1, f0=300, f1=18000):
    """'Clarity is belonging': open a low-pass on a bus from f0 to f1 between t0-t1."""
    i0, i1 = T(t0), T(t1)
    y = x.copy()
    for ch in range(2):
        seg = x[ch, :i1]
        n = len(seg)
        f = np.full(n, f0, dtype=float)
        ramp = np.clip((np.arange(n) - i0) / max(i1 - i0, 1), 0, 1)
        f = f0 * (f1 / f0) ** ramp
        F = 2 * np.sin(np.pi * np.minimum(f, SR * 0.2) / SR)
        y[ch, :i1] = _svf(np.ascontiguousarray(seg), F, 1 / 0.7, 0)
    return y

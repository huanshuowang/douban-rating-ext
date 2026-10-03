"""Synthesised score + sound design for the reel, locked to the visual timeline (120 BPM, grid anchored at 5.0s)."""
import numpy as np, wave, sys

SR = 48000
DUR = 29.5
N = int(SR * DUR)
rng = np.random.default_rng(1)

music = np.zeros((2, N))   # ducked by the kick
drums = np.zeros((2, N))
sfx = np.zeros((2, N))
send = np.zeros((2, N))    # reverb send


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def add(bus, sig, t, gain=1.0, pan=0.0, rev=0.0):
    if sig.ndim == 1:
        sig = np.stack([sig, sig])
    i = int(round(t * SR))
    if i < 0:
        sig = sig[:, -i:]; i = 0
    n = min(sig.shape[1], N - i)
    if n <= 0:
        return
    a = (pan + 1) * np.pi / 4
    g = np.array([np.cos(a), np.sin(a)]) * np.sqrt(2) * gain
    bus[:, i:i + n] += sig[:, :n] * g[:, None]
    if rev:
        send[:, i:i + n] += sig[:, :n] * g[:, None] * rev


def fft_filter(x, curve):
    """curve(freqs) -> gain, applied on the whole buffer"""
    n = len(x)
    m = 1 << int(np.ceil(np.log2(n + 1)))
    X = np.fft.rfft(x, m)
    f = np.fft.rfftfreq(m, 1 / SR)
    return np.fft.irfft(X * curve(f), m)[:n]


def hp(fc, order=2):
    return lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1)) ** (2 * order))


def lp(fc, order=2):
    return lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order))


def bp(fc, q_oct=1.0):
    return lambda f: np.exp(-0.5 * (np.log2(np.maximum(f, 1) / fc) / (q_oct / 2)) ** 2)


def env_ad(n, a, d, curve=4.0):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-6), np.exp(-(t - a) / d * curve / 4))
    return e


def sweep_noise(dur, f0, f1, q_oct=1.2, seed=0, shape=None):
    """noise through a band-pass whose centre glides f0 -> f1 (log), STFT overlap-add"""
    n = int(dur * SR)
    x = np.random.default_rng(seed).standard_normal(n)
    win, hop = 1024, 256
    w = np.hanning(win)
    pad = np.concatenate([np.zeros(win), x, np.zeros(win)])
    out = np.zeros_like(pad); nrm = np.zeros_like(pad)
    fr = np.fft.rfftfreq(win, 1 / SR)
    for s in range(0, len(pad) - win, hop):
        p = np.clip((s - win / 2) / max(n, 1), 0, 1)
        if shape:
            p = shape(p)
        fc = f0 * (f1 / f0) ** p
        g = np.exp(-0.5 * (np.log2(np.maximum(fr, 1) / fc) / (q_oct / 2)) ** 2)
        y = np.fft.irfft(np.fft.rfft(pad[s:s + win] * w) * g) * w
        out[s:s + win] += y; nrm[s:s + win] += w * w
    return (out / np.maximum(nrm, 1e-3))[win:win + n]


def norm(x):
    return x / (np.max(np.abs(x)) + 1e-9)


# ---------------------------------------------------------------- instruments
def saw_add(freq, dur, cutoff, detune_cents=(0,), phase_seed=0, kmax=60):
    t = tt(dur)
    r = np.random.default_rng(phase_seed)
    out = np.zeros(len(t))
    for dc in detune_cents:
        f = freq * 2 ** (dc / 1200)
        ph = r.uniform(0, 2 * np.pi)
        for k in range(1, kmax + 1):
            fk = f * k
            if fk > 16000:
                break
            g = (1 / k) / np.sqrt(1 + (fk / cutoff) ** 4)
            if g < 2e-4:
                break
            out += g * np.sin(2 * np.pi * fk * t + ph * k)
    return out / len(detune_cents)


def pad_chord(notes, dur, cutoff=1800, att=0.25, rel=0.6, seed=0):
    sig = np.zeros((2, int(dur * SR)))
    for j, m in enumerate(notes):
        for ch, det in enumerate([(-9, 4), (-4, 9)]):
            sig[ch] += saw_add(mtof(m), dur, cutoff, det, phase_seed=seed * 31 + j * 7 + ch)
    n = sig.shape[1]
    t = np.arange(n) / SR
    e = np.minimum(1, t / att) * np.minimum(1, (dur - t) / rel)
    return sig * np.clip(e, 0, 1) / len(notes)


def pluck(m, dur=0.35, cutoff=3200, dec=0.12):
    t = tt(dur)
    s = saw_add(mtof(m), dur, cutoff, (-5, 5), phase_seed=m, kmax=18)
    s += 0.5 * np.sin(2 * np.pi * mtof(m) * t)
    return s * np.exp(-t / dec) * np.minimum(1, t / 0.003)


def bass_note(m, dur):
    t = tt(dur)
    f = mtof(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * saw_add(f, dur, 600, (0,), kmax=10)
    e = np.minimum(1, t / 0.006) * np.exp(-t / (dur * 0.9))
    return s * e


def kick(big=False):
    d = 0.9 if big else 0.42
    t = tt(d)
    f = 46 + 130 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t / (0.32 if big else 0.16))
    click = rng.standard_normal(len(t)) * np.exp(-t / 0.002) * 0.35
    s = s + fft_filter(click, hp(1500))
    if big:
        s += 0.6 * np.sin(2 * np.pi * 38 * t) * np.exp(-t / 0.5) * np.minimum(1, t / 0.01)
    return np.tanh(s * 1.6)


def clap():
    t = tt(0.4)
    n = rng.standard_normal(len(t))
    e = np.zeros(len(t))
    for o in (0, 0.011, 0.022):
        e += (t >= o) * np.exp(-np.maximum(t - o, 0) / 0.008)
    e += (t >= 0.03) * np.exp(-np.maximum(t - 0.03, 0) / 0.09)
    s = fft_filter(n * e, bp(1400, 1.6)) * 2.2
    s += 0.25 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)
    return s


def hat(open_=False, seed=0):
    d = 0.25 if open_ else 0.06
    t = tt(d)
    n = np.random.default_rng(seed).standard_normal(len(t))
    return fft_filter(n, hp(7500, 3)) * np.exp(-t / (0.08 if open_ else 0.016))


def crash(dur=2.2, seed=3):
    t = tt(dur)
    n = np.random.default_rng(seed).standard_normal((2, len(t)))
    s = np.stack([fft_filter(n[c], hp(3500, 2)) for c in range(2)])
    ring = sum(np.sin(2 * np.pi * f * t) for f in (3810, 5120, 6470, 7930)) * 0.05
    return (s + ring) * np.exp(-t / 0.55) * np.minimum(1, t / 0.002)


def bell(m, dur=1.6, bright=1.0):
    t = tt(dur)
    f = mtof(m)
    parts = [(1, 1, 1.0), (2.0, .6, .7), (2.76, .35, .45), (5.4, .2 * bright, .25), (8.93, .1 * bright, .15)]
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (d * dur * .6)) for r, a, d in parts)
    return s * np.minimum(1, t / 0.002)


def pop(f0=900, f1=380, d=0.09):
    t = tt(d + 0.05)
    f = f1 + (f0 - f1) * np.exp(-t / 0.018)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (d / 3)) * np.minimum(1, t / 0.001)


def tick(f=4200, d=0.012):
    t = tt(d * 4)
    return np.sin(2 * np.pi * f * t) * np.exp(-t / d) + 0.4 * fft_filter(rng.standard_normal(len(t)), hp(5000)) * np.exp(-t / 0.002)


def ui_click():
    t = tt(0.06)
    s = fft_filter(rng.standard_normal(len(t)), bp(2600, 1.2)) * np.exp(-t / 0.004) * 2
    s += 0.6 * np.sin(2 * np.pi * 1800 * t) * np.exp(-t / 0.008)
    return s


def key_click(seed):
    t = tt(0.05)
    r = np.random.default_rng(seed)
    s = fft_filter(r.standard_normal(len(t)), bp(r.uniform(2200, 3600), 1.4)) * np.exp(-t / 0.005)
    s += 0.3 * np.sin(2 * np.pi * r.uniform(180, 260) * t) * np.exp(-t / 0.012)
    return s


def whoosh(dur, f0, f1, seed=0, rise=True):
    s = np.stack([sweep_noise(dur, f0, f1, 1.3, seed + c) for c in range(2)])
    p = np.linspace(0, 1, s.shape[1])
    e = (p ** 2.2 if rise else np.sin(np.pi * p) ** 1.5)
    if rise:
        e *= np.minimum(1, (1 - p) / 0.03 + 0.0)
        e = np.clip(e, 0, 1)
    return s * e


def swish(dur=0.22, seed=0):
    s = sweep_noise(dur, 1800, 6500, 1.0, seed)
    p = np.linspace(0, 1, len(s))
    return s * np.sin(np.pi * p) ** 2


def riser_tone(dur, f0, f1):
    t = tt(dur)
    p = t / dur
    f = f0 * (f1 / f0) ** (p ** 1.6)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) + 0.3 * np.sin(2 * ph + .3) + 0.15 * np.sin(3.01 * ph)
    return s * p ** 2.5


def boom(dur=1.4, f=42):
    t = tt(dur)
    fr = f + 60 * np.exp(-t / 0.06)
    s = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.45)
    n = fft_filter(rng.standard_normal(len(t)), lp(900)) * np.exp(-t / 0.12) * 0.5
    return np.tanh((s + n) * 1.8)


def buzz(dur=0.34):
    t = tt(dur)
    s = np.zeros(len(t))
    for f in (196, 207.6):
        for k in (1, 3, 5, 7, 9):
            s += np.sin(2 * np.pi * f * k * t) / k
    trem = 0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 18 * t))
    e = np.minimum(1, t / 0.005) * np.minimum(1, (dur - t) / 0.04)
    return fft_filter(s * trem * e, lp(2500)) * 0.5


# ---------------------------------------------------------------- arrangement
BEAT = 0.5
G0 = 5.0                       # grid anchor (the drop)
CH = {                          # pad voicings / bass roots
    'A': ([64, 69, 71, 73, 76], 45),
    'E': ([64, 68, 71, 75, 76], 40),
    'F#m': ([61, 64, 66, 69, 73], 42),
    'D': ([62, 66, 69, 71, 74], 38),
}
BARS = [(5, 'A'), (7, 'E'), (9, 'F#m'), (11, 'D'), (13, 'A'), (15, 'E'), (17, 'F#m'), (19, 'D'), (21, 'A'), (23, 'E'), (25, 'D')]
FINAL = 26.75

# ---- intro (0 - 5): dark drone, clock, tension
t = tt(5.0)
dr = (np.sin(2 * np.pi * 55 * t) * 0.5 + np.sin(2 * np.pi * 82.4 * t) * 0.25 + 0.2 * saw_add(55, 5.0, 300, (-6, 6), kmax=12))
dr *= np.minimum(1, t / 1.2) * np.clip((4.85 - t) / 0.05, 0, 1)
add(music, fft_filter(dr, lp(400)), 0, 0.2)
air = np.stack([fft_filter(np.random.default_rng(9 + c).standard_normal(len(t)), bp(700, 2.0)) for c in range(2)])
add(sfx, air * np.minimum(1, t / 2) * np.clip((4.85 - t) / 0.05, 0, 1), 0, 0.05)
clock = [i * 0.5 for i in range(4)] + [2.0 + i * 0.25 for i in range(6)] + [3.5 + i * 0.125 for i in range(10)]
for i, c in enumerate(clock):
    if c < 4.8:
        add(drums, tick(5200 if i % 2 else 3900, 0.008), c, 0.22 + 0.15 * c / 5, pan=(-0.3 if i % 2 else 0.3))
for i in range(12):                                        # typing
    add(sfx, key_click(i), 0.1 + (i + 1) * 0.52 / 12 - 0.01, 0.35, pan=0.1 * np.sin(i))
add(sfx, whoosh(0.3, 300, 3000, 11), 0.72, 0.25)           # into the question
add(sfx, boom(1.2, 44), 1.0, 0.6, rev=0.25)
add(sfx, crash(1.4, 5), 1.0, 0.08, rev=0.2)
add(sfx, swish(0.3, 2), 1.5, 0.25)
for i, (ts, m) in enumerate([(2.0, 57), (2.5, 60), (3.0, 63), (3.5, 66)]):   # windows pop: rising, uneasy
    add(music, pluck(m, 0.6, 1800, 0.18) + 0.5 * pluck(m + 6, 0.6, 1800, 0.18), ts, 0.45, pan=-0.5 + i * 0.33, rev=0.35)
    add(sfx, pop(700 + i * 120, 300, 0.08), ts, 0.35)
for i, ts in enumerate([2.32, 2.38]):
    add(sfx, key_click(40 + i) * 1.6, ts, 0.5)
for i in range(4):
    add(sfx, key_click(60 + i), 3.08 + (i + 1) * 0.07, 0.3, pan=0.3)
for i in range(3):
    add(sfx, pop(1300, 800, 0.05), 3.6 + i * 0.06, 0.15, pan=0.5)
add(sfx, buzz(), 3.75, 0.55, rev=0.2)
add(sfx, boom(0.6, 60), 3.75, 0.5)
add(sfx, sweep_noise(0.25, 6000, 1500, 1.0, 21) * np.exp(-tt(0.25) / 0.08), 4.02, 0.6)
# implosion: reverse swell + riser, hard stop at 4.85
rv = whoosh(1.4, 200, 9000, 31)
rv[:, int(1.35 * SR):] = 0
add(sfx, rv, 3.45, 0.55, rev=0.1)
rz = riser_tone(1.85, 180, 1400)
rz[int(1.8 * SR):] = 0
add(music, rz, 3.0, 0.12)
add(sfx, bell(93, 0.6, 1.5), 4.62, 0.12, rev=0.5)

# ---- the drop
add(drums, kick(True), G0, 1.0)
add(sfx, boom(1.8, 36), G0, 0.65, rev=0.2)
add(drums, crash(2.6, 7), G0, 0.32, rev=0.25)
for i, m in enumerate([81, 85, 88, 93, 97, 100]):          # sparkle burst
    add(sfx, bell(m, 1.0, 1.2), G0 + 0.03 + i * 0.045, 0.09, pan=-0.6 + i * 0.24, rev=0.6)

# ---- pads, bass, arps
for k, (bt, name) in enumerate(BARS):
    notes, root = CH[name]
    end = FINAL if k == len(BARS) - 1 else bt + 2.0
    dur = end - bt + 0.35
    cut = 1400 if bt < 8 else 2300
    add(music, pad_chord(notes, dur, cut, 0.08 if k else 0.02, 0.35, seed=k), bt, 0.55, rev=0.3)
    # bass: pumping 8ths on the off-beat; half-time feel before 8.0
    steps = np.arange(bt, end - 1e-6, 0.25)
    for s in steps:
        if s < 8.0 and (s - G0) % 1.0 != 0.5:
            continue
        if s >= 8.0 and (s - G0) % 0.5 == 0:
            continue
        add(music, bass_note(root + (12 if (s - G0) % 2 > 1.4 else 0), 0.22), s, 0.55)
    # arp 16ths from 8.0
    if bt >= 7:
        seq = [notes[0] + 12, notes[2] + 12, notes[1] + 12, notes[3] + 12, notes[2] + 12, notes[4], notes[1] + 12, notes[3]]
        for j, s in enumerate(np.arange(max(bt, 8.0), end - 1e-6, 0.125)):
            add(music, pluck(seq[j % 8], 0.3, 3800, 0.09), s, 0.13, pan=0.35 * (1 if j % 2 else -1), rev=0.25)

# ---- drums 5.0 .. 26.5
for b in range(int((26.5 - G0) / BEAT)):
    s = G0 + b * BEAT
    full = s >= 8.0
    breakdown = 17.75 <= s < 18.5
    if s > G0 and not breakdown and (full or (s - G0) % 1.0 == 0):
        add(drums, kick(), s, 0.85)
    if full and not breakdown and (s - G0) % 1.0 == 0.5:
        add(drums, clap(), s, 0.5, rev=0.15)
    if s >= 6.0 and not breakdown:
        add(drums, hat(False, b), s + 0.25, 0.22, pan=0.25)
        if full:
            add(drums, hat(False, b + 500), s + 0.125, 0.08, pan=-0.3)
            add(drums, hat(False, b + 900), s + 0.375, 0.08, pan=-0.3)
for i in range(8):                                          # snare fill into the lockup
    add(drums, clap(), 26.0 + i * 0.0625, 0.15 + i * 0.05, rev=0.1)

# ---- scene sound design
add(sfx, whoosh(0.5, 400, 5000, 41), 5.32, 0.18)            # title rises
add(sfx, swish(0.3, 3), 6.5, 0.2)                           # marker
add(sfx, whoosh(0.6, 300, 7000, 43, rise=False), 7.3, 0.45, rev=0.15)   # logo flies to the icon
add(sfx, pop(1500, 900, 0.05), 7.93, 0.25)
add(sfx, ui_click(), 9.0, 0.9)
for i, s in enumerate([9.22, 9.32]):
    add(sfx, sweep_noise(0.18, 5000, 1800, 1.0, 50 + i) * np.exp(-tt(0.18) / 0.06), s, 0.35)
add(sfx, swish(0.22, 6), 9.4, 0.22)
add(sfx, pop(1100, 600, 0.07), 9.55, 0.35)
add(sfx, pop(700, 260, 0.12), 9.62, 0.6)
add(sfx, whoosh(0.4, 900, 5000, 47, rise=False), 9.72, 0.25)
add(sfx, tick(3000, 0.01), 10.08, 0.35)
for i in range(16):                                         # score counts up
    tt_ = 10.38 + 0.62 * (1 - (1 - (i + 1) / 16) ** (1 / 3)) - 0.02
    add(sfx, tick(2400 + i * 160, 0.006), tt_, 0.22, pan=0.4)
add(sfx, bell(88, 1.4), 11.0, 0.22, pan=0.3, rev=0.5)
add(sfx, bell(93, 1.4), 11.04, 0.14, pan=0.3, rev=0.5)
add(sfx, pop(1200, 700, 0.06), 10.95, 0.3)
add(sfx, pop(1000, 600, 0.06), 10.62, 0.25)
for i in range(4):
    add(sfx, pop(900 + i * 90, 500, 0.05), 11.6 + i * 0.07, 0.2, pan=-0.6)
    add(sfx, sweep_noise(0.12, 5000, 2000, 1.0, 60 + i) * np.exp(-tt(0.12) / 0.04), 12.0 + i * 0.06, 0.18, pan=-0.6)
add(sfx, pop(800, 380, 0.1), 12.35, 0.45, pan=-0.5)
add(sfx, ui_click(), 13.4, 0.8)
add(sfx, whoosh(0.55, 250, 8000, 71), 13.45, 0.5)
add(drums, crash(2.4, 11), 14.0, 0.3, rev=0.3)
add(sfx, boom(1.0, 50), 14.0, 0.45)
add(sfx, whoosh(0.5, 600, 5000, 73, rise=False), 14.7, 0.35)
for i in range(3):
    add(sfx, swish(0.2, 80 + i), 14.92 + i * 0.09, 0.12, pan=0.5)
scan = sweep_noise(0.75, 600, 4000, 0.6, 90)
add(sfx, scan * np.sin(np.pi * np.linspace(0, 1, len(scan))), 15.35, 0.22, pan=0.4)
for s, m in [(15.46, 76), (15.8, 81), (16.02, 85)]:
    add(sfx, pop(1000, 500, 0.06), s, 0.3, pan=0.4)
    add(music, bell(m, 0.7, 0.8), s, 0.07, pan=0.4, rev=0.3)
add(sfx, whoosh(0.45, 900, 5000, 93, rise=False), 16.2, 0.25)
add(sfx, pop(700, 280, 0.11), 16.55, 0.55)
for i in range(14):
    tt_ = 16.62 + 0.53 * (1 - (1 - (i + 1) / 14) ** (1 / 3)) - 0.02
    add(sfx, tick(2400 + i * 170, 0.006), tt_, 0.2, pan=0.2)
add(sfx, bell(88, 1.2), 17.15, 0.2, rev=0.5)
add(sfx, whoosh(0.4, 500, 4000, 97, rise=False), 17.35, 0.25)
add(sfx, whoosh(1.4, 120, 9000, 99, rise=False), 17.8, 0.5, rev=0.2)      # zoom out
glit = np.stack([fft_filter(np.random.default_rng(101 + c).standard_normal(int(0.9 * SR)), hp(6000)) for c in range(2)])
grain = (np.random.default_rng(5).random(glit.shape[1]) > 0.9985).astype(float)
grain = np.convolve(grain, np.exp(-np.arange(200) / 30), 'same')
add(sfx, glit * grain * np.sin(np.pi * np.linspace(0, 1, glit.shape[1])), 17.92, 0.6)
for i in range(7):                                         # slot machine
    s = 18.62 + i * 0.25
    add(sfx, tick(3200, 0.01), s, 0.4)
    add(sfx, swish(0.18, 120 + i), s - 0.04, 0.12)
    add(music, pluck([69, 71, 73, 76, 78, 80, 81][i] + 12, 0.25, 4000, 0.07), s, 0.18, rev=0.3)
add(drums, crash(2.2, 13), 20.1, 0.32, rev=0.3)
add(sfx, boom(0.9, 55), 20.1, 0.4)
add(music, pad_chord([69, 73, 76, 81], 0.9, 3000, 0.005, 0.5, seed=77), 20.1, 0.45, rev=0.4)
add(sfx, swish(0.35, 140), 20.2, 0.25)
add(sfx, whoosh(0.42, 300, 9000, 151), 21.6, 0.6)            # whip pan
add(sfx, boom(0.9, 50), 22.0, 0.55)
add(drums, crash(1.6, 17), 22.0, 0.2)
for i, m in enumerate([57, 61, 64, 69]):                    # stats land
    s = 22.45 + i * 0.22
    add(sfx, boom(0.4, 70 + i * 10), s, 0.35)
    add(music, pluck(m + 12, 0.5, 3000, 0.15), s, 0.3, rev=0.3)
    for j in range(5):
        add(sfx, tick(3000 + j * 300, 0.004), s + j * 0.07, 0.08)
add(sfx, whoosh(0.4, 600, 4000, 171, rise=False), 24.05, 0.3)
add(sfx, boom(0.7, 60), 24.52, 0.3)
add(sfx, swish(0.25, 180), 24.6, 0.2)
add(sfx, ui_click(), 25.32, 0.9)
add(sfx, bell(81, 1.0), 25.45, 0.18, rev=0.4)
add(sfx, bell(88, 1.2), 25.55, 0.18, rev=0.4)
for i in range(3):
    add(sfx, pop(900 + i * 150, 450, 0.06), 25.5 + i * 0.2, 0.3)
rz = riser_tone(0.5, 300, 2400)
add(music, rz, 26.25, 0.12)
add(sfx, whoosh(0.5, 300, 9000, 191), 26.25, 0.5)

# ---- final hit + tail
add(drums, kick(True), FINAL, 1.0)
add(sfx, boom(2.4, 34), FINAL, 0.7, rev=0.2)
add(drums, crash(3.2, 23), FINAL, 0.35, rev=0.35)
add(music, pad_chord([57, 64, 69, 71, 73, 76, 81], DUR - FINAL, 2600, 0.01, 2.2, seed=99), FINAL, 0.8, rev=0.45)
add(music, bass_note(33, 2.6) * 1.2, FINAL, 0.6)
for i, m in enumerate([81, 85, 88, 93, 97]):
    add(sfx, bell(m, 2.2, 1.0), FINAL + 0.02 + i * 0.06, 0.1, pan=-0.5 + i * 0.25, rev=0.6)
add(sfx, bell(100, 1.6, 1.6), 26.95, 0.07, pan=0.2, rev=0.7)    # logo shine
add(sfx, pop(800, 400, 0.08), 27.35, 0.25)

# ---------------------------------------------------------------- mix
tline = np.arange(N) / SR
kicks = [G0 + b * BEAT for b in range(int((26.5 - G0) / BEAT)) if not (17.75 <= G0 + b * BEAT < 18.5) and (G0 + b * BEAT >= 8.0 or b % 2 == 0)]
duck = np.ones(N)
for k in kicks:
    i = int(k * SR)
    n = int(0.3 * SR)
    seg = 1 - 0.55 * np.exp(-np.arange(n) / SR / 0.09)
    duck[i:i + n] = np.minimum(duck[i:i + n], seg[:max(0, min(n, N - i))])
music *= duck

# reverb: stereo exponentially decaying noise IR
ir_len = int(2.4 * SR)
ti = np.arange(ir_len) / SR
irs = []
for c in range(2):
    ir = np.random.default_rng(200 + c).standard_normal(ir_len) * np.exp(-ti / 0.55)
    ir = fft_filter(ir, lp(5500, 1))
    ir[:int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    irs.append(ir / np.sqrt(np.sum(ir ** 2)))
m = 1 << int(np.ceil(np.log2(N + ir_len)))
wet = np.stack([np.fft.irfft(np.fft.rfft(send[c], m) * np.fft.rfft(irs[c], m), m)[:N] for c in range(2)])

mix = music * 0.9 + drums * 0.8 + sfx * 0.85 + wet * 0.55
# gentle master: low-end tidy + soft clip + fade
mix = np.stack([fft_filter(mix[c], hp(28, 2)) for c in range(2)])
mix = mix / (np.percentile(np.abs(mix), 99.97) + 1e-9) * 0.9
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
fade = np.clip((DUR - tline) / 0.8, 0, 1) * np.clip(tline / 0.02, 0, 1)
mix *= fade
mix = mix / np.max(np.abs(mix)) * 0.93

out = sys.argv[1] if len(sys.argv) > 1 else 'score.wav'
pcm = (mix.T * 32767).astype(np.int16)
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote', out, mix.shape)

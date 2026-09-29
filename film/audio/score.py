"""LiveX AI City — 60 s score. 120 BPM, 4/4, one bar = 2.0 s.

Form (bar numbers 1-based; sections land on bar lines):
  A  0-10   bars 1-5    Human      D minor. Felt piano, room, breath. Space.
  B 10-20   bars 6-10   Lyra       Glass motif (minor: F-A-D). Soft sub pulse. UI ticks.
  C 20-28   bars 11-14  Reveal     Boom. Wide pad swell Bbmaj9 -> F/A. No drums: float.
  D 28-42   bars 15-21  Journey    Half-time organic groove: kick, wood, shaker, bass.
                                   The glass motif returns at every new place: same AI.
  E 42-52   bars 22-26  City       Drive: 16th hats, clap, bass pulse, filter opens. Riser.
  F 52-60   bars 27-30  AI City    Silence -> boom -> D MAJOR bloom. Motif in major = sonic logo.

The harmonic arc is the story: minor (alone, unfamiliar) -> major (connected).
Picture-sync cues live in cues.json (written by the edit); defaults below.
"""
import json
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from synth import *  # noqa

HERE = os.path.dirname(__file__)
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT


def b(bar, beat=0.0):
    """time of bar (1-based) + beat offset (0-based, may be fractional)."""
    return (bar - 1) * BAR + beat * BEAT


# ------------------------------------------------------------------ cues from the edit
CUES = {
    'lyra_hello': 10.5,       # first time Lyra speaks
    'ui': [12.2, 13.4, 15.1, 16.3, 17.6],   # UI arrivals in the first interaction
    'reveal': 20.0,           # pull-back begins / boom
    'places': [28.0, 31.5, 35.0, 38.5],     # new place, new node: glass motif returns
    'cuts_city': [42.0, 43.0, 44.0, 45.0, 46.0, 47.0, 48.0, 49.0, 50.0, 51.0],
    'silence': 51.75,
    'finale': 52.0,
    'logo': 56.0,
    'end_tick': 57.5,
}
cf = os.path.join(HERE, 'cues.json')
if os.path.exists(cf):
    CUES.update(json.load(open(cf)))

# ------------------------------------------------------------------ buses
music = {k: Bus(k) for k in ('piano', 'glass', 'pad', 'bass', 'drums', 'perc', 'fx')}
sfx = {k: Bus(k) for k in ('amb', 'foley', 'ui', 'trans')}

# ================================================================== A · Human (0-10)
piano_A = [(0.6, 'A3', 0.55), (1.0, 'D4', 0.5), (2.6, 'F4', 0.6), (4.4, 'E4', 0.5), (5.6, 'C4', 0.45),
           (6.9, 'D4', 0.55), (7.4, 'A3', 0.4), (8.8, 'F4', 0.45)]
for t, n, v in piano_A:
    music['piano'].add(t, felt_piano(note(n), 4.5, v), 0.9, pan=-0.15)
music['bass'].add(3.0, sub(note('D1'), 7.5, vol=0.16, attack=3.0, release=1.5))
music['fx'].add(0.0, breath(1.6, 0.05), pan=0.1)
music['fx'].add(6.2, breath(1.4, 0.04), pan=0.1)

# ================================================================== B · Lyra (10-20)
h = CUES['lyra_hello']
for i, n in enumerate(['F5', 'A5', 'D6']):
    music['glass'].add(h + i * 0.25 * BEAT * 2, glass(note(n), 4.0, 0.8), 0.9, pan=[-0.3, 0.0, 0.3][i])
# Dm9 bed, then Bbmaj7 at bar 9
music['pad'].add(b(6), pad([note(x) for x in ('D3', 'F3', 'A3', 'C4', 'E4')], 6.5, attack=2.0, release=1.8, cutoff=(300, 1200), vol=0.10))
music['pad'].add(b(9), pad([note(x) for x in ('Bb2', 'D3', 'F3', 'A3', 'C4')], 4.4, attack=1.2, release=1.2, cutoff=(500, 1500), vol=0.10))
# heartbeat sub pulse on beats 1 and 3, bars 7-10
kicks_soft = [b(bar, bt) for bar in range(7, 11) for bt in (0, 2)]
for t in kicks_soft:
    music['drums'].add(t, kick(0.35, pitch=(80, 42), tau=0.28, click=0.05))
for t, n in [(b(7, 1.5), 'A4'), (b(8, 0.5), 'D5'), (b(8, 2.5), 'C5'), (b(9, 1), 'A4'), (b(10, 0), 'F4')]:
    music['piano'].add(t, felt_piano(note(n), 3.0, 0.45), 0.7, pan=0.2)
music['fx'].add(18.0, riser(2.0, vol=0.22, f0=400, f1=7000), pan=0)
music['fx'].add(18.8, reverse_swell(1.2, note('A5'), 0.18))

# ================================================================== C · Reveal (20-28)
R = CUES['reveal']
music['fx'].add(R, boom(0.85, 60, 30, 2.4))
music['pad'].add(R, pad([note(x) for x in ('Bb1', 'F2', 'Bb2', 'D3', 'F3', 'A3', 'C4')], 4.4, attack=0.25, release=1.8, cutoff=(700, 3200), vol=0.16, width=1.0))
music['pad'].add(R + 4.0, pad([note(x) for x in ('A1', 'F2', 'A2', 'C3', 'E3', 'G3')], 4.4, attack=0.6, release=1.6, cutoff=(900, 2600), vol=0.14, width=1.0))
for i, n in enumerate(['A5', 'D6', 'E6']):
    music['glass'].add(R + 0.5 + i * 0.5, glass(note(n), 5.0, 0.7, bright=0.8), 0.8, pan=[-0.4, 0.4, 0.0][i])
for t, n in [(R + 0.0, 'D3'), (R + 1.5, 'A3'), (R + 2.0, 'F4'), (R + 4.0, 'C4'), (R + 5.5, 'E4'), (R + 6.0, 'A4')]:
    music['piano'].add(t, felt_piano(note(n), 4.0, 0.6), 0.8, pan=-0.1)
music['bass'].add(R, sub(note('Bb1'), 4.0, vol=0.22, attack=0.05, release=0.5))
music['bass'].add(R + 4.0, sub(note('A1'), 4.0, vol=0.2, attack=0.2, release=0.3))
for k, t in enumerate([b(14, 0), b(14, 1), b(14, 1.75), b(14, 2.5), b(14, 3), b(14, 3.5)]):
    music['perc'].add(t, rim(1100 if k % 2 else 820, 0.14 + k * 0.02), pan=0.3 if k % 2 else -0.3)
music['fx'].add(26.8, reverse_swell(1.2, note('D5'), 0.2))

# ================================================================== D · Journey (28-42)
kicks_D = []
prog_D = [('D', ['D3', 'F3', 'A3', 'C4', 'E4'], 'D2'), ('D', ['D3', 'F3', 'A3', 'C4', 'E4'], 'D2'),
          ('Bb', ['Bb2', 'D3', 'F3', 'A3'], 'Bb1'), ('F', ['A2', 'C3', 'F3', 'A3', 'E4'], 'F2'),
          ('C', ['G2', 'C3', 'E3', 'G3', 'D4'], 'C2'), ('Bb', ['Bb2', 'D3', 'F3', 'A3', 'C4'], 'Bb1'),
          ('A', ['A2', 'C#3', 'E3', 'G3', 'Bb3'], 'A1')]
for i, bar in enumerate(range(15, 22)):
    _, chord, root = prog_D[i]
    t0 = b(bar)
    music['pad'].add(t0, pad([note(x) for x in chord], BAR + 0.6, attack=0.08, release=0.5, cutoff=(700, 1600), vol=0.085))
    # kick: 1, 2&, (3), 4& — half-time organic
    for bt in (0, 1.5, 2.75):
        kicks_D.append(t0 + bt * BEAT)
        music['drums'].add(t0 + bt * BEAT, kick(0.7 if bt == 0 else 0.5))
    music['drums'].add(t0 + 2 * BEAT, clap(0.22), pan=0.05)
    # organic top line: wood + shaker 8ths
    for s in range(8):
        music['perc'].add(t0 + s * BEAT / 2, shaker(0.05 + (0.03 if s % 2 else 0)), pan=0.35)
    for bt, f in ((0.75, 1050), (1.25, 780), (3.25, 1300), (3.5, 900)):
        music['perc'].add(t0 + bt * BEAT, rim(f, 0.13), pan=-0.35)
    # bass: 8th pulse with a pickup
    for s in range(8):
        f = note(root) * (2 if s == 7 else 1)
        music['bass'].add(t0 + s * BEAT / 2, sub(f, BEAT / 2 * 0.9, vol=0.22 if s % 2 == 0 else 0.15, attack=0.005, release=0.06, drive=2.0))
    # piano arpeggio, quiet
    arp = [chord[j % len(chord)] for j in (0, 2, 4, 1, 3, 2, 4, 1)]
    for s, n in enumerate(arp):
        music['piano'].add(t0 + s * BEAT / 2, felt_piano(note(n) * 2, 1.2, 0.3), 0.35, pan=0.25)
for t in CUES['places']:
    for i, n in enumerate(['F5', 'A5', 'D6']):
        music['glass'].add(t + i * 0.25, glass(note(n), 3.0, 0.6), 0.7, pan=[-0.3, 0.0, 0.3][i])

# ================================================================== E · City expands (42-52)
kicks_E = []
prog_E = [['D3', 'F3', 'A3', 'C4', 'E4'], ['Bb2', 'D3', 'F3', 'A3', 'C4'], ['F2', 'C3', 'F3', 'A3', 'E4'],
          ['G2', 'C3', 'E3', 'G3', 'D4'], ['A2', 'C#3', 'E3', 'G3', 'Bb3']]
roots_E = ['D2', 'Bb1', 'F2', 'C2', 'A1']
for i, bar in enumerate(range(22, 27)):
    t0 = b(bar)
    energy = 0.6 + i * 0.1
    music['pad'].add(t0, pad([note(x) for x in prog_E[i]], BAR + 0.4, attack=0.05, release=0.4, cutoff=(900 + i * 500, 2400 + i * 900), vol=0.09))
    for bt in (0, 1, 1.75, 2, 3, 3.5):
        if i < 4 or bt < 3.5:
            kicks_E.append(t0 + bt * BEAT)
            music['drums'].add(t0 + bt * BEAT, kick(0.75 if bt in (0, 2) else 0.5))
    for bt in (1, 3):
        music['drums'].add(t0 + bt * BEAT, clap(0.26), pan=0.0)
    for s in range(16):
        music['perc'].add(t0 + s * BEAT / 4, hat(0.05 + (0.04 if s % 4 == 2 else 0) * energy, open_=(s % 8 == 6)), pan=0.3 * np.sin(s))
    for s in range(16):
        f = note(roots_E[i]) * (2 if s % 4 == 3 else 1)
        music['bass'].add(t0 + s * BEAT / 4, sub(f, BEAT / 4 * 0.85, vol=0.2 * energy + 0.05, attack=0.003, release=0.04, drive=2.4))
    for s, n in enumerate([prog_E[i][j % len(prog_E[i])] for j in (0, 2, 4, 2, 1, 3, 4, 3)]):
        music['piano'].add(t0 + s * BEAT / 2, felt_piano(note(n) * 2, 0.9, 0.35 + 0.05 * i), 0.4, pan=-0.25)
for t in CUES['cuts_city']:
    music['glass'].add(t, glass(note('D6'), 1.2, 0.35, bright=0.6), 0.5, pan=0.4 * np.sin(t * 3))
music['fx'].add(49.75, riser(2.0, vol=0.3, f0=300, f1=10000))

# ================================================================== F · AI City (52-60)
F_ = CUES['finale']
music['fx'].add(F_, boom(0.95, 58, 26, 3.0))
music['pad'].add(F_, pad([note(x) for x in ('D2', 'A2', 'D3', 'F#3', 'A3', 'C#4', 'E4', 'F#4')], 8.0, attack=0.15, release=3.0, cutoff=(900, 4200), vol=0.17, width=1.0))
music['bass'].add(F_, sub(note('D1'), 7.8, vol=0.3, attack=0.05, release=2.5))
for t, n in [(F_ + 0.0, 'D3'), (F_ + 0.5, 'A3'), (F_ + 1.0, 'F#4'), (F_ + 2.0, 'E4'), (F_ + 3.0, 'A4')]:
    music['piano'].add(t, felt_piano(note(n), 5.0, 0.6), 0.8)
L = CUES['logo']
for i, n in enumerate(['F#5', 'A5', 'D6']):  # the motif, now in MAJOR: the sonic logo
    music['glass'].add(L + i * 0.25, glass(note(n), 4.5, 0.95, bright=1.1), 1.0, pan=[-0.25, 0.0, 0.25][i])
music['glass'].add(L + 0.5, glass(note('D5'), 4.5, 0.6), 0.6)
music['drums'].add(L + 0.5, kick(0.55, pitch=(90, 38), tau=0.6, click=0.1))
sfx['ui'].add(CUES['end_tick'], ui_confirm(2349, 3520, 0.12))

# ------------------------------------------------------------------ UI sounds for the first interaction
for t in CUES['ui']:
    sfx['ui'].add(t, ui_tick(2400 + 300 * (hash(round(t, 2)) % 3), 0.14), pan=0.1)


def render(out_wav, stems_dir=None, extra=None):
    """extra: callable(sfx) adding picture-specific ambience/foley/transitions."""
    if extra:
        extra(sfx)
    hall = make_ir(3.6, 0.03, 3500, seed=2)
    room = make_ir(1.0, 0.012, 6000, seed=5)
    # sidechain the pad + bass under the kicks (gentle musical pumping)
    for kbus in ('pad', 'bass'):
        music[kbus].x = sidechain(music[kbus].x, kicks_D + kicks_E + kicks_soft, depth=0.35 if kbus == 'pad' else 0.5)
    # sends
    wet = {
        'piano': (0.35, hall), 'glass': (0.55, hall), 'pad': (0.25, hall), 'bass': (0.0, None),
        'drums': (0.12, room), 'perc': (0.25, room), 'fx': (0.3, hall),
    }
    mix_m = np.zeros((2, N))
    for k, bus in music.items():
        amt, ir = wet[k]
        x = bus.x
        if ir is not None and amt > 0:
            x = x + convolve(x, ir) * amt
        mix_m += x
    mix_s = np.zeros((2, N))
    for k, bus in sfx.items():
        x = bus.x
        if k in ('ui', 'trans'):
            x = x + convolve(x, room) * 0.25
        mix_s += x
    master = mix_m * 0.9 + mix_s
    master = hp(master, 25)
    master = compress(master, thresh=0.5, ratio=2.2, attack=0.015, release=0.2)
    master = np.tanh(master * 1.1) / 1.1
    # fades
    fi = T(0.05)
    master[:, :fi] *= np.linspace(0, 1, fi)
    fo = T(1.2)
    master[:, -fo:] *= np.linspace(1, 0, fo) ** 2
    master = limiter(master, 0.9)
    import scipy.io.wavfile as wf
    wf.write(out_wav, SR, (master.T * 32767).astype(np.int16))
    if stems_dir:
        os.makedirs(stems_dir, exist_ok=True)
        for k, bus in {**music, **sfx}.items():
            wf.write(os.path.join(stems_dir, f'{k}.wav'), SR, (np.clip(bus.x.T, -1, 1) * 32767).astype(np.int16))
    return out_wav


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'out', 'score.wav')
    print(render(out))

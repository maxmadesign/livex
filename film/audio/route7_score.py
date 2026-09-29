"""Route 7 — the soundtrack, cut to the picture frame by frame.

120 BPM, 4/4 (bar = 2.0 s). Key of E, from the 1980s bus bell (E6, 1318.5 Hz).
E minor (Dorian colour) while she is lost; E major when the city answers.
00-01.5  1985: mono, tape hiss, diesel idle, indicator, the roller blind.
01.5-10  2026: subway, the flip phone, the new interchange. Felt piano, sub drone.
10-20    Lyra: her three-note glass motif is her voice. UI in paper, wood, glass.
20-27    The reveal: boom, the pad opens, upright bass arrives, the first bell (25.5).
27-42    Half-time journey: brushes, upright bass, bells at every stop, heels at every handoff.
42-52    Full time: the crowd's claps are the drum kit, rain on steel, the split-flap, bells.
52-60    Everything drops out. A hum. Seven bells up the pentatonic. Black. ding—ding.
"""
import os
import sys
import numpy as np
import scipy.io.wavfile as wf

sys.path.insert(0, os.path.dirname(__file__))
from synth import *  # noqa
from synth import _release


def _release_env(need, look=0.004, release=0.08):
    """Smooth a per-sample gain request like the limiter does: instant attack (with lookahead), slow release."""
    from scipy.ndimage import minimum_filter1d
    return _release(minimum_filter1d(need, size=T(look) * 2 + 1), np.exp(-1 / (release * SR)))

E6 = 1318.5
B = {k: Bus(k) for k in ('era', 'amb', 'foley', 'ui', 'trans', 'piano', 'glass', 'pad', 'bass', 'drums', 'perc', 'fx', 'voice', 'rain', 'logo')}
KICKS = []


def chord(names):
    return [note(n) for n in names]


def glass_motif(t, notes=('G5', 'B5', 'E6'), vol=0.7, gap=0.16, bus='glass'):
    for i, n in enumerate(notes):
        B[bus].add(t + i * gap, glass(note(n), 3.5, 0.7), vol, pan=(-0.3, 0.0, 0.3)[i % 3])


def stop_bell(t, vol=0.26, f=E6):
    B['trans'].add(t, bell(f, vol), 1.0, pan=-0.1)


# ================================================================== 00.0–01.5  1985 (mono, lo-fi)
B['era'].add(0.0, tape_hiss(1.55, 0.05))
B['era'].add(0.0, diesel(1.55, 0.2))
for k in range(3):
    B['era'].add(k * 0.5, rim(2200, 0.12, q=30))              # indicator tick, on the grid
    B['era'].add(0.25 + k * 0.5, rim(1700, 0.06, q=30))       # ... tock, 6 dB down
B['era'].add(0.08, ratchet(0.78, 42, 0.16))                   # the blind rolling on its drum
B['era'].add(0.93, clack(0.2))                                # it latches on the 7 (no bells in 1985:
B['era'].add(0.97, rim(900, 0.05, q=12))                      # the first bell is saved for 25.5)

# ================================================================== 01.5–10  2026
B['amb'].add(1.5, lp(brown(T(3.0)), 150) * 0.10)             # subway rumble
B['amb'].add(1.5, rail_clacks(3.0, 0.16, 1.0))
B['foley'].add(1.52, page_flip(0.07), pan=0.2)                # the note in her hand
B['foley'].add(3.1, buzz(0.45, 0.05), pan=0.1)                # the message arrives
B['foley'].add(4.32, snap_shut(0.45), pan=0.05)               # she snaps it shut: the cut
# the interchange: escalator machinery, 3 s concrete reverb of a crowd, a PA chime
B['amb'].add(4.5, room_tone(22.5, 0.02))
B['amb'].add(4.5, crowd(22.5, 0.05, seed=4))
B['amb'].add(4.5, (lp(noise(T(3.0)), 120) * 0.08 + ratchet(3.0, 9, 0.03)) * np.linspace(1, 0.2, T(3.0)))
B['amb'].add(6.2, pa_chime(0.09, ('D5', 'A4')), pan=0.3)
for k, t in enumerate(np.arange(7.3, 9.8, 0.55)):
    B['foley'].add(t, heel(0.07, 1600), pan=-0.1)             # her sneakers, slowing, stopping
# music A: felt piano, sparse, E minor; a sub drone from the moment she's lost
for t, n, v, d in [(1.55, 'E3', 0.5, 4.0), (4.55, 'B2', 0.46, 2.0), (6.0, 'G2', 0.44, 1.8), (7.5, 'B2', 0.4, 1.0), (8.0, 'G2', 0.36, 0.6)]:
    B['piano'].add(t, felt_piano(note(n), d, v), 0.6, pan=-0.12)    # sparse and low: she is lost; silent from 8.5
B['bass'].add(4.5, sub(note('E1'), 6.0, vol=0.12, attack=2.5, release=1.5))
B['voice'].add(8.85, glass(note('B5'), 2.5, 0.45), 0.45, pan=0.2)     # "May I?"

# ================================================================== 10–20  Lyra
B['pad'].add(10.0, pad(chord(['E2', 'B2', 'E3', 'G3', 'B3', 'D4', 'F#4']), 6.4, attack=2.2, release=1.4, cutoff=(300, 1100), vol=0.075))
B['pad'].add(16.0, pad(chord(['C3', 'E3', 'G3', 'B3', 'D4']), 4.4, attack=1.0, release=1.2, cutoff=(500, 1500), vol=0.075))
glass_motif(12.8, vol=0.75)                                            # "Route 7's last stop. I know it."
for t in np.arange(14.0, 20.0, 1.0):
    KICKS.append(t)
    B['drums'].add(t, kick(0.26, pitch=(80, 42), tau=0.26, click=0.03))
for t, n in [(10.6, 'E4'), (11.5, 'D4'), (15.2, 'B3'), (16.6, 'C4'), (18.0, 'G4')]:
    B['piano'].add(t, felt_piano(note(n), 3.0, 0.35), 0.45, pan=0.2)
# UI: pencil -> print (graphite scratch becoming tiny type ticks), card, toggle, arrows
scratch = bp(noise(T(1.3)), 2500, 9000) * (0.5 + 0.5 * lp(np.abs(noise(T(1.3))), 20)) * np.linspace(1, 0, T(1.3)) * 0.05
B['ui'].add(15.3, scratch, pan=-0.2)
for i, t in enumerate(np.arange(15.7, 16.9, 0.09)):
    B['ui'].add(t, rim(3000 + (i % 3) * 220, 0.03, q=22), pan=0.3 * np.sin(i))   # wooden type, not beeps
B['ui'].add(17.62, glass(note('E6'), 0.9, 0.5, bright=0.4), 0.3, pan=0.1)   # the card lands (glass)
B['ui'].add(18.5, rim(1150, 0.16, q=14), pan=0.15)                          # Step-free: a soft wood click
B['ui'].add(19.0, rim(1500, 0.05, q=16), pan=0.3)
B['ui'].add(19.15, rim(1750, 0.04, q=16), pan=0.4)
B['fx'].add(18.5, riser(1.5, vol=0.14, f0=300, f1=5000))

# ================================================================== 20–27  the reveal
B['fx'].add(20.0, boom(0.55, 56, 30, 2.2))
B['pad'].add(20.0, pad(chord(['C2', 'G2', 'C3', 'E3', 'G3', 'B3', 'D4']), 4.3, attack=0.35, release=1.6, cutoff=(700, 3000), vol=0.12, width=1.0))
B['pad'].add(24.0, pad(chord(['B1', 'G2', 'B2', 'D3', 'G3', 'A3']), 3.8, attack=0.6, release=1.4, cutoff=(800, 2400), vol=0.11, width=1.0))
B['bass'].add(20.0, upright(note('C2'), 3.5, 0.28, 0.4))
B['bass'].add(24.0, upright(note('B1'), 3.0, 0.26, 0.4))
for t, n in [(20.5, 'E4'), (21.5, 'G4'), (22.0, 'B4'), (23.5, 'A4'), (24.5, 'G4'), (25.0, 'F#4'), (26.0, 'E4')]:
    B['piano'].add(t, felt_piano(note(n), 3.5, 0.5), 0.6, pan=-0.1)
stop_bell(25.5)                                                            # 05 · Harbour Interchange
B['fx'].add(26.3, reverse_swell(0.7, note('E5'), 0.14))

# ================================================================== 27–42  the journey (half time)
B['trans'].add(27.5, whoosh(0.45, 0.22, 900, 6000, 0.3, -0.9))            # Lyra leaves through the left edge
B['foley'].add(27.6, heel(0.1, 3500), pan=-0.4)
stop_bell(28.0, 0.22)                                                      # → Exit B
B['trans'].add(28.3, whoosh(0.45, 0.2, 6000, 900, 0.9, 0.0))               # ...and arrives through the right
B['foley'].add(28.55, heel(0.1, 3500), pan=0.4)
glass_motif(28.8, vol=0.4, gap=0.12)
stop_bell(30.0)                                                            # 06 · Market Hall
B['trans'].add(30.12, whoosh(0.4, 0.18, 6000, 900, 0.9, 0.0))
B['foley'].add(30.35, heel(0.1, 3500), pan=0.4)
glass_motif(30.7, vol=0.4, gap=0.12)
B['amb'].add(30.0, crowd(3.1, 0.07, seed=8))                               # market murmur, vendors
B['foley'].add(31.9, bp(noise(T(0.5)), 1500, 7000) * np.sin(np.pi * np.linspace(0, 1, T(0.5))) ** 2 * 0.04, pan=0.1)  # fabric
B['amb'].add(33.0, crowd(9.0, 0.06, seed=12))                              # the corridor
choir = choir_muffled(5.0, 0.16)
choir = lowpass_world(np.vstack([choir, choir]), 3.7, 3.9, 380, 16000)     # doors open: 400 Hz -> full band in 6 frames
B['amb'].add(37.2, choir * np.linspace(0.3, 1, choir.shape[1]))
for i, (n, d) in enumerate([('E4', 0.4), ('G4', 0.4), ('B4', 0.4), ('A4', 0.8)]):     # she hums, under her breath
    B['voice'].add(37.5 + i * 0.5, hum(note(n), d + 0.15, 0.07), 1.0, pan=-0.1)
B['fx'].add(39.0, lp(boom(0.3, 52, 30, 1.8), 400))                         # the stadium crown lights, far off
B['amb'].add(39.0, lp(clack(0.12), 900))                                   # ...a contactor thunk across the water
B['fx'].add(41.4, reverse_swell(0.6, note('E5'), 0.12))                    # the breath before the doors
B['amb'].add(40.9, auto_door(1.2, 0.1))
B['amb'].add(41.0, rain_bed(1.0, 0.05) * np.linspace(0, 1, T(1.0)))
prog = [('E', ['E2', 'B2', 'E3', 'G3', 'B3', 'D4']), ('C', ['C3', 'E3', 'G3', 'B3', 'D4']), ('G/B', ['B2', 'D3', 'G3', 'B3', 'D4']),
        ('D', ['A2', 'D3', 'F#3', 'B3', 'E4']), ('E', ['E2', 'B2', 'E3', 'G3', 'B3', 'D4']), ('C', ['C3', 'E3', 'G3', 'B3', 'E4']),
        ('B', ['B1', 'F#2', 'B2', 'D#3', 'A3'])]
roots = ['E1', 'C2', 'B1', 'A1', 'E1', 'C2', 'B1']
for i, bar in enumerate(range(15, 22)):           # bars 15..21 = 28..42 s
    t0 = (bar - 1) * 2.0
    B['pad'].add(t0, pad(chord(prog[i][1]), 2.5, attack=0.1, release=0.5, cutoff=(700, 1500), vol=0.065))
    for bt in (0, 0.75, 1.75):
        KICKS.append(t0 + bt)
        B['drums'].add(t0 + bt, kick(0.5 if bt == 0 else 0.3, pitch=(95, 44), tau=0.3, click=0.08))
    B['drums'].add(t0 + 1.0, brush(0.09, 0.4), pan=0.05)
    B['perc'].add(t0 + 1.0, crowd_clap(0.1, people=12, seed=bar), pan=-0.05)
    for s in range(8):
        B['perc'].add(t0 + s * 0.25, shaker(0.035 + (0.02 if s % 2 else 0)), pan=0.35)
    r = note(roots[i])
    for bt, mult, ln in ((0, 2, 0.9), (0.75, 2, 0.4), (1.25, 3, 0.5), (1.75, 2.5 if i % 2 else 2, 0.3)):
        B['bass'].add(t0 + bt, upright(r * mult, ln + 0.3, 0.22, 0.45))

# ================================================================== 42–52  the city (full time)
stop_bell(42.0)                                                            # 07 · Harbour Depot
B['amb'].add(42.0, steel_rain(10.0, 0.045))
B['foley'].add(43.0, lp(kick(0.2, pitch=(110, 88), tau=0.12, click=0.0), 300), pan=-0.2)   # her palm on the brick
B['amb'].add(42.0, crowd(10.0, 0.06, seed=14))
B['voice'].add(45.05, glass(note('G5'), 2.4, 0.5), 0.5, pan=-0.2)        # "Then you know the way."
B['voice'].add(45.21, glass(note('B5'), 2.4, 0.5), 0.5, pan=0.0)
B['voice'].add(45.37, glass(note('E6'), 3.0, 0.5), 0.5, pan=0.2)
prog_e = [['E2', 'B2', 'E3', 'G3', 'B3', 'D4'], ['C3', 'G3', 'C4', 'E4', 'B3'], ['B2', 'D3', 'G3', 'B3', 'D4'], ['A2', 'D3', 'F#3', 'A3', 'E4'], ['B1', 'F#2', 'B2', 'D#3', 'A3']]
roots_e = ['E1', 'C2', 'B1', 'A1', 'B1']
for i, bar in enumerate(range(22, 27)):           # 42..52
    t0 = (bar - 1) * 2.0
    talk = t0 < 46.0                              # while they speak: kick on 1 and 3, the crowd's claps, the rain
    en = 0.7 + i * 0.08
    if not talk:
        B['pad'].add(t0, pad(chord(prog_e[i]), 2.4, attack=0.05, release=0.4, cutoff=(900 + 300 * i, 2200 + 500 * i), vol=0.07))
    for bt in ((0, 1.0) if talk else (0, 0.75, 1.0, 1.75)):   # then 1, 2&, 3, 4&: syncopated, never four-on-the-floor
        KICKS.append(t0 + bt)
        B['drums'].add(t0 + bt, kick(0.5 if bt in (0, 1.0) else 0.32, pitch=(100, 44), tau=0.26, click=0.1))
    for bt in (0.5, 1.5):
        B['perc'].add(t0 + bt, crowd_clap(0.3 * en, seed=int(t0 * 10 + bt * 4)), pan=0.0)
    if talk:
        continue
    for s in range(16):
        B['perc'].add(t0 + s * 0.125, hat(0.03 + (0.03 if s % 4 == 2 else 0), open_=(s % 8 == 6)), pan=0.25 * np.sin(s))
    r = note(roots_e[i])
    for s in range(16):
        B['bass'].add(t0 + s * 0.125, upright(r * (3 if s % 8 == 7 else 2), 0.2, (0.2 if s % 2 == 0 else 0.13) * en, 0.6))
# 46.5: the back of the node; the split-flap rewinds 07 -> 01
B['trans'].add(46.5, whoosh(0.5, 0.16, 800, 3000, -0.6, 0.6))
for k in range(6):
    B['trans'].add(46.58 + k * 0.06, flap(0.16), pan=0.3)
# the four upstream stops, 0.8 s each: a bell + four frames of the place
for i, (t, amb) in enumerate([(47.0, 'hosp'), (48.0, 'campus'), (49.0, 'hotel'), (50.0, 'office')]):
    stop_bell(t, 0.2)
    if amb == 'hosp':
        B['amb'].add(t + 0.05, monitor_beep(0.05, 988))
    elif amb == 'campus':
        B['amb'].add(t + 0.05, cheer(0.5, 0.09))
    elif amb == 'hotel':
        B['amb'].add(t + 0.05, elevator_ding(0.07, 1760))
    else:
        B['amb'].add(t + 0.05, clack(0.12))
stop_bell(51.0, 0.2)                                                       # → Gate C
B['foley'].add(51.5, clack(0.35))                                          # the turnstile
roar = cheer(2.2, 0.22)
B['amb'].add(51.5, roar)
B['fx'].add(50.6, riser(1.4, vol=0.2, f0=300, f1=9000))

# ================================================================== 52–60  AI City
B['amb'].add(52.0, stadium_bed(8.0, 0.1) * np.concatenate([np.ones(T(0.3)), np.linspace(1, 0.12, T(0.5)), np.full(T(7.2), 0.12)]))
B['fx'].add(52.0, boom(0.4, 62, 28, 1.6))
B['pad'].add(52.0, pad(chord(['E2', 'B2', 'E3', 'G#3', 'B3', 'D#4', 'F#4']), 1.2, attack=0.05, release=0.9, cutoff=(1200, 3200), vol=0.09, width=1.0))
B['bass'].add(52.0, sub(note('E1'), 1.1, vol=0.14, attack=0.02, release=0.6))
for t, n in [(52.0, 'E3'), (52.02, 'B3'), (52.04, 'G#4')]:
    B['piano'].add(t, felt_piano(note(n), 2.5, 0.45), 0.5, pan=0.1)
for t in (53.0, 53.25):                                                    # two taps on the 7 on her chest
    B['foley'].add(t, lp(kick(0.14, pitch=(95, 60), tau=0.09, click=0.0), 260), pan=0.15)
for i, (n, d) in enumerate([('E4', 0.45), ('F#4', 0.45), ('G#4', 0.5), ('B4', 1.2)]):     # her hum: pride
    B['voice'].add(52.6 + i * 0.5, hum(note(n), d + 0.2, 0.09), 1.0, pan=-0.05)
B['amb'].add(54.0, wind_bed(3.0, 0.05))
B['pad'].add(55.2, pad(chord(['E2', 'B2', 'E3', 'G#3', 'B3', 'D#4', 'F#4']), 2.2, attack=0.9, release=0.6, cutoff=(500, 2600), vol=0.08, width=1.0))
B['bass'].add(55.2, sub(note('E1'), 2.0, vol=0.16, attack=0.8, release=0.5))
for i, n in enumerate(['E5', 'F#5', 'G#5', 'B5', 'C#6', 'E6', 'F#6']):   # seven bells along the old route
    B['trans'].add(55.25 + i * 0.25, bell(note(n), 0.13 + i * 0.012, 1.6), 1.0, pan=-0.6 + i * 0.2)
for k in range(24):                                                        # hundreds of nodes, quietly
    t = 56.4 + k * 0.025 + (k % 5) * 0.004
    B['ui'].add(t, glass(note(['E6', 'G#6', 'B6', 'E7'][k % 4]), 0.6, 0.12, bright=0.2), 0.12, pan=np.sin(k * 1.7) * 0.8)
B['rain'].add(56.8, rain_bed(3.2, 0.03) * np.minimum(1, np.linspace(0, 8, T(3.2))))
# the sonic logo: ding (the original bus bell, E6) — ding (glass + steel, B6, a fifth up) + 40 Hz
B['logo'].add(57.9, bell(E6, 0.2, 2.6), 1.0)
logo2 = bell(note('B6'), 0.15, 2.6, metal=0.6) + glass(note('B6'), 2.6, 0.5, bright=0.5)
B['logo'].add(58.2, logo2, 1.0)
t40 = np.arange(T(1.6)) / SR
B['logo'].add(58.2, np.sin(2 * np.pi * 40 * t40) * np.exp(-t40 / 0.6) * 0.3)
B['logo'].add(58.2, pad(chord(['E2', 'B2', 'E3', 'G#3', 'B3', 'D#4', 'F#4', 'B4']), 1.8, attack=0.3, release=1.2, cutoff=(800, 3000), vol=0.05, width=1.0))
glass_motif(58.7, ('G#5', 'B5', 'E6'), vol=0.35, gap=0.2, bus='logo')


def render(out_wav):
    hall = make_ir(3.0, 0.03, 3200, seed=2)      # the concrete interchange / big spaces
    room = make_ir(0.9, 0.012, 6000, seed=5)
    # sidechain pads & bass to the kick, gently
    for k in ('pad', 'bass'):
        B[k].x = sidechain(B[k].x, KICKS, depth=0.3 if k == 'pad' else 0.45)
    # 1985: mono, band-limited, a little saturation
    era = B['era'].x.mean(axis=0)
    era = np.tanh(bp(era, 180, 6500) * 1.6) * 0.9
    B['era'].x = np.vstack([era, era])
    send = {'piano': (0.4, hall), 'glass': (0.5, hall), 'voice': (0.2, room), 'pad': (0.22, hall), 'bass': (0.05, room),
            'drums': (0.1, room), 'perc': (0.2, room), 'fx': (0.25, hall), 'amb': (0.35, hall), 'foley': (0.2, room),
            'ui': (0.2, room), 'trans': (0.3, hall), 'era': (0.0, None), 'rain': (0.1, hall), 'logo': (0.3, hall)}
    gain = {'piano': 0.8, 'glass': 0.8, 'voice': 0.9, 'pad': 1.0, 'bass': 1.0, 'drums': 1.0, 'perc': 0.9, 'fx': 0.9,
            'amb': 1.0, 'foley': 1.0, 'ui': 0.9, 'trans': 1.0, 'era': 1.6, 'rain': 1.0, 'logo': 0.75}
    mix = np.zeros((2, N))
    stems = {}
    t = np.arange(N) / SR
    drop = np.interp(t, [57.0, 57.15], [1.0, 0.1])      # 57.0: the city goes quiet in 0.15 s; only rain and tails
    for k, bus in B.items():
        x = bus.x
        amt, ir = send[k]
        if ir is not None and amt > 0:
            x = x + convolve(x, ir) * amt
        stems[k] = x * gain[k] * (1.0 if k in ('rain', 'logo') else drop)
        mix += stems[k]
    # 51.75–52.0: a quarter-second of nothing under the white, then the stadium
    mix *= np.interp(t, [51.73, 51.75, 51.99, 52.0], [1.0, 0.0, 0.0, 1.0])
    # the dynamic arc: intimate -> full -> the drop at 52.3 (music only) -> logo
    arc = np.interp(t, [0, 1.5, 10, 20, 27, 42, 52, 60], [0.75, 0.62, 0.72, 0.85, 0.9, 1.0, 1.0, 0.95])
    mix *= arc
    mix = hp(mix, 24)
    mix = compress(mix, thresh=0.45, ratio=2.4, attack=0.012, release=0.2)
    mix = np.tanh(mix * 1.15) / 1.15
    fi = T(0.02)
    mix[:, :fi] *= np.linspace(0, 1, fi)
    fo = T(0.5)
    mix[:, -fo:] *= np.linspace(1, 0, fo) ** 1.5
    mix = limiter(mix, 0.9)
    # true-peak safety: find inter-sample overs at 4x and pull those spots under -1.5 dBTP
    from scipy.signal import resample_poly
    up = np.abs(resample_poly(mix, 4, 1, axis=1)).max(axis=0).reshape(-1, 4).max(axis=1)[:N]
    mix = mix * _release_env(np.minimum(1.0, 0.84 / np.maximum(up, 1e-9)))
    wf.write(out_wav, SR, (mix.T * 32767).astype(np.int16))
    return out_wav


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'out', 'score.wav')
    print(render(out))

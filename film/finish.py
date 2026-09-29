"""Finish: loudness-normalise the soundtrack and mux it with the picture.

  python3 finish.py                      -> out/LiveX_AI_City_60s_master.mp4  (CRF 16, AAC 320k)
                                            out/LiveX_AI_City_60s_X.mp4       (~12 Mbps, X upload)
                                            out/LiveX_AI_City_60s_web.mp4     (<15 MB, for the treatment page)
"""
import os
import subprocess
import sys
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = os.path.join(os.path.dirname(__file__), '..', 'out')
pic = os.path.join(OUT, 'film_silent.mp4')
wav = os.path.join(OUT, 'score.wav')
norm = os.path.join(OUT, 'score_norm.wav')


def run(args):
    print(' '.join(a if ' ' not in a else f'"{a}"' for a in args[:6]), '...')
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


# loudness: gain to -14 LUFS integrated, then a 4x-oversampled true-peak limiter at -2.3 dBTP (AAC adds ~1 dB of overs), iterated until the
# integrated loudness settles (ffmpeg's loudnorm falls back to dynamic mode here and flattens the film's arc)
import json
import numpy as np
import scipy.io.wavfile as wf
from scipy.ndimage import minimum_filter1d
from scipy.signal import resample_poly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'audio'))
from synth import _release  # noqa: E402


def measure(path):
    r = subprocess.run([FF, '-hide_banner', '-i', path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
    m = json.loads(r.stderr[r.stderr.rindex('{'):r.stderr.rindex('}') + 1])
    return float(m['input_i']), float(m['input_tp']), float(m['input_lra'])


def tp_limit(x, sr, ceiling_db=-2.3, look=0.004, release=0.12):
    ceil = 10 ** (ceiling_db / 20)
    for _ in range(3):
        up = np.abs(resample_poly(x, 4, 1, axis=1)).max(axis=0)
        up = up[:x.shape[1] * 4].reshape(-1, 4).max(axis=1)
        need = np.minimum(1.0, ceil / np.maximum(up, 1e-9))
        if need.min() > 0.999:
            break
        need = minimum_filter1d(need, size=int(look * sr) * 2 + 1)
        x = x * _release(need, np.exp(-1 / (release * sr)))
    return x


sr, raw = wf.read(wav)
raw = raw.T.astype(np.float64) / 32768
I0, _, _ = measure(wav)
gain_db = -14.0 - I0
for it in range(4):
    y = tp_limit(raw * 10 ** (gain_db / 20), sr)
    wf.write(norm, sr, (np.clip(y, -1, 1).T * 32767).astype(np.int16))
    I, TP, LRA = measure(norm)
    print(f'loudness pass {it}: gain {gain_db:+.2f} dB -> {I:.2f} LUFS, {TP:.2f} dBTP, LRA {LRA:.1f} LU')
    if abs(I + 14.0) < 0.1:
        break
    gain_db += -14.0 - I

master = os.path.join(OUT, 'LiveX_AI_City_60s_master.mp4')
run(['-i', pic, '-i', norm, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
     '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', '-shortest', master])
xcut = os.path.join(OUT, 'LiveX_AI_City_60s_X.mp4')
run(['-i', master, '-c:v', 'libx264', '-preset', 'slow', '-b:v', '12M', '-maxrate', '16M', '-bufsize', '24M',
     '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', xcut])
web = os.path.join(OUT, 'LiveX_AI_City_60s_web.mp4')
run(['-i', master, '-vf', 'scale=1600:900:flags=lanczos,hqdn3d=1.5:1.5:4:4', '-c:v', 'libx264', '-preset', 'slow',
     '-b:v', '1650k', '-maxrate', '2400k', '-bufsize', '3300k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
     '-movflags', '+faststart', web])
for f in (master, xcut, web):
    print(os.path.basename(f), f'{os.path.getsize(f) / 1e6:.1f} MB')

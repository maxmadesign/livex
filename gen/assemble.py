"""Assemble the generated cut of Route 7 inside the Higgsfield sandbox.

  python3 assemble.py <upload_url>

Reads edl.json (cuts, voice placement) and urls.json (job id -> result URL) from the
public repo, downloads the Seedance clips, the voice lines, the voice-free score and the
code-rendered overlay (subtitles, stop cards, end card), and writes one 1080p24 master:
  1. trims each clip to its slot and conforms it to 1920x1080 @ 24 fps
  2. lays the overlay (VP9 with alpha) and a white flash into the stadium on top
  3. mixes the score under the voices (sidechain ducking, a little room on dialogue)
  4. normalises to -14 LUFS with a 4x-oversampled true-peak ceiling of -2 dBTP
  5. uploads the master to the presigned URL
"""
import json
import os
import subprocess
import sys
import urllib.request

import numpy as np

SR = 48000
UP = sys.argv[1] if len(sys.argv) > 1 else None
# pin to a commit (GEN_REF) so raw.githubusercontent's branch cache can't serve a stale EDL
RAW = f"https://raw.githubusercontent.com/maxmadesign/livex/{os.environ.get('GEN_REF', 'claude/modest-heisenberg-k6wc4z')}/gen/"
os.makedirs('work', exist_ok=True)
os.chdir('work')


def sh(*a, quiet=True):
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode:
        print('FAILED', ' '.join(a[:8]), r.stderr[-2000:])
        raise SystemExit(1)
    return r


def get(url, path):
    if not os.path.exists(path):
        urllib.request.urlretrieve(url, path)
    return path


def jload(name):
    return json.loads(urllib.request.urlopen(RAW + name).read())


E, U = jload('edl.json'), jload('urls.json')
FPS, (W, H) = E['fps'], E['size']

# ------------------------------------------------------------------ voices
def decode(path, tempo=1.0):
    af = f'atempo={tempo}' if abs(tempo - 1) > 1e-3 else 'anull'
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-af', af, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True)
    return np.frombuffer(r.stdout, np.float32).astype(np.float64)


def speech_onset(path):
    """First word start (s) and transcript, via faster-whisper."""
    try:
        from faster_whisper import WhisperModel
        m = WhisperModel('base.en', device='cpu', compute_type='int8')
        segs, _ = m.transcribe(path, word_timestamps=True)
        words = [w for s in segs for w in (s.words or [])]
        return (words[0].start if words else None), ' '.join(w.word.strip() for w in words)
    except Exception as e:  # noqa
        print('whisper failed', e)
        return None, ''


# G06: if Seedance spoke the line itself (lip-synced), use its audio and slide the clip so
# the first word lands on the subtitle's 13.45 s
g06 = get(U['video']['G06'], 'G06.mp4')
sh('ffmpeg', '-v', 'error', '-y', '-i', g06, '-vn', '-ac', '1', '-ar', str(SR), 'G06.wav')
_, text = speech_onset('G06.wav')
g6 = decode('G06.wav')
rms = np.sqrt(np.convolve(g6 ** 2, np.ones(2400) / 2400, 'same'))
loud = np.nonzero(rms > 0.03)[0]
onset = loud[0] / SR if len(loud) else None      # energy onset: whisper's first-word time is too early
use_g06 = onset is not None and 'last stop' in text.lower()
print('G06 speech:', onset, repr(text), '-> use clip audio' if use_g06 else '-> use TTS line')
for c in E['clips']:
    if c['id'] == 'G06':
        c['src'] = max(0.0, min(1.2, onset - 0.65)) if use_g06 else 0.0

# ------------------------------------------------------------------ picture
segs = []
for i, c in enumerate(E['clips']):
    src = get(U['video'][c['id']], c['id'] + '.mp4')
    n = round(c['dur'] * FPS)
    out = f'seg{i:02d}.mp4'
    sh('ffmpeg', '-v', 'error', '-y', '-ss', f"{c['src']:.3f}", '-i', src, '-frames:v', str(n),
       '-vf', f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},setsar=1,format=yuv420p',
       '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-r', str(FPS), out)
    got = int(sh('ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out).stdout.strip() or 0)
    if got < n:   # clip shorter than the slot: freeze its last frame to fill
        sh('ffmpeg', '-v', 'error', '-y', '-i', out, '-vf', f'tpad=stop_mode=clone:stop={n - got}', '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', out + '.mp4')
        os.replace(out + '.mp4', out)
    print(f"{c['id']:5s} at {c['at']:5.2f} dur {c['dur']:.2f} src {c['src']:.2f} frames {got}/{n}")
    segs.append(out)
nb = round(E['tail_black'] * FPS)
sh('ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=black:s={W}x{H}:r={FPS}', '-frames:v', str(nb), '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', 'tail.mp4')
segs.append('tail.mp4')
open('list.txt', 'w').write(''.join(f"file '{s}'\n" for s in segs))
sh('ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'base.mp4')

ovl = get(RAW + 'assets/overlay.webm', 'overlay.webm')
fc = ('[2:v]format=rgba,fade=t=in:st=51.72:d=0.28:alpha=1,fade=t=out:st=52.0:d=0.06:alpha=1[w];'
      '[0:v][1:v]overlay=0:0:format=auto[a];[a][w]overlay=0:0:format=auto,format=yuv420p[v]')
sh('ffmpeg', '-v', 'error', '-y', '-i', 'base.mp4', '-c:v', 'libvpx-vp9', '-i', ovl,
   '-f', 'lavfi', '-i', f'color=c=white:s={W}x{H}:r={FPS}:d=60', '-filter_complex', fc, '-map', '[v]',
   '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-r', str(FPS), '-t', '60', 'video.mp4')

# ------------------------------------------------------------------ sound
N = SR * 60
get(RAW + 'assets/score_gen.flac', 'score.flac')
stereo = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'score.flac', '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
score = np.frombuffer(stereo, np.float32).astype(np.float64).reshape(-1, 2).T[:, :N]
score = np.pad(score, ((0, 0), (0, N - score.shape[1])))

rng = np.random.default_rng(7)
t_ir = np.arange(int(0.9 * SR)) / SR
IR = rng.standard_normal(len(t_ir)) * np.exp(-t_ir / 0.16) * 0.06
IR[0] = 1.0


def fftconv(x, h):
    n = 1 << int(np.ceil(np.log2(len(x) + len(h))))
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)[:len(x) + len(h) - 1]


SPEECH_RMS = 0.16   # about -16 dBFS while talking: 6-8 dB over the ducked score


def level(x):
    """Scale a voice line so its speech (the frames above -40 dBFS) sits at SPEECH_RMS."""
    f = 1200
    fr = x[:len(x) // f * f].reshape(-1, f)
    r = np.sqrt((fr ** 2).mean(axis=1))
    act = r[r > 0.01]
    return x * (SPEECH_RMS / (np.sqrt((act ** 2).mean()) if len(act) else 1.0))


vo = np.zeros(N)
for v in E['vo']:
    if v['id'] == 'L2' and use_g06:
        continue
    x = decode(get(U['audio'][v['id']], v['id'] + '.mp3'), v['tempo'])
    x = level(x) * 10 ** (v['gain'] / 20)
    if v['room']:
        x = fftconv(x, IR)
    a = int(v['at'] * SR)
    b = min(N, a + len(x))
    vo[a:b] += x[:b - a]
    print(f"{v['id']} at {v['at']:.2f} len {len(x) / SR:.2f}s")
if use_g06:
    g = decode('G06.wav')
    src = [c for c in E['clips'] if c['id'] == 'G06'][0]
    a, s0 = int(12.8 * SR), int(src['src'] * SR)
    seg = level(g[s0:s0 + int(src['dur'] * SR)]) * 10 ** (-1 / 20)
    vo[a:a + len(seg)] += seg

# duck the score under the voices: ~ -7 dB while anyone speaks, 40 ms attack, 450 ms release
env = np.sqrt(np.convolve(vo ** 2, np.ones(int(0.03 * SR)) / int(0.03 * SR), 'same'))
key = np.clip(env / 0.02, 0, 1)
duck = np.empty(N)
g, att, rel = 0.0, np.exp(-1 / (0.04 * SR)), np.exp(-1 / (0.45 * SR))
for i in range(0, N, 48):   # block-rate follower (1 ms)
    k = key[i]
    g = att * g + (1 - att) * k if k > g else rel * g + (1 - rel) * k
    duck[i:i + 48] = g
gain = 1 - 0.55 * duck
mix = score * gain + vo[None, :]


def lufs(x):
    import tempfile
    f = tempfile.mktemp(suffix='.wav')
    write_wav(f, x)
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', f, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = json.loads(r[r.rindex('{'):r.rindex('}') + 1])
    return float(m['input_i']), float(m['input_tp']), float(m['input_lra'])


def write_wav(path, x):
    y = (np.clip(x, -1, 1).T * 32767).astype('<i2')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', '-', path], input=y.tobytes())


def tp_limit(x, ceil_db=-2.0):
    c = 10 ** (ceil_db / 20)
    for _ in range(3):
        n = x.shape[1]
        pk = np.zeros(n)
        L, M = SR, 1024   # 1 s chunks with a 1024-sample margin, 4x FFT upsampling each
        for a in range(0, n, L):
            lo, hi = max(0, a - M), min(n, a + L + M)
            seg = x[:, lo:hi]
            m = hi - lo
            S = np.fft.rfft(seg, axis=1)
            Z = np.zeros((2, 2 * m + 1), complex)
            Z[:, :S.shape[1]] = S
            up = np.fft.irfft(Z, 4 * m, axis=1) * 4
            p = np.abs(up).max(axis=0).reshape(-1, 4).max(axis=1)
            pk[a:min(n, a + L)] = p[a - lo:a - lo + min(L, n - a)]
        need = np.minimum(1, c / np.maximum(pk, 1e-9))
        if need.min() > 0.999:
            break
        # 4 ms look-ahead minimum, then 120 ms release
        w = int(0.004 * SR)
        need = np.array([need[max(0, i - w):i + w + 1].min() for i in range(0, n, 16)]).repeat(16)[:n]
        out, gg, r = np.empty(n), 1.0, np.exp(-16 / (0.12 * SR))
        for i in range(0, n, 16):
            t = need[i]
            gg = t if t < gg else r * gg + (1 - r) * t
            out[i:i + 16] = gg
        x = x * out[:n]
    return x


I0, tp0, lra0 = lufs(mix)
print(f'pre-norm {I0:.2f} LUFS {tp0:.2f} dBTP LRA {lra0:.1f}')
gdb = -14.0 - I0
for it in range(5):
    y = tp_limit(mix * 10 ** (gdb / 20))
    I, TP, LRA = lufs(y)
    print(f'norm pass {it}: {I:.2f} LUFS {TP:.2f} dBTP LRA {LRA:.1f}')
    if abs(I + 14) < 0.15:
        break
    gdb += -14 - I
fo = int(0.02 * SR)
y[:, :fo] *= np.linspace(0, 1, fo)
write_wav('mix.wav', y)

sh('ffmpeg', '-v', 'error', '-y', '-i', 'video.mp4', '-i', 'mix.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
   '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', '-shortest', 'LiveX_AI_City_Route7_generated.mp4')
print(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'csv=p=0', 'LiveX_AI_City_Route7_generated.mp4').stdout.strip())
if UP:
    r = subprocess.run(['curl', '-f', '-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'PUT', '-H', 'Content-Type: video/mp4',
                        '--upload-file', 'LiveX_AI_City_Route7_generated.mp4', UP], capture_output=True, text=True)
    print('upload', r.stdout)
print('DONE')

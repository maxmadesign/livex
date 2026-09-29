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


# two-pass EBU R128 loudnorm to -14 LUFS / -1 dBTP (social delivery)
import json
r = subprocess.run([FF, '-hide_banner', '-i', wav, '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
m = json.loads(r.stderr[r.stderr.rindex('{'):r.stderr.rindex('}') + 1])
af = (f"loudnorm=I=-14:TP=-1:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
      f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
run(['-i', wav, '-af', af, '-ar', '48000', norm])

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

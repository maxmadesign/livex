# LiveX AI City — 60 s brand film

Creative development, production bible and a fully code-built motion film for
**LiveX AI City**, the idea that LiveX Gateway, Portal and Paragon Outdoor are the
Physical AI Nodes of a real city, all running one intelligence: Lyra.

```
docs/     概念提案、故事与时间线、分镜表、GPT-image-2.5 分镜提示词、
          Seedance 2.5 视频提示词、Claude Code Motion/UI Brief、音乐与声音设计
film/     the motion film: a deterministic HTML/Canvas engine rendered frame by frame
  src/      engine (time, easing, homography), devices, Lyra OS screen UI, 2.5D camera,
            environments (point-light bokeh, city light map), titles, scenes
  audio/    numpy/scipy synthesis: score, ambience, foley, UI sounds, sonic logo
  assets/   product renders cut out of the spec sheets, Lyra, traced LiveX mark, fonts
  render.mjs  Chromium -> ffmpeg capture (1920x1080, 30 fps, H.264)
out/      renders
```

## Render

```bash
pip install numpy scipy pillow imageio-ffmpeg numba
cd film
node render.mjs --stills 3,21,55          # look at single frames
node render.mjs --video --workers 3       # 60 s silent picture -> out/film_silent.mp4
python3 audio/score.py ../out/score.wav   # soundtrack
```

Every frame is a pure function of time, so renders are identical run to run and
picture and sound are cut to the same 120 BPM grid (one bar = 2.0 s).

## Assets

Product renders and Lyra are the client's own spec-sheet images (`film/assets/src`).
Cutouts were made with point-prompted SAM (rembg) plus luminance mattes; screen
quads were measured from the cutouts, so all screen UI sits in the renders' true
perspective. The LiveX mark and wordmark are traced from the flat print on the
spec sheet. Fonts: Geist, Geist Mono, Instrument Serif (SIL OFL, Google Fonts).

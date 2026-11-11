"""PNG figures -> WebP for the page.   python3 to_webp.py <png_dir> <webp_dir>"""
import os, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for f in sorted(os.listdir(src)):
    if not f.endswith(".png") or f.startswith("_"):
        continue
    im = Image.open(os.path.join(src, f)).convert("RGB")
    if f == "hero.png":
        im = im.resize((1920, 1080), Image.LANCZOS)
    im.save(os.path.join(dst, f[:-4] + ".webp"), "WEBP", quality=84, method=6)
    print(f, im.size)

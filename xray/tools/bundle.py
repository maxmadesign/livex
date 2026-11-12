"""Packs the page and its data into one HTML file that can be copied to a screen and opened on its own.

    python3 bundle.py [out.html]          # default: ../dist/xray-mirror.html

The page looks for its data inside the document first, so the result needs no data/ folder next to it.
(The libraries and tracker models still come from the internet, or from ./vendor with "?local".)
"""
import base64, os, sys

here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "dist", "xray-mirror.html")
html = open(os.path.join(root, "index.html"), encoding="utf-8").read()
parts = []
for name in ("head.json", "body.json"):
    parts.append('<script type="application/json" id="data:%s">%s</script>' % (name, open(os.path.join(root, "data", name), encoding="utf-8").read()))
for name in ("head.bin", "body.bin"):
    parts.append('<script type="application/octet-stream" id="data:%s">%s</script>' % (name, base64.b64encode(open(os.path.join(root, "data", name), "rb").read()).decode()))
marker = '<script type="module">'
assert html.count(marker) == 1
html = html.replace(marker, "\n".join(parts) + "\n\n" + marker)
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w", encoding="utf-8").write(html)
print("wrote %s (%.2f MB)" % (out, len(html.encode()) / 1e6))

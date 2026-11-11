"""Pull the embedded mesh table and buffers out of the analysed page, as plain data.

    python3 extract.py <path/to/index.html> <out_dir> [path/to/canonical_face_model.obj]

Writes <out_dir>/meta.json and <out_dir>/meshdata.bin, plus <out_dir>/canon.json (the 468 canonical
face vertices) when MediaPipe's OBJ is given, and prints the per-mesh statistics quoted in the teardown.
Nothing from the page is executed.
"""
import base64, hashlib, json, os, re, sys

src = open(sys.argv[1], encoding="utf-8").read()
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
print("html bytes", len(src.encode()), "sha256", hashlib.sha256(src.encode()).hexdigest()[:16])

meta = json.loads(re.search(r'<script id="meshmeta"[^>]*>(.*?)</script>', src, re.S).group(1))
b64 = re.search(r'<script id="meshdata"[^>]*>(.*?)</script>', src, re.S).group(1).strip()
raw = base64.b64decode(b64)
print("base64 chars", len(b64), "-> binary bytes", len(raw))
print("jawPivot", meta["jawPivot"], "| fit landmark ids", sorted(int(k) for k in meta["fit"]))

print("\n%-14s %7s %7s %9s" % ("mesh", "verts", "tris", "bytes"))
tv = tt = tb = 0
for m in meta["meshes"]:
    nb = m["nv"] * 6 + m["ni"] * 2          # 3 x uint16 per vertex, uint16 per index
    tv += m["nv"]; tt += m["ni"] // 3; tb += nb
    print("%-14s %7d %7d %9d" % (m["name"], m["nv"], m["ni"] // 3, nb))
print("%-14s %7d %7d %9d" % ("TOTAL", tv, tt, tb))
print("\nlabels:", len(meta["labels"]), {k: sum(1 for L in meta["labels"] if L["layer"] == k) for k in ("skull", "eyes", "brain", "muscles")})

json.dump(meta, open(os.path.join(out, "meta.json"), "w"))
open(os.path.join(out, "meshdata.bin"), "wb").write(raw)
if len(sys.argv) > 3:
    v = [[round(float(x), 4) for x in l.split()[1:4]] for l in open(sys.argv[3]) if l.startswith("v ")]
    json.dump(v, open(os.path.join(out, "canon.json"), "w"))
    print("canonical face vertices:", len(v))
    same = all(max(abs(a - b) for a, b in zip(meta["fit"][k], v[int(k)])) < 6e-4 for k in meta["fit"])
    print("fit points equal the canonical vertices (3 decimals):", same)

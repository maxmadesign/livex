"""Prepares the head data file.

    python3 build_head.py <meta.json> <meshdata.bin> <canonical_face_model.obj> <body.json> <body.bin> <out dir>

meta.json / meshdata.bin are the head and hand meshes extracted from the X-Ray Mirror page by
../../xray-teardown/tools/extract.py. They are BodyParts3D parts that its author simplified and aligned to MediaPipe's
canonical face (cm; +x the subject's left, +y up, +z forward), so they carry BodyParts3D's licence, CC BY-SA 2.1 Japan,
and are used here unchanged. Writes <out dir>/head.json and head.bin.

Three things are added to the mesh table:
  meshesLite - the large head meshes simplified further (appended to head.bin), for slow machines
  anchors   - canonical-face positions of the face landmarks the page uses to pin the head to the picture
              (from MediaPipe's canonical_face_model.obj, Apache-2.0)
  fromBody  - the transform from the body skeleton's space (mm) to this head space, found here by fitting the
              source skull to the aligned one. The page uses it to hang the neck under the tracked head.
"""
import json, sys
import numpy as np
import fast_simplification

meta_p, bin_p, obj_p, bjson_p, bbin_p, out = sys.argv[1:7]
meta = json.load(open(meta_p)); raw = open(bin_p, "rb").read()
canon = np.array([[float(x) for x in l.split()[1:4]] for l in open(obj_p) if l.startswith("v ")])

def verts(m, raw):
    q = np.frombuffer(raw, dtype="<u2", count=m["nv"] * 3, offset=m["offV"]).reshape(-1, 3).astype(np.float64)
    return np.array(m["min"]) + q / 65535.0 * np.array(m["size"])

head = {m["name"]: m for m in meta["meshes"]}
target = np.r_[verts(head["cranium"], raw), verts(head["jaw"], raw)]            # cm, canonical face space
body = json.load(open(bjson_p)); braw = open(bbin_p, "rb").read()
src = verts(next(m for m in body["meshes"] if m["name"] == "skull"), braw)      # mm, body space

def nearest(P, Q, chunk=400):
    idx = np.empty(len(P), dtype=np.int64); d = np.empty(len(P))
    for s in range(0, len(P), chunk):
        D = ((P[s:s + chunk, None, :] - Q[None, :, :]) ** 2).sum(-1)
        idx[s:s + chunk] = D.argmin(1); d[s:s + chunk] = np.sqrt(D.min(1))
    return idx, d

def similarity(A, B):                 # least-squares s, R, t with B ~ s R A + t (Umeyama)
    ma, mb = A.mean(0), B.mean(0); A0, B0 = A - ma, B - mb
    U, S, Vt = np.linalg.svd(B0.T @ A0 / len(A))
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt; s = np.trace(np.diag(S) @ D) / (A0 ** 2).sum(1).mean()
    return s, R, mb - s * R @ ma

# start: mm -> cm, body axes (left, back, up) -> head axes (left, up, forward), centroids together
M = np.eye(4); M[:3, :3] = 0.1 * np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float)
M[:3, 3] = target.mean(0) - M[:3, :3] @ src.mean(0)
rng = np.random.default_rng(1); sub = src[rng.choice(len(src), 3000, replace=False)]
for it in range(40):
    cur = sub @ M[:3, :3].T + M[:3, 3]
    idx, d = nearest(cur, target)
    keep = d < np.percentile(d, 90)
    s, R, t = similarity(sub[keep], target[idx[keep]])
    M[:3, :3] = s * R; M[:3, 3] = t
cur = src @ M[:3, :3].T + M[:3, 3]; idx, d = nearest(cur, target)
print("similarity fit: scale %.5f (cm per mm), median residual %.2f mm, 90th percentile %.2f mm" % (np.cbrt(np.linalg.det(M[:3, :3])), np.median(d) * 10, np.percentile(d, 90) * 10))
# is there more than a similarity in the original alignment? fit a free affine to the same matches
keep = d < np.percentile(d, 90)
X = np.c_[src[keep], np.ones(keep.sum())]; Aff, *_ = np.linalg.lstsq(X, target[idx[keep]], rcond=None)
cur2 = np.c_[src, np.ones(len(src))] @ Aff; _, d2 = nearest(cur2, target)
sv = np.linalg.svd(Aff[:3].T, compute_uv=False)
print("free affine fit: median residual %.2f mm; axis scales %s" % (np.median(d2) * 10, np.round(sv, 5)))

IDS = [1, 2, 4, 6, 9, 10, 33, 61, 133, 152, 168, 199, 234, 263, 291, 362, 454]
out_meta = {
    "source": "Head and hand meshes: BodyParts3D, (c) The Database Center for Life Science, CC BY-SA 2.1 Japan; simplified and aligned to "
              "MediaPipe's canonical face by the author of X-Ray Mirror (github.com/MasterOfVFX2070/xray-mirror); used unchanged. "
              "meshesLite: the same meshes simplified further.",
    "units": "cm", "axes": "+x subject's left, +y up, +z forward (MediaPipe canonical face)",
    "meshes": meta["meshes"], "jawPivot": meta["jawPivot"],
    "anchors": {str(i): [round(float(x), 4) for x in canon[i]] for i in IDS},
    "fromBody": [round(float(x), 6) for x in M.T.ravel()],          # column-major, as three.js reads it
}
# light versions of the large meshes: fewer triangles, same bounding box, appended after the original data
LITE = {"cranium": 17000, "jaw": 4600, "cerebrum": 18000, "hindbrain": 5200, "muscles": 12500, "skin": 5000}
blob = bytearray(raw); lite = []
for m in meta["meshes"]:
    if m["name"] not in LITE: continue
    V = verts(m, raw); F = np.frombuffer(raw, dtype="<u2", count=m["ni"], offset=m["offI"]).reshape(-1, 3)
    v, f = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_count=LITE[m["name"]], agg=5)
    v = np.asarray(v, dtype=np.float64); f = np.asarray(f)
    q = np.round(np.clip((v - np.array(m["min"])) / np.array(m["size"]), 0, 1) * 65535).astype("<u2")
    e = {"name": m["name"], "nv": int(len(v)), "ni": int(f.size), "min": m["min"], "size": m["size"]}
    if len(blob) % 2: blob.extend(b"\0")
    e["offV"] = len(blob); blob.extend(q.tobytes())
    e["offI"] = len(blob); blob.extend(f.astype("<u2").tobytes())
    lite.append(e)
    print("lite %-10s %6d -> %6d tris" % (m["name"], m["ni"] // 3, len(f)))
out_meta["meshesLite"] = lite
json.dump(out_meta, open(out + "/head.json", "w"), separators=(",", ":"))
open(out + "/head.bin", "wb").write(bytes(blob))
print("wrote head.json (%d meshes, %d light, %d anchors) and head.bin (%d bytes, %d of them the original data)" % (len(meta["meshes"]), len(lite), len(IDS), len(blob), len(raw)))

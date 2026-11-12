"""Builds the body-skeleton data file from BodyParts3D release 3.0 part meshes.

    python3 build_body.py <BodyParts3D_data dir> <out dir>

<BodyParts3D_data dir> holds parts_list_e.txt and stl/FMA*.stl (e.g. a checkout of
github.com/Kevin-Mattheus-Moerman/BodyParts3D, assets/BodyParts3D_data). Writes <out dir>/body.json and body.bin.

Every bone keeps the coordinates of the source data (mm; +x the subject's left, +y posterior, +z up), so the whole
skeleton stays in one space. The page poses it by moving each group with a matrix built from tracked joints; the
joint centres it needs in this space are measured here and stored in body.json.

BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan.
The meshes written here are simplified versions of that data and carry the same licence.
"""
import json, os, struct, sys
import numpy as np
import fast_simplification
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts import resolve

# triangle budget per group, and for the light version that slow machines and small figures get
BUDGET = {"skull": 12000, "cervical": 5000, "thorax": 34000, "lumbar": 6000, "pelvis": 9000,
          "humerus": 2200, "forearm": 2600, "hand": 5000, "femur": 2600, "leg": 3400, "foot": 4500}
LITE = {"skull": 4200, "cervical": 1800, "thorax": 11000, "lumbar": 2200, "pelvis": 3000,
        "humerus": 800, "forearm": 900, "hand": 1900, "femur": 900, "leg": 1200, "foot": 1700}


def read_stl(path):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[80:84])[0]
    rec = np.frombuffer(b, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]), count=n, offset=84)
    pts = rec["v"].reshape(-1, 3).astype(np.float64)
    uniq, inv = np.unique(pts, axis=0, return_inverse=True)
    f = inv.reshape(-1, 3)
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    return uniq, f.astype(np.int64)


def area(V, F):
    return 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum()


def simplify(V, F, target, passes=1):
    """One pass removes at most about nine triangles in ten, so a much lighter mesh takes several."""
    for _ in range(passes):
        if len(F) <= target:
            break
        v, f = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_count=int(target), agg=5)
        V, F = np.asarray(v, dtype=np.float64), np.asarray(f, dtype=np.int64)
    return V, F


def sphere_fit(P):
    A = np.c_[2 * P, np.ones(len(P))]
    sol, *_ = np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)
    c = sol[:3]
    return c, float(np.sqrt(sol[3] + c @ c))


def end_centroid(V, frac, top):
    """centroid of the slice at one end of a bone along its long axis; top=True is the higher end"""
    c = V.mean(0)
    _, _, vt = np.linalg.svd(V - c, full_matrices=False)
    d = vt[0] if vt[0][2] > 0 else -vt[0]
    t = (V - c) @ d
    lo, hi = t.min(), t.max()
    sel = t > hi - frac * (hi - lo) if top else t < lo + frac * (hi - lo)
    return V[sel].mean(0)


def main():
    data_dir, out_dir = sys.argv[1], sys.argv[2]
    groups = resolve(data_dir)
    raw = {}                                    # part name -> (V, F), full resolution

    def part(name):
        for ids in groups.values():
            for k, n in ids:
                if n == name:
                    if n not in raw: raw[n] = read_stl("%s/stl/%s.stl" % (data_dir, k))
                    return raw[n]
        raise KeyError(name)

    # ------------------------------------------------------------------ joints, measured on the full-resolution parts
    J = {}
    for s in ("left", "right"):
        V, _ = part(s + " humerus")
        z = V[:, 2]; top = V[z > z.max() - 0.085 * (z.max() - z.min())]
        c, r = sphere_fit(top); J["shoulder_" + s] = c; print("humeral head %s: centre %s radius %.1f mm" % (s, c.round(1), r))
        J["elbow_" + s] = end_centroid(V, 0.035, False)
        fa = np.r_[part(s + " radius")[0], part(s + " ulna")[0]]
        J["wrist_" + s] = end_centroid(fa, 0.03, False)
        J["index_" + s] = end_centroid(part(s + " second metacarpal bone")[0], 0.12, False)
        J["pinky_" + s] = end_centroid(part(s + " fifth metacarpal bone")[0], 0.12, False)
        V, _ = part(s + " femur")
        z = V[:, 2]; ax = V[(z > np.percentile(z, 35)) & (z < np.percentile(z, 65))].mean(0)   # mid-shaft
        head = V[(z > z.max() - 0.10 * (z.max() - z.min())) & (np.abs(V[:, 0]) < abs(ax[0]))]   # top slice, medial of the shaft
        c, r = sphere_fit(head); J["hip_" + s] = c; print("femoral head %s: centre %s radius %.1f mm" % (s, c.round(1), r))
        J["knee_" + s] = end_centroid(V, 0.03, False)
        J["ankle_" + s] = end_centroid(part(s + " tibia")[0], 0.03, False)
        V, _ = part(s + " calcaneus"); J["heel_" + s] = V[V[:, 1] > np.percentile(V[:, 1], 95)].mean(0)
        V, _ = part("distal phalanx of %s big toe" % s); J["toe_" + s] = V[V[:, 1] < np.percentile(V[:, 1], 20)].mean(0)
        V, _ = part(s + " temporal bone")
        low = V[V[:, 2] < np.percentile(V[:, 2], 55)]
        lat = low[np.abs(low[:, 0]) > np.percentile(np.abs(low[:, 0]), 97)].mean(0)
        J["ear_" + s] = lat + np.array([10.0 * np.sign(lat[0]), 0, 0])              # the ear sits about 1 cm outside the bone
    nb = np.r_[part("left nasal bone")[0], part("right nasal bone")[0]]
    tip = nb[nb[:, 2] < np.percentile(nb[:, 2], 12)].mean(0)
    J["nose"] = np.array([0.0, tip[1] - 24.0, tip[2] - 14.0])                       # the nose tip is cartilage: ahead of and below the nasal bones

    # ------------------------------------------------------------------ meshes, in two levels of detail
    blob = bytearray()

    def emit(budgets, floor, passes):
        meta = []
        for grp, ids in groups.items():
            budget = budgets[grp.split("_")[0]]
            parts = [part(n) for _, n in ids]
            areas = np.array([area(V, F) for V, F in parts])
            share = np.maximum(floor, budget * areas / areas.sum())
            share = share * budget / share.sum()
            Vs, Fs, off = [], [], 0
            for (V, F), t in zip(parts, share):
                v, f = simplify(V, F, max(floor * 2 // 3, round(t)), passes)
                Vs.append(v); Fs.append(f + off); off += len(v)
            V = np.concatenate(Vs); F = np.concatenate(Fs)
            assert len(V) < 65536, grp
            lo = V.min(0); size = np.maximum(V.max(0) - lo, 1e-6)
            q = np.round((V - lo) / size * 65535).astype("<u2")
            m = {"name": grp, "nv": int(len(V)), "ni": int(F.size), "min": [round(float(x), 3) for x in lo], "size": [round(float(x), 3) for x in size]}
            if len(blob) % 2: blob.extend(b"\0")
            m["offV"] = len(blob); blob.extend(q.tobytes())
            m["offI"] = len(blob); blob.extend(F.astype("<u2").tobytes())
            if grp in ("lumbar", "cervical"):   # how much each vertex follows the frame above it: 0 at the bottom of the group, 1 at its top
                z = V[:, 2]; w = np.clip((z - z.min()) / (z.max() - z.min()), 0, 1)
                m["offW"] = len(blob); blob.extend(np.round(w * 255).astype("u1").tobytes())
            meta.append(m)
            print("%-15s %3d parts  %6d verts %6d tris" % (grp, len(parts), len(V), len(F)))
        print("  = %d verts %d tris" % (sum(m["nv"] for m in meta), sum(m["ni"] for m in meta) // 3))
        return meta

    meta = emit(BUDGET, 60, 1)
    lite = emit(LITE, 24, 3)
    out = {"units": "mm", "axes": "+x subject's left, +y posterior, +z up",
           "source": "BodyParts3D release 3.0 (2011-09-15), (c) The Database Center for Life Science, CC BY-SA 2.1 Japan; simplified",
           "joints": {k: [round(float(x), 2) for x in v] for k, v in J.items()}, "meshes": meta, "meshesLite": lite}
    json.dump(out, open(out_dir + "/body.json", "w"), separators=(",", ":"))
    open(out_dir + "/body.bin", "wb").write(bytes(blob))
    print("%d bytes" % len(blob))
    for k, v in out["joints"].items(): print("  %-15s %s" % (k, v))


if __name__ == "__main__":
    main()

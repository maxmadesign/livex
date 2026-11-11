"""Measurements quoted in the teardown: registration to the canonical face, jaw hinge, hand rig, triangle budget.

    python3 measure.py <data/meta.json> <data/meshdata.bin> <path/to/canonical_face_model.obj>
"""
import sys, json
import numpy as np
meta = json.load(open(sys.argv[1])); raw = open(sys.argv[2], "rb").read()
canon = np.array([[float(x) for x in l.split()[1:4]] for l in open(sys.argv[3]) if l.startswith("v ")])
M = {}
for m in meta["meshes"]:
    q = np.frombuffer(raw, dtype="<u2", count=m["nv"] * 3, offset=m["offV"]).reshape(-1, 3).astype(np.float64)
    V = np.array(m["min"]) + q / 65535.0 * np.array(m["size"])
    I = np.frombuffer(raw, dtype="<u2", count=m["ni"], offset=m["offI"]).reshape(-1, 3).astype(np.int64)
    M[m["name"]] = (V, I)

def closest_dist(P, V, I, chunk=64):
    """exact point-to-triangle distance (Ericson), vectorised over triangles"""
    A, B, C = V[I[:, 0]], V[I[:, 1]], V[I[:, 2]]
    out = np.empty(len(P)); sign = np.empty(len(P))
    N = np.cross(B - A, C - A); N /= (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)
    for s in range(0, len(P), chunk):
        p = P[s:s + chunk][:, None, :]
        ab, ac, ap = B - A, C - A, p - A
        d1 = (ab * ap).sum(-1); d2 = (ac * ap).sum(-1)
        bp = p - B; d3 = (ab * bp).sum(-1); d4 = (ac * bp).sum(-1)
        cp = p - C; d5 = (ab * cp).sum(-1); d6 = (ac * cp).sum(-1)
        va = d3 * d6 - d5 * d4; vb = d5 * d2 - d1 * d6; vc = d1 * d4 - d3 * d2
        denom = va + vb + vc; denom = np.where(np.abs(denom) < 1e-20, 1e-20, denom)
        v = vb / denom; w = vc / denom
        Q = A + ab * v[..., None] + ac * w[..., None]                      # interior
        def put(mask, val): 
            nonlocal Q
            Q = np.where(mask[..., None], val, Q)
        t = np.clip((d4 - d3) / np.where(np.abs((d4 - d3) + (d5 - d6)) < 1e-20, 1e-20, (d4 - d3) + (d5 - d6)), 0, 1)
        put((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), B + (C - B) * t[..., None])
        t = np.clip(d2 / np.where(np.abs(d2 - d6) < 1e-20, 1e-20, d2 - d6), 0, 1)
        put((vb <= 0) & (d2 >= 0) & (d6 <= 0), A + ac * t[..., None])
        t = np.clip(d1 / np.where(np.abs(d1 - d3) < 1e-20, 1e-20, d1 - d3), 0, 1)
        put((vc <= 0) & (d1 >= 0) & (d3 <= 0), A + ab * t[..., None])
        put((d6 >= 0) & (d5 <= d6), np.broadcast_to(C, Q.shape))
        put((d3 >= 0) & (d4 <= d3), np.broadcast_to(B, Q.shape))
        put((d1 <= 0) & (d2 <= 0), np.broadcast_to(A, Q.shape))
        D = np.linalg.norm(p - Q, axis=-1); k = D.argmin(1)
        out[s:s + chunk] = D[np.arange(len(k)), k]
        sign[s:s + chunk] = np.sign(((P[s:s + chunk] - Q[np.arange(len(k)), k]) * N[k]).sum(-1))
    return out, sign

print("== canonical face (468 verts) vs embedded skin mesh ==")
V, I = M["skin"]
d, sg = closest_dist(canon, V, I)
sd = d * sg
print("unsigned dist cm: median %.3f mean %.3f p90 %.3f max %.3f" % (np.median(d), d.mean(), np.percentile(d, 90), d.max()))
print("signed (＋ outside skin) cm: median %.3f mean %.3f min %.3f max %.3f" % (np.median(sd), sd.mean(), sd.min(), sd.max()))
print("share within 2 mm: %.1f%%, within 5 mm: %.1f%%" % ((d < 0.2).mean() * 100, (d < 0.5).mean() * 100))
for k, v in meta["fit"].items():
    dd, ss = closest_dist(np.array([v]), V, I)
    print("  fit lm %4s %-26s dist to skin %.2f cm (%s)" % (k, v, dd[0], "outside" if ss[0] > 0 else "inside"))
# best residual similarity (Umeyama) canonical->closest skin points would need correspondences; skip.

print("\n== bounding boxes (cm) ==")
for n in ["skin", "cranium", "jaw", "cerebrum", "hindbrain", "muscles", "eyes"]:
    V, I = M[n]; print("  %-10s x[%6.2f %6.2f] y[%6.2f %6.2f] z[%6.2f %6.2f]" % (n, *np.c_[V.min(0), V.max(0)].ravel()))
V, I = M["skin"]; print("skin head: width %.1f  height %.1f  depth %.1f cm; x-centre %.2f" % (*(V.max(0) - V.min(0)), (V.max(0)[0] + V.min(0)[0]) / 2))
V, I = M["cranium"]; print("cranium: width %.1f (ear to ear)  length %.1f (front to back) cm" % (V[:, 0].max() - V[:, 0].min(), V[:, 2].max() - V[:, 2].min()))

print("\n== jaw hinge ==")
piv = np.array(meta["jawPivot"]); V, I = M["jaw"]
print("pivot", piv.round(3), "| jaw top y %.2f, rear z %.2f" % (V[:, 1].max(), V[:, 2].min()))
top = V[V[:, 1] > V[:, 1].max() - 0.6]
print("condyle region (top 6 mm of the mandible): |x| mean %.2f cm, y mean %.2f, z mean %.2f" % (np.abs(top[:, 0]).mean(), top[:, 1].mean(), top[:, 2].mean()))
chin = V[V[:, 1].argmin()]; inc = V[(np.abs(V[:, 0]) < 0.4)]; inc = inc[inc[:, 2].argmax()]
for name, p in [("lowest chin point", chin), ("front-most midline point", inc)]:
    r = p - piv; th = 0.36
    y2 = r[1] * np.cos(th) - r[2] * np.sin(th); z2 = r[1] * np.sin(th) + r[2] * np.cos(th)
    print("  %-24s %s lever %.2f cm -> at 0.36 rad (%.1f deg): moves dy %.2f dz %.2f, path %.2f cm" % (name, p.round(2), np.hypot(r[1], r[2]), np.degrees(th), y2 - r[1], z2 - r[2], np.hypot(y2 - r[1], z2 - r[2])))

print("\n== hand rig ==")
H = np.array(meta["demoHand"]); print("demoHand (cm) bbox", H.min(0).round(2), H.max(0).round(2))
e1 = H[5] - H[0]; e2 = H[17] - H[0]
print("wrist->index MCP %.2f cm, wrist->little MCP %.2f cm, angle %.1f deg, knuckle span 5-17 %.2f cm" % (np.linalg.norm(e1), np.linalg.norm(e2), np.degrees(np.arccos(e1 @ e2 / np.linalg.norm(e1) / np.linalg.norm(e2))), np.linalg.norm(H[17] - H[5])))
BONES = [[1,2],[2,3],[3,4],[5,6],[6,7],[7,8],[9,10],[10,11],[11,12],[13,14],[14,15],[15,16],[17,18],[18,19],[19,20]]
for a, b in BONES:
    V, I = M["hand_b_%d_%d" % (a, b)]
    L = np.linalg.norm(H[b] - H[a])
    print("  bone %2d-%2d local x[%5.2f %5.2f] y[%5.2f %5.2f] z[%5.2f %5.2f]  joint distance in dataset %.2f cm" % (a, b, *np.c_[V.min(0), V.max(0)].ravel(), L))
V, I = M["hand_palm"]; print("  palm local x[%5.2f %5.2f] y[%5.2f %5.2f] z[%5.2f %5.2f]" % tuple(np.c_[V.min(0), V.max(0)].ravel()))
# where do the dataset's own landmarks sit in palm coordinates?
B = np.c_[e1, e2, np.cross(e1, e2) / np.linalg.norm(np.cross(e1, e2)) * np.sqrt(np.linalg.norm(e1) * np.linalg.norm(e2))]
loc = np.linalg.solve(B, (H - H[0]).T).T
for i in [0, 1, 5, 9, 13, 17]: print("  landmark %2d in palm coords %s" % (i, loc[i].round(2)))

print("\n== triangle budget ==")
head = {n: len(M[n][1]) for n in ["skin", "muscles", "cranium", "jaw", "eyes", "cerebrum", "hindbrain"]}
hand = sum(len(M[n][1]) for n in M if n.startswith("hand_"))
print(head, "hand(one):", hand)
print("everything on, 2 hands: %d tris/frame (skin drawn twice)" % (sum(head.values()) + head["skin"] + 2 * hand))
print("quantisation step: max %.1f um" % (max(max(m["size"]) for m in meta["meshes"]) / 65535 * 1e4))

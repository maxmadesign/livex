"""Which BodyParts3D parts make up each piece of the body skeleton.

    python3 parts.py <BodyParts3D_data dir>          # prints the resolved list, one "group<TAB>FMA id<TAB>name" per line

Parts are picked by their English names in parts_list_e.txt (release 3.0, 2011-09-15).
"""
import csv, re, sys

SIDES = ("left", "right")
FINGER = r"(thumb|index finger|middle finger|ring finger|little finger)"
TOE = r"(big toe|second toe|third toe|fourth toe|little toe)"
ORD = "first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth".split()

def groups():
    g = {}
    g["skull"] = [r"^(frontal bone|occipital bone|sphenoid bone|ethmoid|vomer|mandible)$",
                  r"^(left|right) (parietal bone|temporal bone|maxilla|zygomatic bone|nasal bone|lacrimal bone|palatine bone|inferior nasal concha)$",
                  r"^(left|right) (upper|lower) .*secondary .*tooth$"]
    g["cervical"] = [r"^(atlas|axis)$", r"^(third|fourth|fifth|sixth|seventh) cervical vertebra$",
                     r"^intervertebral disk of (axis|(third|fourth|fifth|sixth|seventh) cervical vertebra)$"]
    g["thorax"] = [r"^(%s) thoracic vertebra$" % "|".join(ORD), r"^intervertebral disk of (%s) thoracic vertebra$" % "|".join(ORD),
                   r"^(left|right) (%s) rib$" % "|".join(ORD), r"^(left|right) (%s) costal cartilage$" % "|".join(ORD),
                   r"^(manubrium|body of sternum|xiphoid process)$", r"^(left|right) (clavicle|scapula)$"]
    g["lumbar"] = [r"^(first|second|third|fourth|fifth) lumbar vertebra$", r"^intervertebral disk of (first|second|third|fourth|fifth) lumbar vertebra$"]
    g["pelvis"] = [r"^(left|right) hip bone$", r"^sacrum$", r"^coccyx$"]
    for s in SIDES:
        g["humerus_" + s] = [r"^%s humerus$" % s]
        g["forearm_" + s] = [r"^%s (radius|ulna)$" % s]
        g["hand_" + s] = [r"^%s (scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate)$" % s,
                          r"^%s (first|second|third|fourth|fifth) metacarpal bone$" % s,
                          r"^(proximal|middle|distal) phalanx of %s %s$" % (s, FINGER)]
        g["femur_" + s] = [r"^%s femur$" % s]
        g["leg_" + s] = [r"^%s (tibia|fibula|patella)$" % s]
        g["foot_" + s] = [r"^%s (calcaneus|talus|cuboid bone|(medial|intermediate|lateral) cuneiform bone)$" % s, r"^navicular bone of %s foot$" % s,
                          r"^%s (first|second|third|fourth|fifth) metatarsal bone$" % s,
                          r"^(proximal|middle|distal) phalanx of %s %s$" % (s, TOE)]
    return g

def resolve(data_dir):
    names = {}
    for r in csv.reader(open(data_dir + "/parts_list_e.txt", encoding="utf-8", errors="replace"), delimiter="\t"):
        if len(r) >= 2 and r[0].startswith("FMA"): names[r[0]] = r[1].strip()
    out = {}
    for grp, pats in groups().items():
        ids = [(k, n) for k, n in names.items() if any(re.match(p, n) for p in pats)]
        out[grp] = sorted(ids, key=lambda x: x[1])
    return out

if __name__ == "__main__":
    for grp, ids in resolve(sys.argv[1]).items():
        for k, n in ids: print("%s\t%s\t%s" % (grp, k, n))

"""Cut product renders out of the LiveX spec sheets with point-prompted SAM,
then clean the matte (largest component + hole fill + 1px feather)."""
from rembg import remove, new_session
from PIL import Image, ImageFilter
import numpy as np, json, sys
from scipy import ndimage as ndi

A = '/home/user/livex/film/assets/'
S = new_session('sam')

# name: (sheet, crop box, [(x,y,label)...] in crop coords)
JOBS = {
  'paragon_front': ('paragon_sheet.jpg', (600,40,1100,1070),
     [(250,40,1),(120,55,1),(420,65,1),(70,500,1),(430,500,1),(250,950,1),(250,160,1),(250,500,1),(250,800,1),(65,160,1),
      (10,500,0),(480,500,0),(250,1020,0),(480,20,0),(10,20,0),(470,900,0)]),
  'paragon_back': ('paragon_sheet.jpg', (1320,50,1800,1060),
     [(240,40,1),(240,200,1),(240,500,1),(240,850,1),(80,500,1),(400,500,1),(420,60,1),(390,300,1),
      (5,500,0),(475,600,0),(240,1005,0),(10,10,0),(470,980,0)]),
  'gateway_front': ('gateway_sheet.jpg', (655,95,1180,1060),
     [(270,35,1),(75,450,1),(455,450,1),(270,300,1),(270,600,1),(270,880,1),(60,880,1),(460,880,1),(420,40,1),
      (10,300,0),(515,300,0),(10,40,0),(515,15,0),(515,700,0),(20,700,0)]),
  'gateway_back': ('gateway_sheet.jpg', (1190,115,1695,1045),
     [(240,40,1),(240,300,1),(240,600,1),(240,800,1),(80,450,1),(400,450,1),(250,855,1),(40,860,1),(470,860,1),
      (5,400,0),(500,400,0),(500,20,0),(10,10,0)]),
  'portal_32': ('portal_sheet.jpg', (520,225,890,895),
     [(185,300,1),(185,40,1),(40,300,1),(330,300,1),(185,620,1),(185,150,1),
      (5,300,0),(365,300,0),(185,665,0),(20,20,0),(350,20,0),(360,640,0)]),
  'portal_43': ('portal_sheet.jpg', (945,165,1355,930),
     [(205,350,1),(195,30,1),(35,350,1),(375,350,1),(205,700,1),(205,150,1),
      (5,350,0),(405,350,0),(205,760,0),(20,15,0),(390,15,0),(400,740,0)]),
  'portal_55': ('portal_sheet.jpg', (1410,85,1855,985),
     [(220,450,1),(230,35,1),(35,450,1),(410,450,1),(220,830,1),(220,150,1),
      (5,450,0),(440,450,0),(220,895,0),(20,15,0),(430,15,0),(440,870,0)]),
}

meta = {}
for name, (sheet, box, pts) in JOBS.items():
    src = Image.open(A + 'src/' + sheet).convert('RGB').crop(box)
    prompt = [{"type": "point", "data": [p[0], p[1]], "label": p[2]} for p in pts]
    out = remove(src, session=S, sam_prompt=prompt, only_mask=True)
    m = np.asarray(out) > 127
    lab, n = ndi.label(m)
    if n > 1:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        m = lab == (np.argmax(sizes) + 1)
    m = ndi.binary_fill_holes(m)
    m = ndi.binary_opening(m, iterations=1)
    alpha = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    rgba = src.copy(); rgba.putalpha(alpha)
    bb = rgba.getbbox(); rgba = rgba.crop(bb)
    rgba.save(A + f'cut/{name}.png')
    meta[name] = {'sheet': sheet, 'sheet_box': [box[0] + bb[0], box[1] + bb[1], box[0] + bb[2], box[1] + bb[3]], 'size': rgba.size}
    print(name, rgba.size, flush=True)

json.dump(meta, open(A + 'cut/cutouts.json', 'w'), indent=1)

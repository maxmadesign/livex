# Characters and the asset manifest

Every plush character is described by one entry in
`public/assets/plush/manifest.json` and one binary glTF file. The manifest is
the contract between the bake tool, the physics and the renderer: replacing a
character means replacing its entry and its file — no game code changes.

All 31 characters (six per theme, seven for GPU Party) are original designs,
modelled with the procedural tool in `tools/plush/` (signed-distance designs →
meshes, collision proxies, mass). Every character also carries a **textured,
AI-generated model** of the same design (much higher geometric detail, PBR
textures): it is what the game draws, while the collision proxies, mass and
footprint still come from the procedural design, and the procedural model stays
as the fallback. See [Textured (AI-generated) models](#textured-ai-generated-models).
No third-party character is included.

- [Manifest schema](#manifest-schema)
- [Custom vertex attributes](#custom-vertex-attributes)
- [LODs](#lods)
- [Collision proxies](#collision-proxies)
- [Textured (AI-generated) models](#textured-ai-generated-models)
- [Fitting the collision proxies to a generated model](#fitting-the-collision-proxies-to-a-generated-model)
- [Authoring a character](#authoring-a-character)
- [Adding or replacing a character](#adding-or-replacing-a-character)
- [In-app GLB import](#in-app-glb-import)
- [The 31 characters](#the-31-characters)

## Manifest schema

Types: `src/plush/manifest.ts` (`PlushManifest`, `PlushAsset`). Lengths are in
metres, masses in kilograms, at toy scale 1 (the game multiplies by *Toy size*,
default 0.92). Axes: +Y up, +Z is the character's front, origin at the centre of the base it sits on.

Top level:

| Field | Meaning |
| --- | --- |
| `version` | Schema version, currently `4` (adds `model.textured` and the AI-generation provenance fields). Version 3 files are read unchanged; an older or newer version is read with a warning in *Settings → System* (`normalizeManifest` in `src/plush/manifest.ts`). |
| `generator` | Tool that wrote the file (`tools/plush (procedural SDF modelling, v1)`). |
| `assets` | Array of characters, six per theme (seven for GPU Party). |

One asset:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable id `"<theme>.<slug>"`, e.g. `sakura.bunny`. Used by settings, the collection and the AI guide. |
| `theme` | `sakura` \| `storybook` \| `ocean` \| `cosmic` \| `gpu` | Theme the character belongs to. |
| `slug` | string | File name stem. |
| `name` | `{ en, zh, ja }` | Display name. |
| `kind` | `{ en, zh, ja }` | One-line public description (UI and guide). |
| `size` | `[x, y, z]` | Bounding size (width, height, depth). |
| `mass` | number | Mass in kg (the shipped toys are 190–300 g). |
| `footprint` | number | Radius of the sitting footprint; used to place toys without overlap. |
| `comHeight` | number | Height of the centre of mass above the base. |
| `palette` | string[] | Main colours, most dominant first (also the colour of the stand-in shown if the model fails to load). |
| `materials` | string[] | Surface kinds present (`fur`, `shortfur`, `felt`, `thread`, `bead`, `satin`, `gloss`, `knit`, `metal`). |
| `model.path` | string | GLB path relative to the site root. |
| `model.bytes` | number | File size. |
| `model.lods[]` | `{ mesh, triangles, vertices }` | Mesh names inside the GLB (`LOD0`…`LOD2`) with their real counts. Empty for a standard glTF model. |
| `model.attributes` | string[] | Custom vertex attributes present (see below). |
| `model.textured` | object, optional | Textured model drawn instead of the procedural one (see [Textured models](#textured-ai-generated-models)): `path`, `bytes`, `lods[]` (mesh names and real counts), `attributes`, `textures` (variants `512` / `1k` / `2k`: `size`, `embedded`, `baseColor` / `normal` / `roughness` WebP paths, `bytes`) and `fit` (how the model was fitted, how well it matches the proxies, and `reference`: a hash of the procedural model and proxies it was fitted to). |
| `paint[]` | objects | Up to four appliqué colour regions: `name`, `channel` (0–3, component of `_MASK`), `color`, `stitch` / `stitchColor` / `stitches` (embroidered border), and `center`, `axisU`, `axisV` (local frame that parameterises the stitches). |
| `maskRange` | number | Distance in metres that maps to ±1 in `_MASK`. |
| `proxies[]` | objects | Collision shapes — see [Collision proxies](#collision-proxies). |
| `deform.softAttribute` | `"_AUX.x"` | Where per-vertex softness lives. |
| `deform.dentRadius` | number | Typical finger dent radius. |
| `deform.sag` / `squash` / `sway` | 0…1 | How much the toy stretches when hanging, flattens on impact, and how far floppy parts lag. |
| `deform.softParts` | string[] | Names of floppy parts (documentation / tuning). |
| `source.status` | `original` \| `original-replaceable` \| `licensed` | Provenance flag shown in the settings dialog. All shipped characters are `original` or `original-replaceable`; `licensed` is for a third-party model you add yourself. (`user-import` exists only at run time, never in the manifest.) |
| `source.method` | `procedural-sdf` \| `external` \| `ai-generated` | How the visible model was made. |
| `source.generator` | string | Design that produced it, e.g. `tools/plush/designs/sakura.ts#bunny`; for `ai-generated`: `Higgsfield: gpt_image_2_6 concept + meshy_v7_image_to_3d`. |
| `source.license`, `source.note` | string | Licence statement and remarks. |
| `source.design` | string, optional | The procedural design behind an AI-generated model (proxies, mass, fallback). |
| `source.jobs` | `{ concept?, model? }`, optional | Generation job ids (concept photo, image-to-3D). |
| `source.rawSha256`, `source.qa` | string, optional | Hash of the raw generated file the import used; QA verdict recorded by the generation batch. |

## Custom vertex attributes

Written by the bake tool, read by `src/plush/PlushMaterial.ts` (Three.js lower-cases the names):

| glTF attribute | Components | Use |
| --- | --- | --- |
| `COLOR_0` | linear RGB, A = baked ambient occlusion | Base fabric colour and contact shading |
| `_MASK` | signed distance to paint regions 0–3, normalised to ±1 over `maskRange` | Appliqué colours and stitch lines are evaluated **per pixel** from this distance, so edges stay crisp at every LOD without textures |
| `_SURF` | roughness, sheen, gloss (clear coat), fur length | Per-vertex material response: plush pile, satin ribbon, glossy bead eyes |
| `_AUX` | softness (0 firm … 1 floppy), signed seam distance (0.5 = on a seam), metalness, thread amount | Soft-body deformation weights, seam lines between sewn pieces, embroidery |

Attributes are stored quantised (`KHR_mesh_quantization`) and the file is
compressed with `EXT_meshopt_compression`; the decoder ships with Three.js, so
no network access is needed. The 31 files total about 6.7 MB.

A textured model carries only `POSITION`, `NORMAL`, `TEXCOORD_0` and its own `_AUX`:

| glTF attribute | Components | Use |
| --- | --- | --- |
| `_AUX` (textured) | softness, fur length, sheen, baked ambient occlusion | Same softness channel (x) as above, so deformation code and `deform.softAttribute` are shared; fur length drives the shell fur, sheen the minky back-scatter, AO the contact shading |

## LODs

Each GLB contains three meshes produced with meshoptimizer's attribute-aware
simplifier: about **15 000**, **5 200** and **1 700** triangles (textured models: about
**41 000**, **12 000** and **4 000**, see below). Which one is drawn depends on
*Graphics → Model detail*, on focus (the toy under the claw or in its grip) and, on
Medium, on how large the toy is on screen (`src/scene/ToyVisuals.ts`):

| Model detail | Focused toy | Other toys | Shadow map and contact-shadow passes |
| --- | --- | --- | --- |
| Low | LOD1 | LOD2 | LOD2 |
| Medium | LOD0 | LOD1, or LOD2 while the toy is less than 150 px tall on screen (`LOD2_BELOW_PX`) | LOD2 |
| High | LOD0 | LOD0 | LOD1 |

*Softness detail* `fine` forces LOD0 for the focused toy and `ultra` for every
toy, because finer dents need denser meshes (`ultra` also draws shadows with LOD1).
LOD choice is visual only. The on-screen size is measured every frame with the
camera that is about to render (the stage calls `ToyVisuals.updateView` just before
drawing), so the choice follows the window, the head position and the internal
resolution. At 1280 × 720 the toys on the field are 74–103 px tall, at 1080p about
1.5 × that; the focused / held toy is never affected.

The shadow passes draw each toy's `userData.shadowGeometry` (the LOD in the last
column) and skip fur shells (`userData.shadowSkip`): those passes are soft or blurred,
and the coarse silhouette cannot be told apart in them. Both shadow passes use the
same soft-body deformation as the visible toy (`PlushDepthMaterial` for the key light,
a deforming height material for the contact shadows).

Textured models use the same table with their own LODs: about **41 000** (the
generated mesh as is, capped at 45 000), **12 000** and **4 000** triangles.
Because they are denser, their shell fur is drawn on the next coarser LOD
(LOD1 for the focused toy; LOD2 for the other toys with *plush detail* "shell,
high"), and display-bay toys use the LOD closest to 5 000 triangles.

Measured triangle counts per frame with the Sakura characters textured (18 toys,
1280 × 720, software WebGL — counts only, they say nothing about frame rate); "whole
frame" counts every pass, the range covers frames with and without a contact-map refresh.
The full per-tier tables are in [PERFORMANCE.md](PERFORMANCE.md#triangle-budget-round-3):

| Medium, Sakura | Toys, main pass | Whole frame, before this round | Whole frame now |
| --- | --- | --- | --- |
| Attract | 72 k (was 216 k) | 517 k – 733 k | 229 k – 300 k |
| Round ready (claw parked) | 72 k (was 216 k) | 516 k – 733 k | 228 k |
| Toy held (LOD0 + 10 shell layers on LOD1) | 229 k (was 365 k) | 695 k – 940 k | 386 k – 458 k |

## Collision proxies

The physics never sees render meshes. Each character has a small compound of
convex hulls (three to seven per character):

| Field | Meaning |
| --- | --- |
| `part` | Body part the hull stands for (`body`, `head`, `earL`, …). |
| `role` | `core` — carries weight when gripped. `appendage` — ears, tails, limbs: weak handles; the grip evaluation measures how much of the contact is on core parts. Appendage colliders hit the claw and the cabinet but not other toys, so piles settle on bodies rather than on ears. |
| `geometry` | `{ type: "hull", points: [x, y, z, …] }` in the toy's local frame. The types `ball`, `capsule` and `cuboid` are also accepted. |
| `pos`, `rot` | Local transform of the shape. |
| `massFraction` | Share of the toy's mass; all fractions sum to 1. Together with the shapes this fixes the centre of mass and inertia. |

Proxies are generated from the design: parts that share a `group` are wrapped
by one hull, and a ring of floor-level points keeps sitting toys stable.

## Textured (AI-generated) models

**What they are.** For each original design, a reference render of the
procedural model was turned into a realistic plush product photo (Higgsfield,
`gpt_image_2_6`) and that photo into a textured mesh (Higgsfield,
`meshy_v7_image_to_3d`, ultra mode: one mesh of about 40 000 triangles,
2048² base colour, normal and metallic-roughness maps). The raw files are
**not** part of the repository; `npm run assets:import` turns them into game
assets. All 31 characters have one (the seven GPU Party models were imported once
their designs were baked into the manifest).

**Files** (next to the procedural `<slug>.glb`, which stays as the fallback):

| File | Content |
| --- | --- |
| `public/assets/plush/<theme>/<slug>.gen.glb` | LOD0 / LOD1 / LOD2 meshes, one material with the **512²** textures embedded as WebP (`EXT_texture_webp`); geometry quantised (`KHR_mesh_quantization`: int16 positions dequantised by the node transform, int8 normals, uint16 UVs, uint8 `_AUX`) and meshopt-compressed. A standalone, valid glTF. |
| `<slug>.gen-1k.{color,normal,rough}.webp` | 1024² base colour (sRGB), tangent-space normal map, metallic-roughness (G = roughness, metalness cleared) |
| `<slug>.gen-2k.{color,normal,rough}.webp` | the same at 2048² (the roughness map stays at 1024²: it varies slowly, and this saves a third of the tier's GPU memory) |

**Import** (`tools/plush/import-generated.ts`, building blocks in `tools/plush/generated.ts`):

```bash
npm run assets:import -- --raw <dir>                    # every <id>.glb in <dir> that has a manifest entry
npm run assets:import -- --raw <dir> sakura.bunny       # one character (ids, slugs or themes)
npm run assets:import -- --raw <dir> --dry-run          # measure and report only
# options: --meta <file> (job ids / QA verdicts; default <dir>/../manifest.json, then <dir>/../state.json)
#          --force  --report <file.json>  --yaw <id>=<deg>  --scale <id>=<factor>   (or PLUSH_RAW_DIR=<dir>)
```

Per character it:

1. reads the raw GLB (node transforms applied, all primitives merged — one material only), welds positions
   so UV-seam wedges share bitwise identical positions, merges duplicate vertices, drops degenerate triangles;
2. **fits** it to the procedural model of the same id: yaw in 90° steps (0° unless another is clearly better —
   generators face +Z), uniform scale starting from the design height and refined ±12 % by surface distance,
   base on y = 0, centred on the design's footprint. It never stretches non-uniformly;
3. computes `_AUX`: softness, fur, sheen and AO are transferred from the procedural model (nearest
   neighbours) — floppy ears and tails stay floppy, satin bows and bead eyes get no fur — falling back to
   the collision proxies where the shapes differ (fur takes the minimum of the nearest design points, so
   bows, eyes and patches keep clean edges) (appendage hulls soft, the body softer away from the core
   hulls); fur and sheen fade out on glossy texels of the roughness map; then smoothed over the mesh;
4. **checks the mesh against the collision proxies**, which are kept from the design together with mass and
   footprint: share of the surface more than 1 cm outside the proxies, 95th percentile / maximum distance,
   the same numbers for the procedural model as a baseline, and proxy points lying outside the visual mesh
   (collisions with nothing visible). The verdict (`ok` / `check` / `mismatch`) goes into `model.textured.fit`
   and the report; nothing is corrected automatically;
5. builds LODs with meshoptimizer's attribute-aware simplifier (normals, UVs, softness weighted). Seams are
   kept intact (seam wedges only collapse along the seam); generated atlases have many small UV charts, so
   where that cannot reach the target (often LOD2) the simplifier may collapse across seams with a high UV
   weight — the report lists `kept` / `relaxed` per LOD. LOD0 keeps the generated mesh up to 45 000 triangles;
6. encodes the textures as WebP (base colour q88, normal and roughness q90) at 512, 1024 and 2048 (never
   upscaled), writes the files and updates the entry: `model.textured`, `source.method: "ai-generated"`,
   generator, job ids, raw-file hash, licence note.

The import is idempotent: an unchanged raw file (same SHA-256, same importer version, outputs present,
fitted to the current design) is reported as up to date; ids without a raw file are skipped and keep their
procedural model; raw files without a manifest entry are listed (bake the design first).
`npm run assets:plush` keeps an entry's `model.textured` and provenance (including the import's note, which
records the importer version) when it re-bakes the design. `fit.reference` holds a SHA-256 of the procedural
model file and the collision proxies the generated mesh was fitted to: after a design change and a re-bake it
no longer matches, and the next `npm run assets:import` refits that character on its own (entries imported
before the field existed count as current; use `--force` for them).

**Rendering** (`src/plush/PlushMaterial.ts` with `textures`, `src/scene/ToyVisuals.ts`): the textured model
gets the same `PlushMaterial` as the procedural one, compiled with `PLUSH_TEXTURED`:

- the full soft-body deformation (finger dents at real contacts, hanging sag, motion sway / drag, landing
  squash and rebound, release recovery), the deformed-normal recomputation and the shadow depth material
  with the same deformation (`PlushDepthMaterial` with `textured`);
- base colour, tangent-space normal map (derivative tangent frame, no `TANGENT` attribute needed) and
  roughness from the metallic-roughness map; metalness is forced to 0; fabric texels are pushed towards a
  dull response (`uFabricRough`) while glossy texels (eyes) keep their roughness and get a clear coat;
- sheen tuned for minky pile (tinted by the base colour, scaled by `_AUX` sheen);
- a fabric micro relief for close-ups: a tileable pile / fibre texture generated once at run time
  (`fabricMicroTexture`, 256²), sampled triplanar in the toy's rest space (constant density, invisible UV
  seams), faded by pixel size, strength by plush detail (flat 0, sheen 0.65, shell 1);
- shell fur on the tiers that use it, coloured by the base-colour map, fur length from `_AUX`.

**Texture resolution** follows *Graphics → Textures*: 512 → 512, 1K → 1024, 2K → 2048, 4K → 2048 (the
closest available variant, `pickTextureTier`). A change swaps the textures of the materials in place (no
shader recompile) and frees the previous variant. If the renderer is not told the setting, it follows
*Model detail* (low 512, medium 1K, high 2K, as in the presets).

**Fallbacks** (never an empty machine): a missing or broken `.gen.glb` → the procedural model, with a warning
under *Settings → System → Warnings*; a missing larger texture variant → the embedded 512² textures, with a
warning; a missing procedural model too → the coloured stand-in. A player's in-app import (Route B) still
takes precedence over both; if that import cannot be used, the slot falls back to its textured model (then
the procedural one). When the setting changes quickly, the latest request wins: a larger variant that
arrives after a newer request is freed, not shown. For comparisons, `?models=procedural` in the URL draws every procedural model.

**Replace or regenerate one model.** Generate a new raw GLB for the id (any image-to-3D tool that writes one
textured mesh: base colour, ideally normal and metallic-roughness maps, character upright and facing +Z), put
it in a raw folder as `<id>.glb` and run `npm run assets:import -- --raw <folder> <id> --force`. Check the
report: yaw, size ratio against the design, distance to the procedural shape and the proxy verdict. If the
yaw or size is wrong, pass `--yaw <id>=<deg>` / `--scale <id>=<factor>` (or add the correction to `OVERRIDES`
in `import-generated.ts` so re-runs reproduce it). If the verdict is `mismatch`, either adjust the design so its
proxies match the new silhouette (see [Fitting the collision proxies](#fitting-the-collision-proxies-to-a-generated-model);
`npm run assets:plush -- <slug>`, then `npm run assets:import`) or generate a closer model.
To go back to the procedural model, delete `model.textured` from the entry and set `source` back to the design's
values (or re-bake after removing the `.gen.*` files and the `textured` field).

**Provenance and licence.** Entries record `source.method: "ai-generated"`, the generator string, the
concept and model job ids, the raw-file hash and `source.design` (the original design they were made
from). The licence note in `source.license` says: generated with Higgsfield from an original PLUSH PORTAL
design — **check Higgsfield's current terms of service** (ownership and commercial use depend on the account
plan) before distributing the assets. The character designs themselves are original to this project.

One more check before distributing: the design of `gpu.chief` ("Keynote Chief") is a generic presenter, but its
generated model (grey swept-back hair, glasses, black leather jacket) reads much closer to a recognisable public
figure than the procedural design does. Whether that likeness is acceptable is a decision for whoever ships the
assets; replacing that one model follows the steps above.

## Fitting the collision proxies to a generated model

The physics never sees the generated mesh, so where it differs from the design a toy can
look wrong: visible parts without a collider pass through the claw or sink into the floor or
other toys, and colliders where nothing is drawn make a toy float or get grabbed by an
invisible part. The import measures both (see step 4 above); the fix is to change the
**design** until its hulls follow the generated silhouette, never the physics code.

```bash
# Read-only: bakes the current design in memory, fits the raw model as the import does and
# reports the verdict, per proxy part and (optionally) per 2 cm height slice and as a picture.
npx tsx tools/plush/fit-diagnose.ts --raw <raw dir> sakura.tanuki [more ids] [--slices] [--png <dir>]
npm run assets:plush -- tanuki     # then bake the design …
npm run assets:import -- --raw <raw dir>   # … and import: the changed design is refitted automatically
npx tsx tools/dev/grip-sweep.ts --themes sakura --offsets 0,1.5,3,4.5 --seeds 3   # grab regression
```

The picture (`fit_<id>.png`) shows side, front and top silhouettes: dark grey where mesh and
proxies overlap, light grey where the mesh has no collider, red where a collider has no mesh.
A band of light grey about 1 cm wide all round is normal (proxies sit inside the fur). Things
to watch while changing a design:

- **Footprint.** It is the farthest core point below 3.5 cm from the origin and decides how
  closely toys are packed. Making long feet `core` once raised the tanuki's footprint from 7.2
  to 10.4 cm, fewer toys fitted on the floor, more lay on top of others and the Sakura centred
  win rate fell from 100 % to 80 %; feet stay `collide: 'none'` (merged into the body hull where
  they touch it) for that reason. Small changes of the first characters a seed places also
  change the whole pile: the headless tests in `tests/unit/game` (`rounds.test.ts`,
  `ToyField.test.ts`) play fixed seeds and caught two such cases (a 7.4 cm deep seal body, footprint
  10.0 cm, left an Ocean turtle leaning at seed 3; a 7.0 cm wide tanuki body turned the off-centre
  grab test from a slip into a miss). The shipped values (seal body 7.7 cm deep, footprint 8.9 cm;
  tanuki body 6.7 cm wide as before) pass them; run them after every proxy change.
- **Appendages** (`collide: 'appendage'`) hit the claw and the cabinet but not other toys, so a
  big appendage blocks the claw from its neighbours. A hull around two parts also fills the gap
  between them: give separate parts (tentacles) their own group.
- **Decoration the generated model does not have** (a wind-up key, a thin antenna) should be
  `collide: 'none'`.
- The flat-base ring of every hull (points at y = 0) spans the gap between two feet under a toy;
  the gap statistic counts it (`fit-diagnose` also prints the value without it). It is under the
  toy, where neither the claw nor another toy can reach, and it keeps toys from rocking.

Changes made with this procedure in round 3 (verdict before → after; grab regression in
[PERFORMANCE.md](PERFORMANCE.md#physics-after-the-proxy-changes) and below):

| Character | Change to the design | Verdict |
| --- | --- | --- |
| `sakura.tanuki` | Big tail lying behind on the floor (as generated), deeper body, larger head, paws further forward (no collider) | mismatch → check |
| `ocean.jellyfish` | Seven tentacles at the generated model's angles (the back one shorter), one hull per tentacle, frill in the bell's hull | mismatch → ok |
| `ocean.seal` | Rounder, deeper body and head, tail fins replaced by a small nub without a collider | mismatch → ok |
| `cosmic.spacerobot` | Wind-up key without a collider (the generated robot has none) | mismatch → ok |
| `gpu.chief` | Seat and torso moved forward / slimmer at the back | check → check (gap p95 1.8 cm, 0.8 cm without the floor ring) |
| `gpu.bot` | Antenna without a collider, rounder head | check → check (gap p95 1.0 → 0.4 cm) |
| `gpu.pixel` | Arms moved forward and in | check → check (gap p95 1.9 → 1.4 cm; 1.7 → 1.0 cm without the floor ring) |
| `storybook.robot`, `storybook.scarfpuppy` | Reviewed, unchanged: their "0.74–0.76 of the design depth" is decoration without a collider (the robot's wind-up key, the puppy's tail); hulls fit (gap p95 0.7 cm, verdict ok) | ok |

## Authoring a character

Designs live in `tools/plush/designs/<theme>.ts` and use the vocabulary in
`tools/plush/dsl.ts`. Units are **centimetres**. A design is a list of

- **layers** — separately meshed surfaces (furry body, satin bow, glossy helmet), each a smooth union of signed-distance **parts**;
- **paints** — appliqué regions evaluated per pixel (inner ears, belly, paw pads);
- **patches** — small sewn-on or embroidered features projected onto the surface (eyes, nose, mouth, blush, tag).

Real excerpt (`tools/plush/designs/sakura.ts`, the Mochi Bunny), annotated:

```ts
export const bunny: PlushDesign = {
  slug: 'bunny',
  theme: 'sakura',
  name: { en: 'Mochi Bunny', zh: '麻薯长耳兔', ja: 'もちうさぎ' },
  kind: { en: 'cream lop-eared bunny with a ribbon bow', /* zh, ja */ },
  status: 'original',
  note: 'Original character.',
  height: 20.5,            // finished height in cm; the model is scaled uniformly to match
  mass: 0.23,              // kg
  layers: [
    {
      name: 'body',
      surface: 'fur',      // long plush pile → roughness / sheen / fur length in _SURF
      flatBase: 1.4,       // cut at y = 0 with a 1.4 cm rounded edge so it sits flat
      parts: [
        // ell(name, centre, radii, colour, options) — an ellipsoid.
        // collide: 'core'  → gets its own weight-bearing hull.
        // k                → blend radius (cm) when merged into the layer.
        ell('body', [0, 5.4, 0], [6.3, 5.9, 5.7], CREAM, { collide: 'core', k: 2.2 }),
        ell('head', BUNNY_HEAD_C, BUNNY_HEAD_R, CREAM, { collide: 'core', k: 2.4 }),
        // pair(...) mirrors a part to both sides (earR / earL).
        // soft: 0.95 with root + reach → softness grows from the attachment point
        // to the tip, which is what makes the ears flop and lag (_AUX.x).
        // collide: 'appendage' → a weak-handle hull of its own.
        ...pair(
          part('ear', scaled(smoothTube([[5.3, 16.4, -0.2], [8.2, 15.5, 0.1], [9.4, 12.2, 0.6], [9.3, 8.2, 1.0]],
                                        [1.4, 1.8, 2.15, 2.3]), [7.6, 13, 0.4], [1, 1, 0.5]),
               CREAM, { soft: 0.95, collide: 'appendage', k: 1.5, root: [5.3, 16.4, -0.2], reach: 12 }),
        ),
        // collide: 'none' → visual only; group: 'body' folds the feet into the body hull.
        ...pair(cone('arm', [5.0, 8.9, 2.4], [6.4, 5.9, 4.5], 1.7, 1.9, CREAM, { soft: 0.5, k: 1.3, collide: 'none' })),
        ...pair(ell('foot', [3.7, 1.7, 5.0], [2.5, 1.9, 3.3], CREAM, { soft: 0.3, k: 1.2, collide: 'none', group: 'body' })),
        ball('tail', [0, 3.6, -5.9], 2.1, '#ffffff', { soft: 0.4, k: 0.9 }),
      ],
    },
    // A second layer is meshed separately: no seams, 1.9× mesh density for the thin ribbon.
    { name: 'bow', surface: 'satin', seams: false, detail: 1.9,
      parts: bow(lift(bunnyBowSpot.p, bunnyBowSpot.n, 0.5), bunnyBowSpot.n, -8, 1, ROSE) },
  ],
  paints: [
    // channel = component of _MASK; fn is a distance function, negative inside = painted.
    { name: 'innerEar', channel: 0, fn: bothSides(ellipsoid([9.15, 11.2, 1.75], [1.35, 3.9, 1.0], [0, 0, -2])), color: PINK, stitch: true },
    { name: 'belly',    channel: 1, fn: ellipsoid([0, 5.2, 5.2], [3.5, 3.7, 2.4]), color: WHITE, stitch: '#f1ddc4' },
    { name: 'pads',     channel: 2, fn: bothSides(ellipsoid([3.7, 1.8, 8.1], [1.35, 1.2, 1.2])), color: PINK },
  ],
  patches: [
    ...eyes({ at: onFront(BUNNY_HEAD_C, BUNNY_HEAD_R, 2.75, 13.7), r: 0.78, style: 'sparkle' }),   // bead eyes + highlights
    nose(onFront(BUNNY_HEAD_C, BUNNY_HEAD_R, 0, 12.75), 0.48, 0.36, ROSE),
    ...wMouth(onFront(BUNNY_HEAD_C, BUNNY_HEAD_R, 0, 12.3), 0.95, 0.42, 0.17),                     // embroidered "w" mouth
    blush(onFront(BUNNY_HEAD_C, BUNNY_HEAD_R, 4.55, 12.35), 1.05, 0.7, BLUSH),
    sideTag(4.4, 6.2, ROSE),                                                                         // folded fabric tag in a seam
  ],
  deform: { sag: 0.65, sway: 0.9, squash: 0.6 },
};
```

What `npm run assets:plush` does with it (`tools/plush/build.ts`, `mesher.ts`, `glb.ts`):

1. Each layer's distance field is meshed with surface nets (0.27 cm cells, finer for `detail > 1`).
2. Per-vertex colour, baked AO, paint distances, surface response, softness and seam distance are computed.
3. Patches are projected onto the surface as thin geometry.
4. Three LODs are simplified to the triangle budgets, split between layers by area.
5. Collision hulls, mass fractions, footprint and centre-of-mass height are derived.
6. The model is scaled to `height`, written as a quantised, meshopt-compressed GLB, and the manifest entry is updated.

Primitives available: `ell`, `ball`, `cone`, `box`, `cyl`, `ring`, `pipe`,
`part` (any distance function), `pair` (mirror); face helpers `eyes`, `nose`,
`smile`, `wMouth`, `blush`; outline helpers for appliqués (`starOutline`,
`heartOutline`, `flowerOutline`, `boltOutline`, `ovalOutline`).

Preview while designing: `npm run dev`, then open
`/viewer.html?ids=sakura.bunny` (options are listed at the top of `src/dev/viewer.ts`).

## Adding or replacing a character

**Edit an existing design**

```bash
# edit tools/plush/designs/sakura.ts
npm run assets:plush -- bunny        # one character; the manifest keeps the others
npm run assets:plush -- sakura       # one theme
npm run assets:plush                 # everything
```

**Add a design**: export a new `PlushDesign` from the theme file and add it to
that theme's design list (collected in `tools/plush/designs/index.ts`), then
bake. The game reads the theme's characters from the manifest; names for the UI
and the guide come from the manifest entry, so no string tables need editing.

**Replace a slot with an externally made model** (for example a licensed
character). No procedural tool and no special vertex data are needed: the
manifest loader (`src/plush/PlushLibrary.ts`) accepts an ordinary glTF model.

*Route A — through the manifest (recommended; ships with the build).*

1. Export a standard binary glTF 2.0 file (`.glb`): static meshes, its own PBR
   materials, embedded textures, the character facing +Z and standing on y = 0.
   Meshopt compression and quantisation are fine; **Draco is not** (the loader has no Draco decoder).
2. Put it under `public/assets/plush/<theme>/` — for the prepared slot:
   `public/assets/plush/sakura/biribi.glb`.
3. Edit the slot's manifest entry:
   - `model.path`, `model.bytes`; set `model.lods` and `model.attributes` to `[]` and `paint` to `[]` (they describe plush-shader data the file does not have);
   - `name`, `kind`, `palette`;
   - `size` — the model is scaled uniformly so that its height equals `size[1]`, centred and placed on its base;
   - `mass`, `footprint`, `comHeight` and `proxies` so that the collision shape matches the new silhouette (physics uses only these, never the mesh);
   - `source.status: "licensed"`, `source.method: "external"`, and `source.license` / `source.note` with the real licence terms.
4. Keep `id` so the slot keeps its place in saved collections and settings.

What happens at run time: a file whose meshes do not carry the plush attributes
is rendered through the same path as an in-app import — its own materials and
textures, plus the shared soft-body deformation driven by a generated softness
attribute. Paint masks, seam lines and shell fur do not apply, and it is a
single mesh set (no LOD switching). The loader records an informational note in
`PlushLibrary.notes`; this is not a warning.

A file that cannot be loaded at all — missing, corrupt, Draco-compressed, or
without any mesh — is replaced by a simple stand-in in the slot's main colour,
and the reason appears under *Settings → System → Warnings*.

A GLB that *does* follow the plush contract (meshes named as in `model.lods`,
each with `POSITION`, `NORMAL`, `COLOR_0`, `_MASK`, `_SURF`, `_AUX`) gets the
full plush material, LODs and shell fur; that is what `npm run assets:plush` produces.

`npm run assets:plush` rewrites the manifest entries of the designs it bakes.
Once a slot is maintained by hand, remove its design from the theme's list (or
bake other characters selectively by name) so the entry is not overwritten.

*Route B — in-app import (per device, no build).* See
[In-app GLB import](#in-app-glb-import). The import is ignored for a slot whose
manifest model is already a standard glTF model (Route A).

`sakura.biribi` is the slot prepared for Route A: an original "electric cutie"
character marked `original-replaceable`. It is **not** a third-party character
and none ships with the project; the settings dialog labels it
"Original — slot ready for a licensed model".

## In-app GLB import

*Settings → Themes & Toys → (character) → Replace model…* swaps the look of one
slot on this device without touching any file (`src/plush/customModels.ts`).

| | |
| --- | --- |
| Format | Binary glTF 2.0 (`.glb`), static meshes, embedded textures. `EXT_meshopt_compression` and `KHR_mesh_quantization` are supported. |
| Not supported | Draco compression, separate `.gltf` + files, skinning and animation (the mesh is used in its rest pose). |
| Size limit | 20 MB |
| Storage | IndexedDB database `plush-portal-models` on this device. Settings store only a reference (slot id, file key, file name, display name, scale, yaw). Exported configurations carry that reference, never the file. |
| Fitting | Centred, placed on its base, scaled to the slot's height × the per-model scale, rotated by the per-model yaw. |
| Physics | Unchanged: the slot keeps its collision proxies, mass and name, so game balance does not change. A model whose silhouette differs a lot from the slot will visibly not match its collisions. |
| Shading | The model's own materials are kept; soft-body deformation is applied through a generated softness attribute (firmer near the vertical axis and the base). Paint masks, seams, shell fur and LOD switching are not available for imported models. |
| Rejections | `too_large`, `not_glb`, `unsupported_version`, `draco`, `no_mesh`, `parse_error` — shown as a message; nothing is stored. |

*Use built-in model* removes the import. You are responsible for having the
right to use any model you import; the status line then reads "Your imported model".

## The 31 characters

Sizes are width × height × depth at scale 1. "Proxies" is the number of
collision hulls, "LOD triangles" the real counts of LOD0 / LOD1 / LOD2 of the
procedural model (the textured models are listed below).

| Id | Name | 中文 | 日本語 | Description | Size (cm) | Mass (g) | Footprint (cm) | Proxies | LOD triangles | File (KB) | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sakura.bunny` | Mochi Bunny | 麻薯长耳兔 | もちうさぎ | cream lop-eared bunny with a ribbon bow | 23.6 × 20.5 × 16.5 | 230 | 6.9 | 4 | 14998 / 5198 / 1698 | 224 | original |
| `sakura.biribi` | Biribi | 噼哩比 | ビリビ | lemon-yellow electric hamster sprite with a power-plug tail | 23.2 × 21.4 × 16.7 | 250 | 7.1 | 3 | 14996 / 5196 / 1724 | 219 | original-replaceable |
| `sakura.sakuracat` | Sakura Neko | 樱花猫 | さくらねこ | cherry-blossom pink cat with a flower on its head | 20.8 × 21.0 × 15.5 | 220 | 6.6 | 6 | 14994 / 5196 / 1848 | 225 | original |
| `sakura.capybara` | Yuzu Capy | 柚子水豚 | ゆずカピバラ | sleepy capybara balancing a yuzu on its head | 13.8 × 20.2 × 20.0 | 290 | 8.9 | 3 | 14998 / 5198 / 1718 | 221 | original |
| `sakura.tanuki` | Pon Tanuki | 砰砰狸猫 | ぽんぽこたぬき | round-bellied tanuki with a lucky leaf on its head | 17.0 × 21.0 × 24.3 | 270 | 8.0 | 3 | 14998 / 5198 / 1728 | 225 | original |
| `sakura.monster` | Marumon | 圆滚滚小怪兽 | まるもん | round mint monster with tiny horns and one tooth | 23.4 × 17.5 × 18.6 | 240 | 7.5 | 6 | 14999 / 5200 / 1699 | 230 | original |
| `storybook.astronaut` | Captain Comet | 彗星小队长 | コメット隊長 | plush astronaut | 18.8 × 21.0 × 13.8 | 250 | 8.3 | 4 | 14998 / 5198 / 1698 | 235 | original |
| `storybook.hornmonster` | Grumble | 咕噜长角怪 | グランブル | friendly long-horned furry monster | 19.7 × 21.5 × 16.7 | 290 | 8.6 | 6 | 14998 / 5198 / 1698 | 221 | original |
| `storybook.robot` | Bolt-Bolt | 叮当小机器人 | ボルトボルト | soft toy robot | 19.6 × 21.5 × 16.1 | 270 | 7.5 | 4 | 14998 / 5198 / 1698 | 226 | original |
| `storybook.scarfpuppy` | Biscuit | 围巾小狗饼干 | ビスケット | puppy with a knitted scarf | 21.9 × 19.5 × 17.1 | 230 | 8.4 | 4 | 14999 / 5198 / 1697 | 226 | original |
| `storybook.dino` | Pudge | 胖嘟嘟恐龙 | ぽっちゃりザウルス | chubby dinosaur | 19.6 × 20.5 × 20.5 | 300 | 8.5 | 3 | 14999 / 5198 / 1697 | 223 | original |
| `storybook.cowpony` | Sheriff Clover | 三叶草小警长 | クローバー保安官 | little cowboy pony | 14.7 × 22.0 × 20.6 | 260 | 7.9 | 3 | 14996 / 5196 / 1696 | 219 | original |
| `ocean.whale` | Bubble Whale | 泡泡鲸 | あわくじら | chubby sea-salt blue whale | 20.8 × 18.0 × 21.3 | 300 | 8.6 | 4 | 14998 / 5208 / 1774 | 218 | original |
| `ocean.octopus` | Pom Octopus | 啵啵章鱼 | ぽむたこ | lavender octopus with curly arms | 20.7 × 18.0 × 19.4 | 220 | 5.9 | 5 | 15000 / 5200 / 1700 | 222 | original |
| `ocean.axolotl` | Dewy Axolotl | 露露蝾螈 | つゆウーパー | pink axolotl with lilac gills | 23.1 × 19.0 × 16.2 | 210 | 6.8 | 5 | 15000 / 5200 / 1700 | 232 | original |
| `ocean.jellyfish` | Moon Jelly | 月光水母 | つきくらげ | aqua jellyfish with a frilly bell | 20.3 × 18.5 × 18.1 | 190 | 4.5 | 9 | 15000 / 5200 / 1700 | 254 | original |
| `ocean.seal` | Snowy Seal | 雪团海豹 | ゆきあざらし | white baby seal in an aqua scarf | 17.1 × 19.0 × 18.2 | 260 | 8.9 | 4 | 14998 / 5198 / 1720 | 211 | original |
| `ocean.turtle` | Pebble Turtle | 鹅卵石海龟 | こいしがめ | mint sea turtle with a lilac shell | 17.4 × 20.0 × 17.9 | 270 | 8.0 | 4 | 14998 / 5198 / 1698 | 225 | original |
| `cosmic.spacebunny` | Comet Bunny | 彗星太空兔 | コメットうさぎ | bunny in a soft space suit | 15.3 × 23.0 × 14.8 | 240 | 7.0 | 4 | 14998 / 5198 / 1698 | 225 | original |
| `cosmic.starbear` | Twinkle Bear | 眨眨星星熊 | きらぼしクマ | sleepy bear with a stitched star on its belly | 19.3 × 22.0 × 16.8 | 270 | 6.9 | 7 | 14998 / 5198 / 1698 | 226 | original |
| `cosmic.alien` | Blip | 啵啵星人 | ブリップ | round friendly alien with bobble antennae | 15.1 × 21.0 × 12.2 | 200 | 6.1 | 4 | 15000 / 5200 / 1700 | 225 | original |
| `cosmic.astrocat` | Nova Cat | 新星宇航猫 | ノヴァねこ | astronaut cat in a round helmet | 15.8 × 21.0 × 14.9 | 250 | 6.7 | 3 | 14996 / 5194 / 1946 | 224 | original |
| `cosmic.planetmonster` | Orbit Munch | 环环小怪兽 | わっかモンスター | round little monster wearing a planetary ring | 18.2 × 20.0 × 18.4 | 270 | 7.4 | 4 | 14997 / 5198 / 1697 | 220 | original |
| `cosmic.spacerobot` | Bolt-3 | 波特三号 | ボルト3ごう | retro space robot with a wind-up key | 18.1 × 22.0 × 13.5 | 280 | 6.1 | 4 | 14998 / 5198 / 1830 | 239 | original |
| `gpu.chief` | Keynote Chief | 主讲人 | キーノートチーフ | keynote presenter doll in a black leather jacket | 14.6 × 23.0 × 15.0 | 270 | 8.0 | 5 | 14998 / 5196 / 2200 | 228 | original |
| `gpu.card` | Twin-Fan | 双风扇 | ツインファン | graphics-card plush with two felt fans | 21.6 × 13.5 × 6.4 | 250 | 9.0 | 2 | 14998 / 5198 / 1698 | 189 | original |
| `gpu.chip` | Chippy | 小芯片 | チッピー | smiling processor chip with golden pins | 19.7 × 20.0 × 7.1 | 220 | 7.5 | 1 | 14996 / 5196 / 2442 | 204 | original |
| `gpu.fan` | Breezy | 小风扇 | ブリージー | cooling fan with a lime-green smiling hub | 17.6 × 20.0 × 6.3 | 230 | 5.2 | 2 | 14998 / 5198 / 1698 | 198 | original |
| `gpu.rack` | Rack Buddy | 机柜宝宝 | ラックバディ | server rack with blinking drive bays | 16.8 × 21.0 × 10.2 | 260 | 6.4 | 3 | 15000 / 5200 / 1700 | 201 | original |
| `gpu.bot` | Tensor Bot | 张量机器人 | テンソルボット | happy AI robot with a glowing lime visor | 15.2 × 22.5 × 15.1 | 250 | 7.6 | 5 | 14998 / 5198 / 1698 | 231 | original |
| `gpu.pixel` | Pixel | 像素方块 | ピクセル | chequered green pixel cube | 19.1 × 16.0 × 17.0 | 270 | 9.5 | 5 | 15000 / 5200 / 1700 | 206 | original |

This table is generated from the manifest. To regenerate it after a bake, read
`public/assets/plush/manifest.json` — it is the source of truth; this document is not.

### Imported textured models

State after round 3: all 31 characters imported (the seven GPU Party models for the first time;
the 24 others re-imported with `--force` so every entry records the design it was fitted to —
their output files were byte-identical except for the three whose designs changed). "Shape
distance" is the surface distance between the generated and the procedural model after fitting;
"outside proxies" is the share of the surface more than 1 cm outside the collision proxies and the
95th percentile distance, with the procedural model's own numbers in brackets (proxies sit a little
inside the fur); "proxy gap" is the 95th percentile distance of proxy points that lie outside the
visual mesh. Visual size is the fitted bounding box (the design sizes are in the table above).
All yaws were 0°.

| Id | LOD triangles | GLB (KB) | 1K / 2K textures (KB) | Visual size (cm) | Shape distance mean / p95 (cm) | Outside proxies: share > 1 cm / p95 cm (procedural) | Proxy gap p95 (cm) | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sakura.bunny` | 41178 / 11999 / 3996 | 825 | 213 / 840 | 23.2 × 20.1 × 14.3 | 0.5 / 1.0 | 23 % / 1.9 (16 % / 2.2) | 0.5 | ok |
| `sakura.biribi` | 40904 / 12000 / 4000 | 746 | 255 / 1063 | 19.6 × 21.4 × 15.8 | 0.5 / 0.8 | 23 % / 2.5 (18 % / 2.7) | 1.3 | check |
| `sakura.sakuracat` | 41271 / 12000 / 4000 | 696 | 209 / 956 | 17.1 × 20.6 × 15.3 | 0.5 / 1.0 | 21 % / 1.7 (8 % / 1.4) | 0.6 | check |
| `sakura.capybara` | 41250 / 12000 / 4000 | 709 | 293 / 1536 | 16.8 × 20.6 × 18.4 | 0.6 / 1.3 | 17 % / 2.2 (11 % / 2.0) | 0.4 | ok |
| `sakura.tanuki` | 41550 / 12000 / 3998 | 825 | 416 / 1959 | 17.1 × 20.6 × 23.3 | 0.5 / 1.0 | 23 % / 1.8 (9 % / 1.4) | 0.5 | check |
| `sakura.monster` | 41004 / 12000 / 4000 | 689 | 306 / 1568 | 23.5 × 17.2 × 16.3 | 0.5 / 0.9 | 25 % / 1.5 (10 % / 1.5) | 1.0 | check |
| `storybook.astronaut` | 40767 / 12000 / 3999 | 789 | 299 / 1450 | 18.4 × 21.0 × 13.7 | 0.5 / 1.1 | 17 % / 1.3 (8 % / 1.2) | 0.5 | ok |
| `storybook.hornmonster` | 41134 / 11999 / 4615 | 728 | 342 / 1767 | 19.5 × 20.6 × 14.6 | 0.5 / 0.9 | 13 % / 1.2 (1 % / 0.8) | 0.6 | ok |
| `storybook.robot` | 40736 / 12000 / 4000 | 846 | 370 / 1793 | 19.1 × 21.5 × 11.8 | 0.6 / 1.1 | 16 % / 1.4 (6 % / 1.3) | 0.7 | ok |
| `storybook.scarfpuppy` | 41592 / 13207 / 4000 | 1123 | 449 / 1622 | 21.4 × 19.5 × 12.9 | 0.6 / 1.4 | 14 % / 1.7 (9 % / 1.4) | 0.7 | ok |
| `storybook.dino` | 41037 / 11999 / 4000 | 847 | 294 / 1569 | 16.4 × 20.5 × 21.8 | 0.5 / 1.0 | 11 % / 1.6 (12 % / 2.1) | 0.5 | ok |
| `storybook.cowpony` | 40858 / 11999 / 4000 | 881 | 345 / 1658 | 14.5 × 21.6 × 21.0 | 0.6 / 1.4 | 8 % / 1.1 (6 % / 1.1) | 0.8 | ok |
| `ocean.whale` | 41080 / 11999 / 3999 | 823 | 319 / 1439 | 21.5 × 18.0 × 20.7 | 0.4 / 0.9 | 16 % / 1.3 (11 % / 1.1) | 0.8 | ok |
| `ocean.octopus` | 41264 / 12000 / 4000 | 664 | 252 / 1405 | 20.9 × 17.6 × 18.9 | 0.5 / 0.8 | 11 % / 1.2 (4 % / 0.9) | 0.5 | ok |
| `ocean.axolotl` | 41334 / 12000 / 4000 | 655 | 217 / 1120 | 23.2 × 18.6 × 15.1 | 0.5 / 0.9 | 17 % / 1.8 (9 % / 1.8) | 0.5 | ok |
| `ocean.jellyfish` | 40757 / 12000 / 4628 | 724 | 193 / 981 | 21.4 × 18.1 × 17.8 | 0.7 / 1.4 | 11 % / 1.3 (0 % / 0.8) | 0.9 | ok |
| `ocean.seal` | 41776 / 11997 / 3999 | 1059 | 453 / 1830 | 17.5 × 19.0 × 16.6 | 0.5 / 0.9 | 15 % / 1.3 (5 % / 1.0) | 0.4 | ok |
| `ocean.turtle` | 41035 / 12000 / 4000 | 742 | 302 / 1553 | 16.7 × 20.0 × 15.5 | 0.6 / 2.1 | 10 % / 1.2 (5 % / 1.0) | 0.8 | ok |
| `cosmic.spacebunny` | 40807 / 11999 / 4000 | 768 | 322 / 1508 | 14.9 × 23.0 × 12.8 | 0.5 / 1.2 | 13 % / 1.5 (11 % / 1.8) | 0.6 | ok |
| `cosmic.starbear` | 41002 / 12000 / 4000 | 762 | 263 / 1308 | 18.5 × 22.0 × 17.5 | 0.5 / 1.1 | 12 % / 1.4 (4 % / 0.9) | 0.5 | ok |
| `cosmic.alien` | 41273 / 12000 / 4428 | 703 | 337 / 1649 | 14.7 × 21.0 × 13.4 | 0.4 / 0.7 | 17 % / 1.4 (8 % / 1.3) | 0.0 | ok |
| `cosmic.astrocat` | 40770 / 12000 / 4000 | 797 | 242 / 1033 | 15.7 × 20.6 × 13.9 | 0.7 / 1.9 | 21 % / 1.5 (10 % / 1.3) | 0.0 | ok |
| `cosmic.planetmonster` | 40771 / 11999 / 4000 | 792 | 326 / 1443 | 18.3 × 19.6 × 19.1 | 0.6 / 1.3 | 29 % / 1.7 (11 % / 1.2) | 0.0 | check |
| `cosmic.spacerobot` | 40828 / 12000 / 4000 | 841 | 284 / 1067 | 18.1 × 22.0 × 10.8 | 0.4 / 0.8 | 2 % / 0.7 (4 % / 0.8) | 0.0 | ok |
| `gpu.chief` | 41468 / 11999 / 4000 | 1068 | 579 / 2191 | 15.9 × 23.1 × 16.0 | 0.7 / 1.5 | 13 % / 1.4 (1 % / 0.7) | 1.8 | check |
| `gpu.card` | 39964 / 11988 / 3994 | 1207 | 659 / 2275 | 21.4 × 13.0 × 6.9 | 0.5 / 1.1 | 12 % / 1.6 (0 % / 0.7) | 1.2 | check |
| `gpu.chip` | 41055 / 12000 / 3998 | 1338 | 529 / 1820 | 20.0 × 20.4 × 6.2 | 0.6 / 1.0 | 3 % / 0.8 (3 % / 1.0) | 1.9 | check |
| `gpu.fan` | 40524 / 11990 / 4000 | 1132 | 433 / 1414 | 18.4 × 20.0 × 5.4 | 0.7 / 1.7 | 11 % / 1.5 (1 % / 0.8) | 1.6 | check |
| `gpu.rack` | 41296 / 11999 / 4000 | 1103 | 616 / 2420 | 16.7 × 21.8 × 10.7 | 0.5 / 0.9 | 9 % / 1.1 (0 % / 0.8) | 1.1 | check |
| `gpu.bot` | 41020 / 11999 / 4000 | 785 | 288 / 1130 | 15.8 × 22.9 × 14.1 | 0.7 / 1.4 | 23 % / 1.7 (2 % / 0.8) | 0.4 | check |
| `gpu.pixel` | 41661 / 12000 / 3998 | 847 | 382 / 1468 | 20.3 × 16.6 × 17.9 | 0.6 / 1.1 | 10 % / 1.1 (0 % / 0.8) | 1.4 | check |

31 textured models (GLB + 1K + 2K files): 82 MB; with the procedural GLBs the plush assets take
89 MB (per theme in [PERFORMANCE.md](PERFORMANCE.md#asset-sizes-per-theme)).

Verdicts: 19 `ok`, 12 `check`, no `mismatch` (before this round: 4 mismatches among the 24, and
the seven GPU Party models rated `check` against their first designs). What the remaining `check`
ratings mean:

- `sakura.biribi`, `sakura.sakuracat`, `sakura.monster`, `cosmic.planetmonster`, `sakura.tanuki`:
  the generated pile is fluffier than the design, so more of the surface lies 1–1.7 cm (p95)
  outside the hulls than for the procedural model; no collider sticks out where nothing is drawn
  (gap p95 ≤ 1.3 cm). The tanuki's paws reach up to 3 cm in front of its body hull (kept without
  a collider, see the footprint note above).
- GPU Party: the generated models are 2–9 % larger than their designs, and most of their gap is
  the flat-base ring between two feet under the toy (without it the gap p95 is 0.0–1.2 cm, the
  pixel's arms 1.0 cm).

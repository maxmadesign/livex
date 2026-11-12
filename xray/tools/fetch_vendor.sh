#!/bin/sh
# Downloads the libraries and tracker models into ./vendor (about 47 MB), so the page can run without internet:
# serve the xray folder from this computer (start.command on a Mac) and open it with "?local".
#   sh tools/fetch_vendor.sh        (needs only curl; can be run from anywhere)
set -e
cd "$(dirname "$0")/.."
npm=${CDN:-https://cdn.jsdelivr.net/npm}
models=${MODELS:-https://storage.googleapis.com/mediapipe-models}
get() { mkdir -p "$(dirname "$2")"; echo "  $2"; curl -fsSL --retry 3 -o "$2" "$1"; }

get "$npm/three@0.160.0/build/three.module.js" vendor/three.module.js
mp="$npm/@mediapipe/tasks-vision@0.10.14"
# saved as .js: every simple web server sends that as JavaScript, which a browser insists on for a module
get "$mp/vision_bundle.mjs" vendor/tasks-vision/vision_bundle.js
for f in vision_wasm_internal.js vision_wasm_internal.wasm vision_wasm_nosimd_internal.js vision_wasm_nosimd_internal.wasm; do
  get "$mp/wasm/$f" "vendor/tasks-vision/wasm/$f"
done
get "$models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" vendor/models/face_landmarker.task
get "$models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" vendor/models/hand_landmarker.task
get "$models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" vendor/models/pose_landmarker_lite.task
get "$models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task" vendor/models/pose_landmarker_full.task
echo "vendor/ is ready. Start a local server (start.command on a Mac) and open the page with ?local"

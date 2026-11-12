#!/bin/sh
# Downloads the libraries and tracker models into ./vendor, so the page can run without internet ("?local").
#   sh tools/fetch_vendor.sh        (run from the xray folder; needs npm and curl)
set -e
mkdir -p vendor/models vendor/tasks-vision/wasm
tmp=$(mktemp -d)
(cd "$tmp" && npm init -y >/dev/null && npm install --no-audit --no-fund three@0.160.0 @mediapipe/tasks-vision@0.10.14 >/dev/null)
cp "$tmp/node_modules/three/build/three.module.js" vendor/three.module.js
cp "$tmp/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs" vendor/tasks-vision/
cp "$tmp/node_modules/@mediapipe/tasks-vision/wasm/"* vendor/tasks-vision/wasm/
rm -rf "$tmp"
base=https://storage.googleapis.com/mediapipe-models
curl -fsS -o vendor/models/face_landmarker.task      $base/face_landmarker/face_landmarker/float16/1/face_landmarker.task
curl -fsS -o vendor/models/hand_landmarker.task      $base/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
curl -fsS -o vendor/models/pose_landmarker_lite.task $base/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
curl -fsS -o vendor/models/pose_landmarker_full.task $base/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
echo "vendor/ is ready. Serve this folder over http and open index.html?local"

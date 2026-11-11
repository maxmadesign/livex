# X 射线镜子拆解

对单文件网页 X-Ray Mirror 的源码级分析。分析对象是委托附带的 `X-Ray Mirror.html`（2,762,056 字节，SHA-256 `b5e12cd0755ac097…`），
它与 [MasterOfVFX2070/xray-mirror](https://github.com/MasterOfVFX2070/xray-mirror) 提交 `41e2413`（2026-11-10）里的 `index.html` 逐字节相同。
原作用摄像头追踪脸和手，把 BodyParts3D 的头骨、大脑、肌肉和手骨贴上去，画成 X 光片的样子。

```
index.html   分析页面（正文、流程图、表格）
img/         17 张配图：16 张用 tools/viewer.html 按原作的配色和着色参数重绘它内嵌的网格，1 张是原页面界面的截图
tools/       得出页面里那些数字和配图的脚本
fast/        性能优化补丁：把原版 HTML 变成在慢机器上也流畅的版本（成品不入库，见 fast/README.md）
```

## 结论摘要

- 解剖模型预先对齐到了 MediaPipe 的标准脸坐标系，所以每帧的 4×4 姿态矩阵可以直接当模型矩阵用。
  468 个标准顶点到内嵌皮肤网格的距离：中位数 1.45 mm，约 95% 在 5 mm 以内。
- 每帧再用 13 个脸部点解一个二维缩放和平移，乘进投影矩阵，头骨因此不会相对脸漂移。
  在 3 张样例照片上实测，这一步把投影缩小 4.5% 到 7%，并上移画面高度的 1% 到 2%。
- X 光质感 = 边缘发光 + 相加混合 + 不做深度测试，外加一层把真脸压暗的“面纱”。
- 会动的只有下颌（`jawOpen` → 0 到 20.6° 的铰链）和手（15 节单位长度指骨 + 1 个仿射掌块）。
- 首次启动另需从 CDN 下载约 22.6 MB 的运行库和模型。读码和实际运行都没有发现任何上传：每次运行只有 8 个下载请求。
- 小问题：左右手标签判反了（tasks-vision 0.10.14 对未镜像画面给出的就是真实的左右手，页面又取了一次反），对画面影响很小。
- 慢机器上卡的主因是手部追踪每帧都跑：没有手时找一次手的开销是脸部追踪的 3 到 4 倍。`fast/` 里的补丁在无显卡沙箱中把实时帧率从 1.2 提到 10.1 帧/秒。

## 复现

需要原作的 HTML、MediaPipe 仓库里的 `canonical_face_model.obj`，Python 的 numpy、pillow，Node 的 playwright，以及一个依赖目录 `<deps>`：

```
<deps>/node_modules/three                      three@0.160.0
<deps>/node_modules/@mediapipe/tasks-vision    @mediapipe/tasks-vision@0.10.14
<deps>/models/face_landmarker.task             storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/
<deps>/models/hand_landmarker.task             storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/
```

```bash
cd tools

# 数字：网格统计、对齐误差、下颌枢轴、手部骨骼
python3 extract.py <X-Ray Mirror.html> data <mediapipe/.../canonical_face_model.obj>
python3 measure.py data/meta.json data/meshdata.bin <mediapipe/.../canonical_face_model.obj>

# 重绘的配图
node figs.mjs "$PWD" <deps>/node_modules/three/build/three.module.js out
python3 to_webp.py out ../img

# 把原页面跑起来：演示场景，以及用一张照片当摄像头的实时模式
node run_original.mjs demo <X-Ray Mirror.html> <deps> out/demo.png '{"labels":true}'
ffmpeg -loop 1 -i photo.png -t 2 -r 30 -pix_fmt yuv420p camera.y4m
node run_original.mjs live <X-Ray Mirror.html> <deps> out/live.png camera.y4m

# MediaPipe 的左右手标签
node handedness.mjs <照片目录> <deps> photo.png,photo_flipped.png
```

`extract.py` 和 `viewer.html` 只把原页面当数据读，不执行它的代码。`run_original.mjs` 会执行原页面，
它的外部请求只由本地文件应答，其余一律拦截并打印。`data/` 和 `out/` 不入库。

实测用的样例照片来自 MediaPipe 文档的公开样例（`storage.googleapis.com/mediapipe-tasks/gesture_recognizer/` 下的
`pointing_up.jpg`、`thumbs_up.jpg`、`victory.jpg`，`mediapipe-tasks/hand_landmarker/woman_hands.jpg`，
`mediapipe-assets/business-person.png`），不随仓库分发。

## 还没验证的事

- 真实摄像头下的动态表现：转头和张嘴过程中的延迟、抖动，不同光线下的稳定性。样例照片是静止的。
- 真实设备上的帧率。无显卡的沙箱里（软件渲染，追踪器的 GPU 版也由软件模拟）原版是每秒 1 帧，只能当下限。

## 授权

- 本目录不包含原作的代码和网格数据。原仓库没有 LICENSE 文件。
- `img/` 中重绘的配图由 BodyParts3D 的模型渲染而来：BodyParts3D, © The Database Center for Life Science,
  licensed under CC Attribution-Share Alike 2.1 Japan。模型经原作者简化和重新对齐。这些配图同样以 CC BY-SA 2.1 Japan 提供。
- `img/app-demo.webp` 是原页面界面的截图，用于说明和评述。
- 图 3 的绿色点位来自 MediaPipe 的标准脸模型（Apache-2.0）。

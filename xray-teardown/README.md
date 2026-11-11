# X 射线镜子拆解

对 [MasterOfVFX2070/xray-mirror](https://github.com/MasterOfVFX2070/xray-mirror)（提交 `41e2413`，2026-11-10）的源码级分析。
原作是一个 2.76 MB 的单文件网页：用摄像头追踪脸和手，把 BodyParts3D 的头骨、大脑、肌肉和手骨贴上去，画成 X 光片的样子。

```
index.html   分析页面（正文、流程图、表格）
img/         16 张配图：用 tools/viewer.html 按原作的配色和着色参数重绘它内嵌的网格
tools/       得出页面里那些数字和配图的脚本
```

## 结论摘要

- 解剖模型预先对齐到了 MediaPipe 的标准脸坐标系，所以每帧的 4×4 姿态矩阵可以直接当模型矩阵用。
  468 个标准顶点到内嵌皮肤网格的距离：中位数 1.45 mm，约 95% 在 5 mm 以内。
- 每帧再用 13 个脸部点解一个二维缩放和平移，乘进投影矩阵，头骨因此不会相对脸漂移。
- X 光质感 = 边缘发光 + 相加混合 + 不做深度测试，外加一层把真脸压暗的“面纱”。
- 会动的只有下颌（`jawOpen` → 0 到 20.6° 的铰链）和手（15 节单位长度指骨 + 1 个仿射掌块）。
- 首次启动另需从 CDN 下载约 22.6 MB 的运行库和模型；代码里没有任何上传。

## 复现数字和配图

需要原作的 `index.html`、MediaPipe 仓库里的 `canonical_face_model.obj`、`three@0.160.0`，以及 Python 的 numpy、pillow 和 Node 的 playwright。

```bash
cd tools
python3 extract.py <xray-mirror/index.html> data <mediapipe/.../canonical_face_model.obj>
python3 measure.py data/meta.json data/meshdata.bin <mediapipe/.../canonical_face_model.obj>
node figs.mjs "$PWD" <node_modules/three/build/three.module.js> out
python3 to_webp.py out ../img
```

脚本只把原页面当数据读（正则取出元数据和 base64 网格），不执行它的代码。`data/` 和 `out/` 不入库。

## 没做到的事

- 委托里附的 Google Drive 参考文件没能读取（连接器缺权限，`drive.google.com` 被会话的网络策略拦截），分析基于公开仓库。
- 原页面没有在沙箱里实际运行，帧率和真实人脸上的贴合误差没有实测。

## 授权

- 本目录不包含原作的代码和网格数据。原仓库没有 LICENSE 文件。
- `img/` 中的配图由 BodyParts3D 的模型渲染而来：BodyParts3D, © The Database Center for Life Science,
  licensed under CC Attribution-Share Alike 2.1 Japan。模型经原作者简化和重新对齐。这些配图同样以 CC BY-SA 2.1 Japan 提供。
- 图 3 的绿色点位来自 MediaPipe 的标准脸模型（Apache-2.0）。

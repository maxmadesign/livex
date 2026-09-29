# 04 · Seedance 2.5 视频提示词 ——《7 路》Route 7

> LiveX AI City · 60 秒品牌影片 · 生成版（Higgsfield / Seedance 2.5）逐镜视频提示词
> 权威来源：`docs/master.json`（镜号、时间码、台词、UI 文案逐字一致）· `docs/_input/product_bible.md`（产品外观、尺寸、比例、屏幕、边框、底座、材质、安装方式）· `docs/concepts.json`（winner = STRATEGIST2+《7 路》，嫁接 The Handoff / Center-Lock / 两笔成 X / 指向即现实 / 安静的一拍 / 光形语法）· `docs/_input/design_system.md` · `docs/_input/sound_system.md`
> 影片规格：主版 1920×1080 · 30 fps；X 版 1080×1350（4:5，本片真正的发布渠道），文字、Lyra 双眼、产品与反转要素落在中央 864 px 安全列（x 528–1392）。4:5 默认中心裁切；S01、S02、S18 按 05 §1.2.4 原生重排（见 1.12）。
> 镜头口径：生成版全片按**全画幅等效 35mm**换算比例（16:9 竖向视场 32.3°，画框高 = 0.579 × 距离；Gateway 占画高比例 = 3.77 ÷ 距离 m）。设备尺寸分「屏幕」与「机身」两套口径（见 1.6 表），以真实距离和人机高度差为准，不以画面百分比为准。

---

## 目录

- [0. 约定：素材命名、参数速查、Negative 写法](#0-约定素材命名参数速查negative-写法)
- [1. 生成与剪辑策略](#1-生成与剪辑策略)
- [2. 逐镜提示词 S01–S18](#2-逐镜提示词-s01s18)
- [附录 A · 生成任务总表与预算](#附录-a--生成任务总表与预算)
- [附录 B · 定稿检查清单](#附录-b--定稿检查清单)

---

## 0. 约定：素材命名、参数速查、Negative 写法

### 0.1 Seedance 2.5 在 Higgsfield 上的真实参数（model id：`seedance_2_5`）

| 参数 | 取值 | 本片用法 |
|---|---|---|
| `mode` | `t2v` · `omni_reference` · `video_edit` · `video_extension` | 主力是 `omni_reference`（首帧 / 首尾帧 I2V + 参考图）；`video_extension` 用来续接运动和补剪辑余量；`video_edit` 只用于返修；`t2v` 只用于不需要身份一致的素材（人潮层） |
| `duration` | 4–30 秒，整数 | 最短 4 秒。成片短于 4 秒的镜头一律生成 4 秒再剪（规则见 1.4） |
| `resolution` | 480p · 720p · 1080p | 定稿一律 1080p |
| `aspect_ratio` | auto · 21:9 · 16:9 · 4:3 · 1:1 · 3:4 · 9:16 | 场景镜头 16:9；屏幕内 Lyra 素材 9:16（= 屏幕 UI 画布 1080×1920）；Lyra 步行母版 21:9；4:5 竖幅素材 J02-V 用 3:4（面板没有 4:5，3:4 裁到 1080×1350 损失最小） |
| `generate_audio` | 布尔 | 全片 `false`（统一理由见 1.10） |
| `bitrate_mode` | standard · high | 草稿 standard；定稿 high（暗部、雨丝、颗粒多，high 码率能减少色带和块状压缩） |
| `draft` | 布尔 | `true` 先出 480p 草稿，7 天内用 `draft_job_id` 定稿 1080p |
| `extension_mode` | backward · forward | 仅 `video_extension`：forward 续接下一段运动，backward 向前补入点余量 |
| `medias` 角色 | `start_image` · `end_image` · `image_references` · `video_references` · `audio_references` | 仅 `omni_reference` 模式。首帧 / 尾帧锁构图，参考图锁人物、产品和 Lyra，`audio_references` 只在需要口型节奏时可选 |

> GPT-image-2.5 不在 Higgsfield 上。下文所有 KF / CS / LYRA 静帧都由客户在 ChatGPT 里用 GPT-image-2.5 生成或编辑，导出后再上传到 Higgsfield 作为 media。

### 0.2 输入素材命名

| 代号 | 文件 / 来源 | 说明 |
|---|---|---|
| 产品抠像 | `film/assets/cut/gateway_front.png` · `gateway_back.png` · `portal_55.png` · `portal_43.png` · `portal_32.png` · `paragon_front.png` · `paragon_back.png` | 客户产品图的 SAM 抠像。作 `image_references` 锁外观，也是后期替换和背面品牌合成的真实像素 |
| 产品原图 | `film/assets/src/gateway_sheet.jpg` · `portal_sheet.jpg` · `paragon_sheet.jpg` | 正反面同框的规格图，补充材质和比例参考 |
| 屏幕四角 | `film/assets/cut/screens.json` | 各设备**产品渲染图（斜角视图）抠像**里的屏幕四角像素坐标，带渲染透视。**只用于代码版**把画布贴进产品抠像；不用于生成素材的追踪初始化或透视检查（生成素材逐镜做平面追踪，见 1.6） |
| Lyra 定妆 | `film/assets/src/lyra_white.jpg` · `lyra_black.jpg`（1125×2000）；`film/assets/cut/lyra_white_cut.png` · `lyra_black_cut.png` | 所有 Lyra 素材的 `start_image` 或第一参考，锁脸、发型、服装、比例 |
| **KF-Sxx** | GPT-image-2.5 关键帧，14 张 ★：S01 S02 S03 S04 S05 S06 S09 S10 S11 S12 S14 S15 S16 S17 | 见 03 文档对应镜号（03 的「A 展示版」）。带 Lyra / UI 的版本只用于审片 |
| **KF-Sxx-PLATE** | 由 KF-Sxx 在 ChatGPT 里编辑的合成底板版（= 03 的「B 合成底板版」，底板颜色以本条为准）：屏幕可视区按模式换成底板——**浅色模式**（Gateway、日间 Portal）= 均匀发光的**浅灰白**平面（线性光约为成片 UI 白 `--paper #f4f5f7` 的 85%，sRGB 约 #e3e4e6），保留 3–5% 玻璃反光；**深色模式**（Paragon、医院夜间 Portal）= **纯黑玻璃**，保留很淡的环境反光。删除画面里所有文字、字卡、UI | Seedance 的输入帧一律用 PLATE 版（原名 KF-Sxx-BLK，已全部改名）。理由与键控方法见 1.6 |
| **KF-Sxx-END / -START / -…** | 由对应 KF 派生的首帧 / 尾帧（同一对话、同一参考图，改机位或动作状态） | 每镜「Start Frame / End Frame」写明画面要求；编辑话术与附图见 03 附录「派生帧提示词」；与 03 文件名的对应见下方 0.2.1 |
| **CS-CHEN-A / -B** | 陈师傅角色设定板（03 图 6）：正面、3/4、侧面、背面。A = 站厅 5600K 冷白光那组；B = 广场蓝调雨夜 + 钠灯那组 | 锁银灰齐下巴短发、玳瑁圆框眼镜、藏蓝及膝大衣、红色粗针围巾针法 |
| **CS-HANDS** | 手部设定板（03 图 7）：1985 年 **31 岁**的手（左半）/ 2026 年 72 岁的手（右半），同一枚细金戒（右手无名指）、同一道左手拇指根的疤。左半：年轻、皮肤紧致，有少量生活痕迹，指节已经有职业司机的粗壮，**不是皮肤紧致的少女手**；疤是 1983 年受伤、到 1985 年已两年的旧疤：约 2 cm，淡粉偏白、已平整 | S01、S02、S07 必用。旧版左半若是「少女手」，或疤看起来像新伤，须按本条重新生成 |
| **CS-LIN** | 林的设定板（03 图 8；19 岁，藏青 #1c2a4a + 白竖条球衣，胸口号码区留白） | S16 |
| **PROP-NOTE** | 米白便签 10.5×7.5 cm，对折压痕，**纸面留白**（只有纸纹、压痕和极淡的铅笔擦痕） | 字由后期贴真实手写扫描。S12–S14 字条一直在她**左手**（S14 贴砖用右手） |
| **PROP-SCARF** | 红色粗针围巾 #C8372D + 藏青白条 7 号主场围巾（无队徽、无文字） | **32.0（J11b）起**两条叠戴 |
| **PROP-PHONE** | 银色旧翻盖手机（带外屏），外屏为黑 | S02。生成一律外屏为黑，消息后期贴字 |
| **LYRA-…** | 由 `lyra_white.jpg` / `lyra_black.jpg` 在 ChatGPT 里编辑出的 Lyra 姿态帧；只用选区重绘，定稿后把原图的脸和头发像素贴回再融合 | 见 1.7 |

生成任务编号：**J** = 场景素材；**L** = 屏幕内 Lyra 素材。全部任务、时长和预算汇总在附录 A。

#### 0.2.1 04 代号 ↔ 03 文件名

03 的存档命名：`Sxx_A.png`（展示版）、`Sxx_B.png`（底板版）、`Sxx_A_var.png` / `Sxx_A_varA.png`（变体展示版）、`Sxx_B_var….png`（变体底板版）。本文只用底板版与派生帧。「派生」= 在同一对话里以右列的 03 图为底，按 03 附录「派生帧提示词」的话术编辑（「保持构图、人物、光线、产品完全不变，只把 ___ 改成 ___」，并重新附上对应设定板与产品图）。S07、S08、S13 在 03 里没有 ★ 关键帧，本文仍用 Seedance 生成 J07、L4、J13a/b，它们的首尾帧全部是派生帧。

| 04 代号 | 用于 | 03 来源 | 类型 |
|---|---|---|---|
| KF-S01 · KF-S01-END | J01 首 / 尾 | `S01_A.png`（卷帘反光带留白）/ 由 S01_A 派生（方向盘右转约 180°） | 直接 / 派生 |
| KF-S02-ECU · KF-S02 · KF-S02-END | J02a、J02b | 由 `S02_A.png` 派生（Seat 7 大特写）/ `S02_A.png` / `S02_A_var.png`（「S02 变体」，**外屏改为黑**，手机移入安全列） | 派生 / 直接 / 派生 |
| KF-S02-V-ECU · KF-S02-V | J02-V（4:5） | 由「S02 V」派生 / 03「S02 V」竖幅变体（字条约 90% 画宽） | 派生 / 直接 |
| KF-S03-START · KF-S03 | J03 | 由 `S03_A.png` 派生 / `S03_A.png` | 派生 / 直接 |
| KF-S04 · KF-S04-END | J04 | `S04_A.png` / 派生 | 直接 / 派生 |
| KF-S05-FG | J05F | 由 `S05_B.png`（「S05 B」）派生：去掉白色影棚，背景换成浅色底板 | 派生 |
| KF-S06-CHEN · -END | J06C | `S06_A_var.png`（「S06 变体」）/ 派生 | 直接 / 派生 |
| KF-S07-START · -END | J07 | 派生（CS-CHEN-A + CS-HANDS） | 派生 |
| KF-S09-SEAM-PLATE | J09B 首 | 由 `S09_B.png` 派生（机位推到屏幕约占画宽 60%） | 派生 |
| KF-S09-PLATE | J09C 首帧 | `S09_B.png`（「S09 B」，底板按本文浅色规格，带人潮拖影） | 直接 |
| KF-S09-CLEAN-PLATE | J09B 尾 | 由 `S09_B.png` 派生：去掉人潮，其他一切不变 | 派生 |
| KF-S10-GW-PLATE | J10a | 由 `S09_B.png` 派生（Gateway 屏幕近景） | 派生 |
| KF-S10-PLATE · KF-S10-END-PLATE | J10b | 由 `S10_A_var.png`（「S10 变体」墙晕特写）派生底板 / `S10_B.png` | 派生 / 直接 |
| KF-S11-PLATE · KF-S11-B-PLATE | J11a | `S11_B.png`（Gateway 须在 x ≥ 30%，见 S11）/ 派生 | 直接 / 派生 |
| KF-S11-CU · -END | J11b | `S11_A_var.png`（「S11 变体」）/ 派生 | 直接 / 派生 |
| KF-S12-START · KF-S12 | J12a | 派生 / `S12_A.png` | 派生 / 直接 |
| KF-S12-CU · -END | J12b | `S12_A_var.png`（「S12 变体」）/ 派生 | 直接 / 派生 |
| KF-S13-START · KF-S13-END | J13a、J13b | 派生（03 无 ★） | 派生 |
| KF-S14-WIDE-PLATE | J14a | `S14_B_varA.png`（「S14 变体 A」的底板版） | 直接 |
| KF-S14-B-START-PLATE · KF-S14-PLATE | J14b 首 / 尾 | 派生（手正抬向砖墙）/ `S14_B.png`（43.8 主帧，手掌已贴砖） | 派生 / 直接 |
| KF-S14-C-PLATE · -C-END-PLATE · -D1-END | J14c、J14d1 | 派生 | 派生 |
| KF-S14-BACK | J14d2 尾 | 由 `S14_A_varB.png`（「S14 变体 B」背面）派生：中央标志区改为未点亮的黑色点阵 | 派生 |
| KF-S15-01-PLATE … KF-S15-05-PLATE | J15-01 / 02 / 03 / 04 / GC | 03「S15 B ①」…「S15 B ⑤」（建议存为 `S15_B_1.png` … `S15_B_5.png`）；①② 纯黑，③④⑤ 浅色底板 | 直接 |
| KF-S15-TN | J15-TN | 派生（03 无） | 派生 |
| KF-S16-SIT · -SIT-END | J16a | 由 `S16_A.png`（52.4 举纸条主帧）派生：正在坐下、字条未举起 | 派生 |
| KF-S16-POV | J16b | `S16_A_varA.png`（「S16 变体 A」，林的 POV；原 04 名 KF-S16） | 直接 |
| KF-S16-LIN | J16c | `S16_A_varB.png`（「S16 变体 B」，林的中景；原 04 名 KF-S16-C） | 直接 |
| KF-S16-CU | J16d | 由 `S16_A.png` 派生（85mm 近景，字条正从头顶收回胸前） | 派生 |
| KF-S17-RISE · KF-S17-ROOF | J17a | 派生 | 派生 |
| KF-S17-100-PLATE | J17b | 由 `S17_A_var.png`（「S17 变体」，100 m）派生：去掉所有节点光。**不是**「S17 B」（500 m 底板） | 派生 |
| （S17 B，500 m） | J17c 的终点参考 | `S17_B.png` | 只作参考 |

### 0.3 Negative 的写法

Seedance 2.5 的参数表里没有独立的 negative 字段。每条英文 Prompt 的末尾用一句 `Avoid: …` 追加本镜要排除的内容（控制在约 40 个词）。下面是全片共用的基底，每镜只在「Negative Prompt」里写追加项，英文 Prompt 的 `Avoid:` 句里只放本镜最要紧的几项。

**NEG-BASE（全片基底）**：generic self-service kiosk, ticket machine, generic TV screen, advertising lightbox with printed graphics, digital signage content, any readable text, letters, numbers, logos or watermarks generated in frame, subtitles, hologram, blue network lines, glowing lines on the ground, sci-fi HUD, cyberpunk neon, smart-city infographic, lens-flare streaks, CGI plastic look, oversaturated teal-and-orange grade, waxy AI skin, face morphing, identity drift, mirrored image, logo on the right chest, ring on the left hand, melting crowd, warped hands, extra fingers, duplicated limbs, device moving or rotating, camera orbiting a device, real football club crest, sponsor boards, real brand names.

**正向提示词的产品称呼**：只用「the LiveX Gateway V2 / the Gateway display unit / the freestanding display」「the LiveX Portal / the wall-mounted Portal display」「the LiveX Paragon outdoor display pillar」。正向提示词里**不出现 kiosk、totem**：这两个词会把模型引向通用信息亭和广告立柱的造型，正是 Brief 禁止的 Generic Kiosk。Paragon 上下两个白色点阵灯箱是产品本身的结构，正向里要明确写出（负向只排除「带印刷广告画面的灯箱」）。

---

## 1. 生成与剪辑策略

### 1.1 分工：Seedance 只负责「摄影机和人在动」

1. **设备永远静止。** Gateway、Portal、Paragon 在每条生成里都是静物。摄影机只做推、拉、横移、升降和跟拍，不做环绕设备的运镜。看到 Paragon 背面，靠的是 S14 钟楼砖角的前景擦除，而不是绕机。
2. **屏幕按模式生成底板。** 只要画面里看得见设备的边框或机身，屏幕区域就生成为底板：**浅色模式**（Gateway、日间 Portal）是均匀发光的浅灰白（约为 UI 白 `--paper` 的 85%，保留 3–5% 玻璃反光），它会像真实亮屏一样照亮面前人物的脸、字条和地面，并在地面留下屏幕倒影；**深色模式**（Paragon、医院夜间 Portal）才用纯黑玻璃。Lyra 和 Claude Code 渲染的 Lyra OS UI 在后期逐镜做平面追踪贴入（1.6）。
3. **Lyra 永远不在场景里生成。** 屏幕里的 Lyra 全部单独在白底（室内）或黑底（户外 / 夜间模式）生成，作为 9:16 屏幕画布素材（1.7）。
4. **文字零生成。** 字条上的铅笔字、卷帘牌、翻盖机外屏、站牌字卡、屏幕 UI、球衣号码、背面的 X 与 LIVEX.AI 字标，全部后期合成。生成时这些区域留白、留黑或留成无字的发光面。
5. **陈师傅一律用首帧 I2V 加设定板。** 单条生成里实际上片的部分不超过 5 秒。1985 年只拍手，不拍脸。
6. **成片声音不来自 Seedance。** 全部 `generate_audio=false`（1.10）。

### 1.2 模式选择

| 模式 | 用在哪里 | 为什么 |
|---|---|---|
| `omni_reference` + `start_image` + `end_image` | 构图起止都必须精确的镜头：J01、J02a、J02b、J02-V、J03、J04、J06C、J07、L4、J09B、J10b、J11a、J11b、J12a、J12b、J13b、J14b、J14c、J14d1、J14d2、J16a、J17a | 首尾帧把机位运动的起点和终点钉死，模型只补中间的运动。注意：尾帧被钉在第 4 秒（或设定时长的末尾），模型容易把动作摊满整条；需要快速完成的动作（J02a 的后拉、L4 的抬手）在提示词里写明「一秒内完成，然后保持」，草稿若摊满全程，就改为只锁首帧 |
| `omni_reference` + 仅 `start_image` | 终点不必精确、以动作为主的镜头：J05F、J09C、J13a、J14a、J15 各格、J16b/c/d、J17b，以及全部 Lyra 屏幕素材中的 L1、L2、L3、L5、L6、L8、L9、L10–L13、L7 | 只锁首帧，动作按自然速度发生，废片更少；再从素材里挑自然速度的一段上片 |
| `video_extension`（forward） | J17c（100 m 升到 500 m，接 J17b）、J18（J17c 尾部余量，可选） | 同一条运动不断开，比两段首尾帧硬接更顺。extension 从源片段的**最后一帧**往后续，所以源片段上片必须用到它的末帧（J17b 取 3.0–4.0）；输出如果包含原片段，按拼接点裁切 |
| `video_extension`（backward） | 任何入点余量不够的定稿片段 | 补 6–12 帧剪辑余量 |
| `t2v` | 不作主力。只在 J09C 的人潮纹理不够、需要补一层与构图无关的长快门人潮时备选 | 人潮不需要身份一致；但有首帧的 `omni_reference` 更容易对齐机位，所以优先后者 |
| `video_edit` | 返修：屏幕底板不均匀或冒出图像、冒出文字或 logo、局部画错（如脚轮数量） | 保住已经对的运动，只改局部 |

### 1.3 拆段与首尾帧总表

| 镜号 | 成片 | 生成任务 | 生成时长 | 上片区间 | 输入 |
|---|---|---|---|---|---|
| S01 | 1.5 s | J01 | 4 s | 素材 0.3–1.8 s **1:1 上片**（手部动作不变速） | 首 + 尾 |
| S02 | 3.0 s | J02a · J02b ｜ 4:5 版另加 J02-V | 4 + 4 ｜ 4 s | J02a 1.5–2.7 / J02b 2.7–4.5 ｜ 4:5 版：J02-V 1.5–3.0，3.0 起接 J02b 中心裁切 | 首 + 尾 |
| S03 | 3.0 s | J03 | 4 s | 3.0 s | 首 + 尾 |
| S04 | 2.5 s | J04 | 4 s | 2.5 s | 首 + 尾 |
| S05 | 2.5 s | L2 + J05F（可选） | 4 + 4 s | 2.5 s | 首 / 首 |
| S06 | 2.5 s | L3 · J06C | 4 + 4 s | 1.5 s + 1.0 s | 首 / 首 + 尾 |
| S07 | 2.5 s | J07 | 4 s | 2.5 s | 首 + 尾 |
| S08 | 2.5 s | L4 | 4 s | 2.5 s | 首 + 尾 |
| S09 | 7.0 s | 段 A：LYRA-POINT-MASTER 2D + L1（可选 ECU）+ L5 ｜ 段 B：J09B + J09C（人潮，必需） | 4 + 7 ｜ 6 + 6 s | 20.0–接缝（≈20.6）2D ｜ 接缝–≈20.9 静帧 2.5D ｜ J09B ≈20.9–26.4 ｜ J09C 人潮 22.5–27.0（1 倍速） | 见 1.5 |
| S10 | 3.0 s | L6 · L7 · L8 · J10a（可选）· J10b | 4 · 4 · 4 · 4 · 4 s | L6 27.0–27.767 · L8 28.0–29.767 · J10b 28.0–30.0（见本镜） | 首 / 首 + 尾 |
| S11 | 3.0 s | L9 · J11a · J11b | 4 · 4 · 4 s | 2.0 s + 1.0 s | 首 / 首 + 尾 |
| S12 | 4.5 s | J12a · J12b | 4 + 4 s | 1.5 s + 3.0 s | 首 + 尾 |
| S13 | 4.5 s | J13a → J13b（omni_reference，首帧 = J13a 定稿末帧） | 4 + 4 s | J13a 素材 1.0–4.0 → 37.5–40.5；J13b → 40.5–42.0 | 首 / 首 + 尾 |
| S14 | 5.0 s | L10 · J14a · J14b · J14c · J14d1 · J14d2 | 5 + 4 × 5 s | L10 42.0–46.35；J14 各段 1.0 + 2.0 + 1.0 + 0.35 + 0.65 s | 各自 |
| S15 | 5.0 s | L11 · L12 · L13 · J15-01 · 02 · 03 · 04 · GC · TN | 4 × 9 s | 每格 1.0 s（GC 0.5 + TN 0.5） | 首 |
| S16 | 2.0 s | J16a · b · c · d | 4 × 4 s | 每格 0.5 s | 首（a 为首 + 尾） |
| S17 | 3.0 s | J17a · J17b → J17c（extension） | 4 + 4 + 5 s | J17a 约 1.0 s → 0.5 s；J17b **3.0–4.0** → 54.5–55.5；J17c 0.0–4.0 → 55.5–57.0 | 首 + 尾 / 首 / 续接 |
| S18 | 3.0 s | 不生成（End Card 由 Claude Code 渲染）；J18 可选，只在 J17c 可用段不足时给压黑补余量 | 4 s | 0.15 s | 续接 |

### 1.4 短镜头、变速与帧率

- **最短 4 秒。** 成片不足 4 秒的镜头都生成 4 秒。只锁首帧的镜头从第 0 帧起取需要的长度；首尾帧都锁的镜头，尾帧设成「动作完成后的状态」，成片在动作完成处出点，不必用满 4 秒。
- **变速上限。** 有人物动作的片段只允许 0.9–1.15 倍变速；纯摄影机或环境运动允许 1.0–1.8 倍加速；人物小到看不清动作的航拍段（S17）允许到 3 倍。画面里有人潮时，人潮也算「人物动作」：人潮一律 1 倍速（S09 的人潮单独由 J09C 提供，J09B 里不放人潮，J09B 因此可以自由做时间重映射）。需要「降速停半拍」的地方（S09 的 23.5–24.0）只允许对**静止场景 + 摄影机运动**做 ≤ 2 倍光流慢放。
- **按上片时长设计表演，而不是压缩表演。** 成片只给某个动作 0.8 s，就只生成这 0.8 s 里自然能完成的动作（例如 L6 只做「放下手臂 + 起步转身」，出框交给 L7），不要把 3–4 s 的表演塞进去再加速。只锁首帧、让动作按自然速度发生，再从素材里挑自然速度的一段。
- **镜头绕光轴的旋转（roll）一律后期做。** S01 的 12° 同向旋转和 S02 的归零，都是纯 2D 旋转，后期做比让模型转更准。
- **屏幕内画面的运动一律后期做。** S05、S06（Lyra 部分）、S08、S09 段 A（20.0 → 接缝约 20.6）的画面全在屏幕平面里，平面上的横移和推拉没有视差，等于 2D 平移和缩放。所以这些 Lyra 素材只生成人物表演，机位锁定，运动在合成里按 master 的缓动精确完成。**不要让视频模型对屏幕里的人做光学推拉**：那会产生身体透视和视差变化，物理上不可能出现在屏幕上，会削弱「原来是屏幕」的 Reveal。
- **帧率。** 时间线 30 fps。Seedance 输出帧率以实际文件为准，若不是 30 fps，慢速运镜用光流转到 30 fps；手部快速动作（S01 打方向盘、S02 合盖、S16 拍胸口）用最近帧采样，避免插帧拖影。
- **剪辑余量。** 每条定稿片段在出入点外至少留 6 帧；不够时用 `video_extension` backward / forward 补。例外：作为下一条首帧来源（J13a → J13b）或 extension 源（J17b → J17c）的片段，出点就是它的末帧，余量由下一条承担。

### 1.5 Reveal（S09，20.0–27.0）：按物理顺序展开，接缝在「屏幕宽 = 画宽」的那一帧

**先讲物理。** 86 寸竖屏可视区约 107 × 190 cm（9:16），画幅是 16:9。只要画框高超过约 60 cm（107 cm ÷ 16/9），屏幕左右的细黑边框、内框线和两条 LED 灯条就必然入画。所以「21.5 Lyra 全身充满画高、却看不到边框」只能靠左右各约 1/3 画面的假白色外延撑着，再在接缝处让白色「退潮」。观众会把这读成一次擦除转场，而不是一镜到底，也违背 70% Reality。本版按物理顺序重排：约 20.6 起左右边框从两侧进入，22.5 上下边框扫入、屏幕矩形闭合。

**镜头口径**：全画幅等效 35mm，16:9 竖向视场 32.3°，画框高 = 0.579 × 距离。下表的「Gateway 占画高」= 整机高 2.18 m ÷ 画框高 = 3.77 ÷ 距离（m），整机不一定全在画内：120% ↔ 3.1 m，90% ↔ 4.2 m，62% ↔ 6.0 m，38% ↔ 9.9 m，30% ↔ 12.5 m。以真实距离和人机高度差为准，不以画面百分比为准。

> 与 master 的关系：master S09 的时间码和各节点内容不变。需要统一读法的只有 22.5「细黑边框与内框线扫入」：本版里指**上下**两边扫入、屏幕矩形四角闭合；左右两边与 LED 灯条的屏幕段约在 20.6 已从两侧进入。建议 master S09 的 22.5 描述同步为这一读法。

**段 A · 20.0 → 接缝（约 20.6）· 只在屏幕里，2D**
- 画面完全在屏幕玻璃以内，没有视差，2D 缩放就是物理正确的答案。**不用视频模型做光学后拉。** 原 L1「连续光学后拉」方案已取消：它让模型对一个三维的人做真实后拉，脸、肩、脚的相对比例会变，这种透视变化不可能出现在屏幕上，会削弱「原来是屏幕」；从双眼大特写到全身是 12 倍以上的尺度变化，也是视频模型最容易让脸漂移的情形。
- 母版：**LYRA-POINT-MASTER**，由 LYRA-POINT-9x16 放大或分块重绘到 ≥ 4320×7680（面部区域 ≥ 4×，睫毛、虹膜、皮肤纹理分块补细节），再与 `lyra_white.jpg` 做面部叠图比对，保证身份不变（1.7）。
- 呼吸：母版叠 L5 的微呼吸（取 L5 相对首帧的光流位移场，放大 4 倍后转移到母版上；省事时用设计系统的 idle 呼吸：scale 1 ± 0.0035 @ 0.24 Hz）。Lyra OS UI 画布按 2× 超采样（2160×3840）渲染，与母版做同一变换。
- 缩放：按 master 缓动（glide 0.16,1,0.3,1）做 2D 缩小。缩放锚点从双眼（画布 y ≈ 280）平滑移到胸口（y ≈ 500）。Lyra 的眼睛离屏幕上沿只有约 30 cm，锚点下移后，屏幕上边框才不会先于左右边框入画。
- 可选 L1（LYRA-ECU-MICRO）：需要大特写里真实的睫毛和眼神光时，只额外生成一条锁定机位的 ECU 微表情，首帧 LYRA-ECU = 母版在 20.0 取景处的裁切。上片约 0.5 s（20.0–20.5）：按眼点稳定后注册回母版的同一位置，随母版一起缩放，20.3–20.5 叠化进母版。
- 母版 → L5：接缝前 6 帧，画布底层从母版叠化到 L5 视频（L5 以 LYRA-POINT-9x16 为首帧，与母版同源同构图）。之后屏幕里一直是 L5 + UI，直到 27.0。
- **接缝** = 画布在影片里的显示宽度正好等于 1920 px 的那一帧（按 master 缓动约 20.6 s，f ≈ 618，以实际缩放曲线为准）。这一帧屏幕的左右边缘正好落在画框的左右边缘上。

**段 A′ · 接缝 → 约 20.9 · 左右边框从两侧进入，2.5D 静帧**
- 用 J09B 的首帧 **KF-S09-SEAM-PLATE**（屏幕约占画宽 60%，画框高约 1.0 m，距屏幕约 1.7 m）。这张静帧以 ≥ 3840×2160 出图（或放大到这个尺寸），拆成两层：设备平面层（屏幕底板 + 细黑边框 + 内框线 + 两条 LED 灯条）和深度虚焦、偏暗的站厅背景层。
- 屏幕里贴入同一块画布（L5 + UI）。设备层从 1.67× 缩到 1.0×，背景层只缩约 1.02×（站厅在 10 m 以外，深度虚焦，视差极小）。左右细黑边框、内框线和两条 LED 灯条的屏幕段从画面两侧进入。
- 接缝帧上设备层是 1.67×，屏幕正好满画宽，画框里只有画布，和段 A 的最后一帧逐像素相同，不需要任何「白色外延退潮」。同一帧起，玻璃层的站厅反光从 0 开始渐入，到 22.5 屏幕矩形闭合时达到 4%。声音上，Lyra 动机的尾音从这一段开始长出站厅混响。

**段 B · 约 20.9 → 27.0：J09B（摄影机运动，无人潮）+ J09C（人潮，1 倍速）**
- **J09B**：`omni_reference`，16:9，**6 s**。首帧 KF-S09-SEAM-PLATE，尾帧 KF-S09-CLEAN-PLATE（26.4 海报帧的无人潮版）。连续后拉 + 缓慢升起 + 最后下俯。**画面里不放人潮**（最多远处两三个深度虚焦、几乎不动的人影），陈师傅完全静止。6 s 映射到约 5.5 s（平均约 1.09×）。因为画面里只有摄影机运动和静止物体，glide 曲线需要的局部加速（≤ 1.8×）和 23.5–24.0 的局部光流慢放（≤ 2×）都安全。
- **J09C**：人潮层，锁定机位，取景 = KF-S09-PLATE，1 倍速，1/4 秒快门长拖影，6 s。22.5 之后（背景出现可辨的柱廊纵深）人潮一律来自 J09C：26.4–27.0 直接用原片；22.5–26.4 按 J09B 的 3D 摄影机反求，把 J09C 的人潮投影到水磨石地面与柱廊的代理几何上，按遮罩合成。22.5 之前背景是深度虚焦的暗站厅，只保留光斑，不需要人潮。人潮全程 1 倍速，不会变成快进式疾走。
- 时间重映射按下表，以画面内容对位：

| 成片时间 | master 画面（物理顺序） | 距屏幕平面 · 机高 · 俯仰（35mm） | Gateway 占画高 | 素材 |
|---|---|---|---|---|
| 20.0 | Lyra 双眼与微笑大特写 | 屏幕内，画框高约 14 cm，镜轴垂直屏幕 | — | 母版 2D（+ 可选 L1） |
| ≈ 20.6 接缝 | 屏幕宽 = 画宽，左右边缘刚到画框 | ≈ 1.0 m · 1.5 m · 0° | 画框高 0.6 m | 段 A → 段 A′ |
| ≈ 20.9 | 屏幕约占画宽 60%；左右细黑边框、内框线、两条 LED 灯条已在画内，背后是深度虚焦、偏暗的站厅 | ≈ 1.7 m · 1.4 m · 0° | 画框高 1.0 m | J09B 第 0 帧 |
| 21.5 | Lyra 全身充满画高，屏幕上下边缘刚在画外 | ≈ 3.1 m · 1.05 m · 0° | ≈ 120% | J09B |
| 22.5 | **上下**细黑边框与内框线扫入，屏幕矩形四角闭合；玻璃 4% 站厅反光到位：原来是屏幕 | ≈ 3.5 m · 1.1 m · 0° | ≈ 108% | J09B；人潮层从这里开始 |
| 23.5 | header 横梁与正中黑色玻璃摄像头完整入画，两条 LED 灯条几乎全长入画；23.5–24.0 降速到 15%，在灯条上多停半拍 | ≈ 4.2 m · 1.45 m · 0° | 90% | J09B（该段光流慢放 ≤ 2×） |
| 24.5 | 宽大的黑色底板与 4 个锁定脚轮落在水磨石上，两道竖直倒影出现；陈师傅从前景左侧以 3/4 背影入画 | ≈ 5.0 m · 1.45 m · −3° | ≈ 75% | J09B + J09C 投影 |
| 25.5 | 升 0.6 m；「叮」+ 字卡 05；陈师傅完整入画 | ≈ 6.0 m · 2.1 m · −5° | 62% | J09B + J09C 投影 |
| 26.4 | 升 3 m、俯 9°；30 m 柱廊；画右远处 Exit B 斜坡自动人行道暖光（x ≤ 1350） | ≈ 12.5 m · 4.7 m · −9° | 30% | J09B 尾帧（= KF-S09-CLEAN-PLATE） |
| 26.4–27.0 | 落幅静止 0.6 s（海报帧） | 同上 | 30% | J09B 尾帧冻结 + J09C 原片人潮 |

- 其余段落按 glide（0.16,1,0.3,1）做「开头快、结尾长收」的时间重映射。
- 21.5 的「全身充满画高」和 22.5 的「矩形闭合」之间只有约 0.4 m 的后拉，这 1 秒里摄影机要慢；主要的尺度变化放在 22.5 之后（header → 底板 → 大厅）。
- 机高从 20.6 的 1.5 m 降到 21.5 的约 1.05 m（画框中心从 Lyra 胸口移到全身中心，镜轴始终垂直屏幕、没有梯形），再随后拉缓慢升起。这是一条「先微降、再升起」的连续摇臂运动。

**备选 1（段 B 生成不过关时）**：用 GPT-image 出一张 8K 站厅母版（柱廊、水磨石、Exit B 斜坡自动人行道、Gateway 与陈师傅分层），做 2.5D 多层后拉升起；人潮仍用 J09C 按长快门风格单独生成、加重运动模糊，陈师傅和 Gateway 作为静止层合成，避免出现「融化的人」。
**备选 2（只在 master 坚持「22.5 之前看不到任何边框」时使用，不推荐）**：保留白色外延。至少做到三点：21.5 画布里的 Lyra 约为画高 100%；21.5→22.5 画布从 1.1× 缩到 1.0×；第 673–677 帧的「退潮」藏进一次大幅的焦外光斑变化里。即便如此，它仍会被读成擦除转场。

### 1.6 屏幕底板（浅色屏浅灰白 / 深色屏纯黑），逐镜平面追踪贴入 Lyra 与 UI

1. **生成**：所有看得见设备的镜头，按屏幕模式写 Prompt，并在 KF-…-PLATE 输入帧里预先换好同样的底板。
   - **浅色模式**（Gateway、日间 Portal：S09、S10、S11、S15 ③④⑤、J10a）："the display area is an evenly glowing, featureless light grey-white panel, slightly dimmer than paper white, with a faint glass reflection"。底板线性光约为 `--paper #f4f5f7` 的 85%（sRGB 约 #e3e4e6），均匀、无纹理、无图像，保留 3–5% 玻璃反光。
   - **深色模式**（Paragon、医院夜间 Portal：S14、S15 ①②）："the display area is pure solid black glass with a faint reflection"。
   - 这一口径与 master world_bible 一致：浅色屏生成浅灰白（sRGB 约 #e3e4e6），深色屏生成纯黑，UI 与屏幕里的 Lyra 一律后期合成。本文与 03 的 B 底板版、05 §11.2(5) 的键控方法都按这一口径，全套文档只用 #e3e4e6 这一个底板值。
   - **浅色屏为什么不能生成黑的**：亮屏是场景里真实的中性白光源。S09 里屏幕是陈师傅身上的主光，S11 里屏幕在她左侧勾出一道冷边，屏幕还会照亮字条、在水磨石上留下倒影。黑屏不会产生这些光，成片贴上白底 Lyra 以后，光照和倒影对不上，一眼就能看出是合成。浅灰白底板比 UI 白暗约 15%，贴入后 UI 仍是画面里最亮的面，发光关系正确。
   - LED 灯条、灯箱、墙晕照常点亮；浅色屏对人脸和地面的溢光写进 Prompt（"soft cool-white spill from the display"），素材里已有，合成只校亮度；深色屏的溢光很弱，由合成按设计系统的 glow / spill 参数补足。
2. **比例校验（正视真实尺寸）**：`screens.json` 的四角来自客户产品渲染图（斜角视图）的抠像，带渲染透视（例如 gateway_front 上边 tl(93,60)→tr(435,94) 明显倾斜），原表里的屏幕高宽比 2.22 / 1.93 / 2.15 / 2.00 / 1.95 都是透视造成的。这些像素坐标和比例**不能**拿到 GPT-image 或 Seedance 生成的画面里去初始化追踪或检查透视。生成画面按下表的正视真实比例校验：所有屏幕都是 16:9 竖屏，高宽比约 1.78；设备正对镜头时（例如 S15，偏转 ≤ 5°），屏幕在画面里的高宽比应接近 1.78，斜看时按透视变化。

| 设备 | 屏幕（宽 × 高，cm） | 屏幕高宽比 | 机身（宽 × 高，cm） | 屏幕中心离地 |
|---|---|---|---|---|
| Gateway V2 86″ | ≈ 107 × 190 | 1.78 | 114 × 218（深 60，含底座） | ≈ 113 cm（落地） |
| Paragon Outdoor 65″ | ≈ 81 × 143 | 1.77 | 97 × 246（深 90） | ≈ 118 cm（落地） |
| Portal 55″ | ≈ 68 × 121 | 1.78 | 73 × 125 | 150 cm（壁挂） |
| Portal 43″ | ≈ 53 × 95 | 1.79 | 57 × 99 | 150 cm（壁挂） |
| Portal 32″ | ≈ 40 × 71 | 1.78 | 43 × 74 | 150 cm（壁挂，高于约 100 cm 的三辊闸） |

   本文凡写「约 73 × 125 / 57 × 99 / 43 × 74 cm」的都是 Portal 的**机身**，屏幕按上表。05 §1.4 里的 Portal 屏幕可视区（55″ 写作 65 × 115 等）应按本表统一。

3. **追踪**：逐镜做平面追踪（Mocha 平面追踪，或逐帧四边拟合求交）。追踪对象是屏幕边缘：Gateway 的内框线、Portal 的黑色内边框、Paragon 黑玻璃屏区的边缘，高对比的边框比任何角点都稳；边缘被遮挡时，用机身平面（header 横梁、LED 灯条、灯箱）补帧。`screens.json` 只用于代码版。
4. **遮挡遮罩：差值键控 + roto**。先在屏幕四边形内拟合一张平滑的「干净底板」亮度面，素材与它做差值。浅色屏按「**比屏幕暗**」取遮挡物：陈师傅的肩、黑发、藏蓝大衣、玳瑁镜框、字条边缘都明显比浅灰白暗，逆光下也抠得出来。深色屏按「**比屏幕亮**」取遮挡物（阈值高于黑电平 3%）。头发、手指、镜框边缘再用 roto 修。反过来说，如果浅色屏也生成成纯黑，逆光的藏蓝大衣、黑发和玳瑁镜框本身接近黑电平，亮度键控抠不出来，UI 会盖到她的肩上。
5. **贴图**：把 Claude Code 渲染的 1080×1920 屏幕画布（Lyra 素材作底 + Lyra OS UI）按四角做 homography（CSS matrix3d）贴入，UI 布局、字号、状态与缓动全部按设计系统和 master 的 `ui_zh`。
6. **匹配**：原生反光回叠：素材减去干净底板，得到玻璃反光和亮度起伏，贴完 UI 后以 screen 模式叠回；再补 3–5% 的环境反光；贴入层加与素材一致的运动模糊、景深虚化和颗粒；屏幕辉光、地面溢光和 LED 灯条倒影由合成补足（浅色屏的溢光和倒影在素材里已有，只校亮度）。
7. **Center-Lock（S15）**：Lyra 双眼在 `lyra_white.jpg` 画布里约在（565, 292）/ 1125×2000，双眼间距约 70 px，即双眼中点位于画布高度 14.6%、宽度 50.2%。要让五格里 Lyra 双眼都落在影片坐标 **(960, 405)**、双眼间距恒为 **20 px**，每格设备的**屏幕**在画面里必须约为 **321 × 571 px**（高宽比 1.78），水平居中，屏幕上沿约 **y 322**、下沿约 **y 893**，设备正对镜头（偏转 ≤ 5°）。S15 的五个首帧都按这个框构图，不同设备只是改变与环境的比例。
8. **背面品牌**：S14 的 Paragon 背面、任何出现的 Gateway 背面，发光的 X 与 LIVEX.AI 一律用 `paragon_back.png` / `gateway_back.png` 的真实像素平面追踪贴合（bloom 0.5），生成时背面标志区留作未点亮的黑色点阵或黑板。

### 1.7 Lyra 屏幕素材：单独在白底 / 黑底生成

**规则**：Lyra 只在两种干净背景上生成。白底 = `lyra_white.jpg` 的无缝白色影棚（右侧柔和投影），用于 Gateway、Portal（日间）；黑底 = `lyra_black.jpg` 的纯黑背景，用于 Paragon 和医院夜间 Portal。9:16 素材就是屏幕画布本身（1080×1920），构图与定妆照一致：头顶约在画布 8%，脚在约 99%，人物居中。

**唯一的指向母版 LYRA-POINT。** S08 → S09 → S10 开头这一段连续画面，以及 S11 的示意，只用这一个姿态：她的**左手**（画面右侧那只）在髋高向画右外侧展开，手臂与身体约 30–40°，掌心朝上张开、四指并拢；右手留在腰前；手位于画布 y 900–1150；上身正对镜头、微微侧向画右，视线温和地看向画右（Exit B 方向）。手臂不横过身体，所以不遮住腰带和左胸的 X 标，也避开了横过身体的手臂这一手部畸形的高发角度；手的高度在 L4 所取的画布下半窗口之内。master S08 / S09 写的「右手指向画右」，按画面方位理解为画面右侧那只手，即她的左手（建议 master 措辞同步）。

**姿态帧派生规则（防漂移）**：
- LYRA-… 帧一律在 ChatGPT 里用**选区重绘**，只改手臂、腿和躯干朝向，不整图重画。GPT-image 整图编辑会重绘脸型、发型分侧、耳饰、X 标的位置和形状、金扣。
- 头部朝向不变的帧（LYRA-POINT-9x16、LYRA-S08-START / -END、LYRA-ECU）定稿后，把 `lyra_white.jpg` 原图的脸和头发像素贴回原位，再做边缘融合。
- 头部朝向必须改变的帧（LYRA-S05 侧身低头、LYRA-S06 视线下移、LYRA-WALK-START 侧身）无法贴回，按附录 B 的 Lyra 验收项做面部叠图比对。
- Seedance 在转身和步行（L6–L9）时可能左右镜像。侧身向画左走时，镜头看到的是她的左侧身，左胸的 X 在靠近镜头的一侧；X 消失、跑到右胸或远侧，就是镜像，重新生成。

| LYRA 帧 | 由什么派生 | 用于 |
|---|---|---|
| LYRA-POINT-9x16 | `lyra_white.jpg` 选区重绘左臂（按上面的定义），构图不变（头顶约 8%，脚约 99%），脸与头发贴回原图像素 | L5 首帧；L4 尾帧的来源；L9 的姿态参考；所有「指向」的唯一定义 |
| LYRA-POINT-MASTER | LYRA-POINT-9x16 放大或分块重绘到 ≥ 4320×7680（面部 ≥ 4×） | S09 段 A 的 2D 母版 |
| LYRA-ECU | LYRA-POINT-MASTER 在 20.0 取景处的 16:9 裁切（双眼与微笑） | L1 首帧（可选） |
| LYRA-S05 | `lyra_white.jpg`：头肩，侧身微低头，视线落向画外右下，人物在画左 1/3 | L2 |
| LYRA-S06 | `lyra_white.jpg`：胸像，双眼在上三分线，视线略向下约 15–20°，落在镜头右侧（陈师傅的位置），不直视镜头 | L3 |
| LYRA-S08-START · LYRA-S08-END | `lyra_white.jpg` / LYRA-POINT-9x16 的画布下半窗口（约 y 820–1430，全宽），按 16:9 重绘到 1080p | L4 |
| LYRA-WALK-START | 21:9 白色无缝影棚，全身侧身，刚从画右边缘迈入，头顶和脚的留白与定妆照一致 | L7 |
| L7-F8-A · L7-F8-B | 从 L7 定稿导出：第一次 / 第二次 Handoff 入框 f8 对应的那一帧 | L8 / L9 的首帧（下一段从同一步开始） |

| 任务 | 画幅 | 用途 | 动作 |
|---|---|---|---|
| L1 LYRA-ECU-MICRO（可选） | 16:9 | S09 20.0–20.5 | 锁定机位的双眼大特写：只有细微的眼神变化、笑意加深和呼吸；上片约 0.5 s |
| L2 LYRA-LEAN | 16:9 | S05 | 头肩，侧身微低头看画外右下的字条 |
| L3 LYRA-TALK | 16:9 | S06 | 胸像，视线略向下约 15–20°、落在镜头右侧，不直视镜头；先笑，再说「Route 7's last stop. I know it.」 |
| L4 LYRA-POINT-LOW | 16:9 | S08 | 画布下半：腰前交握的手 → 左手（画面右侧）在髋高向画右展开成 LYRA-POINT，右手留在腰前 |
| L5 LYRA-POINT-HOLD | 9:16 | S09 接缝前 6 帧至 27.0 的屏幕内容；段 A 母版的呼吸来源 | 全身 LYRA-POINT，定住，微呼吸；**7 s** |
| L6 LYRA-TURN | 9:16 | S10 27.0–27.767 | 从 LYRA-POINT 放下左手，向画左转身，迈出第一步（自然速度约 0.8 s）；出框交给 L7 |
| L7 LYRA-WALK | 21:9 | 两次 Handoff 的 f1–f3 / f6–f8 | 全身侧身，匀速从画右走到画左，一条连续步行 |
| L8 LYRA-UP | 9:16 | S10 Portal 55，28.0–29.767 | 首帧 = L7-F8-A：收住最后一步站定 → 转向镜头 → 右手（画面左侧）抬起向上一指 → 放下（自然速度约 1.5 s）；入框、出框交给 L7 |
| L9 LYRA-GESTURE | 9:16 | S11 Market Hall Gateway，30.0–32.0 | 首帧 = L7-F8-B：站定 → 左手向画右展开成 LYRA-POINT 式的掌心示意（摊位方向），保持 |
| L10 LYRA-B-TALK | 9:16 黑底 | S14 Paragon，42.0–46.35 | 待机 → 45.0 轻轻点头说「Then you know the way.」→ 46.0 起 SIGNAGE 待机；**5 s** |
| L11 LYRA-B-HUSH | 9:16 黑底 | S15 · 01 St. Mary's | 食指轻放唇前，眼神温和 |
| L12 LYRA-B-IDLE | 9:16 黑底 | S15 · 02 Western Univ | 站立，双手腰前轻握，微呼吸 |
| L13 LYRA-W-IDLE | 9:16 白底 | S15 · 03 / 04 / Gate C，S11 尾部 | 同上，白底 |

**The Handoff（L7）**：L7 在 21:9 白底上从画右匀速走到画左，给两次 Handoff 提供**连续的步行帧**。master 的 8 帧结构是出框 3 帧 + 光斑甩镜 2 帧 + 入框 3 帧：
- f1–f3：取 L7 里与上一段末帧（L6 或 L8 的最后一帧）脚步相位相同的连续 3 帧，用跟随她的 9:16 窗口裁出，在上一台屏幕的画布里叠加 translateX 0 → −760 px（push）与只沿 x 方向的 0 → 36 px 模糊（同 05 §7.8）。
- f4–f5：光斑甩镜，没有 Lyra。
- f6–f8：取 L7 紧接着的第 6–8 帧（步伐不断），在下一台屏幕的画布里叠加 +760 → 0（glide），模糊 36 → 0。
- f8 那一帧导出为 L7-F8-A / L7-F8-B，作为 L8 / L9 的首帧，下一段表演从同一步开始，不需要再生成入框步行。
- 横向位移由 2D slide 完成（与代码版一致），步伐来自真实的步行素材，36 px 的横向模糊把两者缝在一起。L6 / L8 / L9 都不生成入框或出框的步行，全部取自然速度段，变速 ≤ 1.15×。

**分辨率说明**：21:9 1080p 素材里一个 9:16 窗口约 607×1080 px。Portal 与 Market Hall 的 Gateway 中景里，屏幕在影片里的显示高度不超过约 1080 px，窗口是原生分辨率；27.767 的 Gateway 近景（J10a）屏幕显示高度约 1540 px，窗口要放大约 1.4×，但出框帧本身带 36 px 模糊，看不出来。

### 1.8 人物与道具一致性

- **陈师傅**：每条有她的生成都带 CS-CHEN-A 或 -B（按光环境选），首帧来自 KF。Prompt 每次都写全外形锚点：72 岁、1.58 m、银灰齐下巴短发、玳瑁圆框眼镜、藏蓝及膝羊毛大衣、米色帆布托特包、黑色轻便运动鞋、自织红色粗针围巾（#C8372D，全片唯一暖红）；**32.0（S11 变体 / J11b）起**外面叠一条藏青白条 7 号围巾，红色仍从领口露出约 40%。32.0 之前的任何首帧里都只有红围巾，不要出现两条围巾。
- **手**：CS-HANDS 锁右手无名指磨薄细金戒、左手拇指根旧疤。1985 年只拍 31 岁时的手（按 2026 年 72 岁推算，与 master S01 一致）：年轻、皮肤紧致，有少量生活痕迹，指节已有职业司机的粗壮，不是少女手。疤是 1983 年被车门夹伤的，到 1985 年已两年：约 2 cm，淡粉偏白、已平整（与 master S01 一致）；到 2026 年褪成浅色。
- **字条**：PROP-NOTE 留白生成；后期四角追踪贴入真实铅笔手写扫描（「奶奶 — Gate C · 114 · Row 12 · Seat 7」「19:30 ♡ 林」，Seat 7 下一道略弯的下划线）。字条在哪只手：S02 双手捏着；S03 左手攥着；S04 双手展开；S07、S09 右手举起；**S12–S14 一直在左手**（S12 右手指路，S14 右手贴砖）；S16 右手举过头顶。每条有她的 Prompt 都写明字条在哪只手，不能凭空消失，也不要塞进托特包或口袋。
- **Lyra**：只用两张定妆照及其派生姿态帧（派生规则见 1.7）。每条 L 任务都把 `lyra_white.jpg`（或 `lyra_black.jpg`）和对应抠像放进 `image_references`；所有「指向」只用 LYRA-POINT。
- **产品**：每条有设备的任务都把对应抠像放进 `image_references`。放不下时，优先级：人物设定板 > 产品抠像 > 环境参考（张数上限以面板为准，一般 2–4 张最稳）。
- **俱乐部**：Harbour FC Women 是虚构的。藏青 #1c2a4a + 白竖条，无队徽、无赞助商、无文字，刻意避开钴蓝。

### 1.9 什么时候用 draft

- **全部任务先 `draft=true`**，出 480p 草稿，看运动、构图、首尾帧是否吻合、人物有没有漂、设备轮廓和比例是否正确。每条按难度出 2–5 个草稿（附录 A 分档）。
- 480p 看不清的细节（脚轮数量、摄像头模组、灯箱点阵、戒指和疤）不在草稿阶段判死刑，定稿后再按附录 B 复核。
- 选中的草稿在 **7 天内**用 `draft_job_id` 定稿为 1080p，`bitrate_mode=high`。定稿是在草稿运动的基础上出高清，细节仍可能有细微差异，定稿后必须再过一遍检查清单。
- **按批次排期，保证每批都在 7 天窗口内定稿**：批次 1 = 全部 L 任务 + S09（最难、最先锁；L7 必须先定稿，L8 / L9 的首帧要从它导出）；批次 2 = S01–S08（含 4:5 竖幅 J02-V）；批次 3 = S10–S14（J13b 要等 J13a 定稿后取末帧）；批次 4 = S15–S17。每批草稿集中 1–2 天出完，第 3 天审，第 4 天定稿。
- `video_extension` 的输入用已定稿的 1080p 片段；如果面板允许对 extension 先出草稿，同样先草稿。

### 1.10 为什么全片 `generate_audio=false`

1. **声音是一个完整系统。** 配乐、环境、拟音、UI 音和 Sonic Logo 全部由 `film/audio` 的声音引擎逐帧对齐 120 BPM 网格合成（一小节 2.0 s）。每一声「叮」、每一次剪辑点都落在 0.5 s 的拍点上，模型生成的声音无法对上。
2. **声学设计是剧情的一部分。** Lyra 是近讲干声、没有站厅混响，陈师傅带 3 秒混凝土混响，Reveal 时 Lyra 的尾音才长出混响。这是留给耳朵的伏笔，必须由混音精确控制。
3. **版权与原创。** 公交铃必须原创录音或自行合成，哼唱旋律也必须原创；模型音频可能带入不可控的音乐或人声。
4. **对白要可控。** 全片只有 3 句 Lyra 台词和少数几句人声，全部后期配音、按字幕逐词出现；模型自带的人声会说出不存在的词。
5. **口型（可选）。** 需要张嘴说话的片段（L3、L10、J06C 的笑、J12a/J12b、J14b），可以把该句干声作为 `audio_references` 放进 `omni_reference`，只用来引导口型节奏，输出仍然 `generate_audio=false`。先用草稿测试；如果不稳定，就改成嘴部动作很小的表演，把「在说话」交给字幕和钴蓝语音线。

### 1.11 预算估算方法

不在文档里写死单价（以 Higgsfield 面板对 `seedance_2_5` 的实时报价为准，按秒或按条计价都能套用下面的公式）：

```
草稿成本 = Σ(每条任务的生成秒数 × 草稿条数) × P_480p
定稿成本 = Σ(每条任务的生成秒数 × 1) × P_1080p定稿
总预算   = (草稿成本 + 定稿成本) × 1.2        ← 20% 余量，留给返修、extension 和重新定稿
```

- **难度分档**：A 档 5 个草稿（J09B、L7、L8、J14d1、J14d2、J17a、J03、J12a）；B 档 3 个；C 档 2 个（L12、L13、J10a、J15-TN、J18）。J09C 现在是 S09 人潮的唯一来源，从 C 档可选改为 B 档必需。
- **本片合计**（明细见附录 A）：51 条任务，生成总长 **213 s**（其中可选 16 s）；草稿 164 条、**687 s @ 480p**；定稿 51 条、**213 s @ 1080p**。精简版（去掉 4 条可选任务 J05F、J10a、J18、L1）47 条、197 s。
- 相对上一版（50 条 / 207 s / 草稿 670 s）的变化：新增 J02-V（+4 s，草稿 +12 s）；L5 4 → 7 s；L10 4 → 5 s；J09B 8 → 6 s；J09C 5 → 6 s 且改为必需；L8 5 → 4 s（入框、出框交给 L7）；L1 改为可选的 ECU 微表情。
- 若按条计价：草稿 164 条 × 单条草稿价 + 定稿 51 条 × 单条定稿价，再乘 1.2。
- 生成前先用 Higgsfield 的余额 / 报价面板确认单价，把两个 P 值填进附录 A 的表即可得到总数。

### 1.12 合成与交付流水线

1. ChatGPT（GPT-image-2.5）：CS 设定板 → KF 关键帧 → PLATE 版与派生首尾帧 → LYRA 姿态帧（选区重绘，脸与头发贴回）→ LYRA-POINT-MASTER 放大。
2. Higgsfield（Seedance 2.5）：按批次 draft → 审片 → 定稿 1080p（high）→ 必要时 extension 补余量。
3. 剪辑：按 master 时间码上时间线（30 fps），完成变速、2D roll、屏幕平面内的 2D 运动。
4. 合成：逐镜屏幕平面追踪 + 差值键控 / roto 遮挡 + Claude Code 屏幕画布（Lyra 素材 + Lyra OS UI）贴入；字条手写、卷帘牌、翻盖机外屏、站牌字卡（StopCard）、字幕、节点光与标签、背面品牌、雨丝粒子与檐口滴水。
5. 调色与质感：35mm 颗粒（overlay 16%）与暗角；S01 用 16mm 颗粒（overlay 22%）、±1.5 px 片门抖动、红色 halation、柯达 7247 暖青。
6. 声音：整轨来自声音引擎（−14 LUFS / −1 dBTP）。
7. 版本：1920×1080 主版；1080×1350 X 版（4:5，本片的主发布渠道）**默认从中央 864 px 安全列（x 528–1392）中心裁切放大**；**S01、S02、S18 按 05 §1.2.4 原生重排**：S01 用 4:3 窗口重排 J01（取源图以卷帘牌「7」为注册点的约 900×675 区域，手、戒指、疤都要在这个区域内）；S02 的 1.5–3.0 换用竖幅素材 J02-V（字条约 90% 画宽），3.0 起接 J02b 的中心裁切；S18 由 Claude Code 原生渲染。
8. **4:5 硬规则：产品与反转要素必须在安全列内。** 每张首帧构图都保证下列元素落在 x 528–1392：人物的脸与关键动作、Lyra 双眼、设备整机或它的光形、以及承担「反转 / 呼应」的要素——S04 左缘竖光（16:9 在 x 0–230，4:5 版把这团竖光单独抠出或按同参数重建，放到安全列左缘 x 528–640）、S09 的 Exit B 暖光（x ≤ 1350）、S11 的 Gateway（整机 x ≥ 30%）、S13 门缝光（x 1040）、S14 的 Paragon 屏幕（中心 x ≤ 66%，即 ≤ 1267）。做不到的镜头，4:5 版单独重新取景或按 05 §1.2.4 原生重排；有摄影机运动的镜头可以用 05 §1.2.1 的水平偏移 Δ（≤ ±200 px）跟随。

---

## 2. 逐镜提示词 S01–S18

每镜的推荐参数默认：`resolution=1080p`、`aspect_ratio=16:9`、`draft=true`（先出 480p 草稿，7 天内用 `draft_job_id` 定稿 1080p）、`generate_audio=false`、草稿 `bitrate_mode=standard`，定稿 `high`。只有偏离默认值时才在表里特别说明。

### S01 · 00.0–01.5 · 1985 · 方向盘与卷帘牌

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| J01 | omni_reference | 4 s | 1080p | 16:9（后期裁中间 1440×1080 做 4:3 遮幅） | true | false | 素材约 0.3–1.8 s → 成片 0.0–1.5（1:1，不变速） |

参数理由：16:9 生成再裁中间 4:3，像素量和直接出 4:3 相同（都是 1440×1080），而且左右多出的画面可以给 12° roll 旋转补边。`generate_audio=false`：这一段是 1985 年的单声道磁带声（柴油怠速、转向灯「哒—哒」落在 0.0 / 0.5 / 1.0、卷帘摇柄「rrrrt」与 0.9 的定位「咔」），是全片节拍器的起点，必须由声音引擎按 120 BPM 精确放置；这一段不用铃，也没有配乐。

**输入媒体**

| 角色 | 素材 |
|---|---|
| start_image | KF-S01：31 岁女人的双手握着黑色胶木方向盘上缘（直径约 50 cm），驾驶座右后方略俯 15° 越肩；挡风玻璃上缘有一条暖色透光的卷帘牌反光带，**反光带里没有任何字** |
| end_image | KF-S01-END：同机位，双手交替把方向盘向右转过约 180°，右手已经越过左手 |
| image_references | CS-HANDS（左半：1985 年 31 岁的手，按 0.2 重新生成的版本）；PROP：无 |

**Duration**：生成 4 s。成片 1.5 s（帧 0–45）：素材约 0.3–1.8 s **1:1 上片**：素材 0.3–1.1 对应成片 0.0–0.8（转动之前，卷帘牌在后期滚动），素材 1.1–1.8 对应 0.8–1.5（转动的前 0.7 s）。转动起点不在 1.1 s 的草稿，整体平移取段即可，不变速。首尾帧之间的转动如果被模型摊满 4 秒，就只锁首帧重出，让转动按自然速度发生；手部动作不加速。不要求在 S01 里打满方向盘，旋转的动量交给 1.5 的匹配剪辑。

**Camera Movement**：16mm 质感，50mm f/2.8，驾驶座右后方略俯 15° 越肩，轻微手持呼吸（幅度约 ±2 px，0.5 Hz）。生成时摄影机基本不动。0.8–1.5 的「同向旋转 12°」在后期做纯 2D roll（cine 缓动 0.65,0,0.35,1，画面放大约 1.18 倍补角），让旋转方向和方向盘一致，交给 S02 的首帧。

**Character Action**：第 0 帧双手握稳方向盘，指节放松；约 0.8 s 起双手交替把方向盘向右打（hand-over-hand），动作有力、熟练，是开了几年车的手：31 岁，皮肤紧致，有少量生活痕迹，指节已有职业司机的粗壮。右手无名指一枚细金戒（还新，有光泽）；左手拇指根一道约 2 cm、两年的旧疤，淡粉偏白、已平整（1983 年被车门夹伤）。不拍脸、不拍身体。

**Product Position**：无 LiveX 设备。

**Lyra**：无。

**UI**：无屏幕 UI。后期合成：① 挡风玻璃反光里的卷帘牌（代码渲染，镜像、模糊 2 px、35%），0.0–0.9 滚过 NOT IN SERVICE、7 ST. MARY'S，0.9 停在「7 HARBOUR DEPOT」，6 px 过冲回弹；② 影片层角标「1985」（Geist Mono 18 px，x 96 / y 64；4:5 版移入安全列），0.2 s 从模糊到清晰。追踪：反光带是挡风玻璃上的平面，按反光带四角做平面追踪贴入。

**Lighting**：1985 年港城傍晚。窗外钠灯暖色焦外光斑（#ffb468 / #ffd2a0），卷帘牌灯箱的暖色透光从上方落在手背上，驾驶舱内偏暗。生成时保持中性、干净的影像，**不要**让模型加复古滤镜、颗粒或褪色；16mm 颗粒（overlay 22%）、±1.5 px 片门抖动、高光红色 halation、柯达 7247 暖青（阴影 #1f3a3a、高光 #ffd9a8）、暗角 35% 全部后期做。

**Start Frame**：大特写，双手在方向盘上缘，占画面下 2/3；挡风玻璃上缘一条无字的暖色反光带；中间 4:3 区域（x 240–1680）里构图完整。4:5 版按 05 §1.2.4 原生重排（4:3 窗口取源图约 900×675 的区域，以卷帘牌「7」为注册点），双手、戒指、拇指疤和反光带里「7」的位置都要落在这个区域内。

**End Frame**：同机位，方向盘向右转过约 180°，右手越过左手，戒指仍然可见。

**Continuity**：戒指（右手无名指）和拇指根的疤（左手）必须和 S02 的老年手在同一位置。转动方向（向右）和 S02 首帧字条的旋转方向一致。1.5 图形匹配剪辑：卷帘牌的「7」→ 字条上「Seat 7」的「7」，同位置同字高；生成版用方向盘的转动接字条的转动。声音同帧从单声道磁带硬切为 2026 立体声车厢。

**Negative Prompt**：NEG-BASE + readable text on the destination sign, sepia or vintage filter, film-grain overlay, scratches, face, driver's body, modern steering wheel, airbag logo, dashboard screens, smartphone, extra ring, missing scar, fresh red wound, teenage or doll-smooth hands, manicured nails, hands swapping sides.

**English Prompt:**
> J01 — Extreme close-up inside a 1985 single-deck city bus at dusk, over the driver's right shoulder, 15° downward, 50mm, gentle handheld breathing. The two hands of a 31-year-old woman grip the top of a large black bakelite steering wheel: firm skin with a few signs of daily work, knuckles already sturdy from years of driving, short clean nails; a thin shiny gold ring on the right ring finger, a small two-year-old scar at the base of the left thumb, about 2 cm, pale pinkish-white and flat. A narrow warm glowing strip along the top of the windshield is the reflection of the roller destination sign, blank and textless. Sodium streetlight bokeh outside. After about one second she turns the wheel firmly to the right, hand over hand, practiced and confident. Only hands and wheel, no face. Clean neutral image, no film filter. Avoid: any text on the sign, vintage filter, grain, visible face, modern dashboard, extra fingers.

---

### S02 · 01.5–04.5 · 2026 · Seat 7 字条与翻盖手机

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| J02a | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.0–1.2 → 成片 1.5–2.7（1:1） |
| J02b | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材约 0.0–1.8 → 成片 2.7–4.5（自然表演，变速 ≤ 1.15×） |
| J02-V | omni_reference | 4 s | 1080p | **3:4**（1080×1440，裁成 1080×1350） | true | false | **仅 4:5 版**：素材 0.0–1.5 → 成片 1.5–3.0 |

参数理由：后拉（字条）和焦点转移（手机）是两件事，拆成两条更稳。两条的边界提前到 2.7：master 的后拉在 1.5–2.5 已经完成，2.5–3.0 是字条的静止段，把这 0.3 s 交给 J02b，J02b 就有 1.8 s 容纳「焦点转移 → 震两下 → 顶开一条缝 → 犹豫 → 合盖」的自然表演（J02b 在 3.0 才开始拉焦，master 的 3.0 焦点转移不变）。两条都以 KF-S02 为界，2.7 的接缝在字条静止段里做 4 帧叠化，藏在车厢摇晃里。J02-V 是 4:5 版专用的竖幅素材：16:9 里字条宽 62%（约 1190 px），比 864 px 的安全列还宽，中心裁切会把字切掉；master 要求 4:5 版字条宽 ≥ 60%，所以 4:5 版的 1.5–3.0 换成 J02-V（字条约 90% 画宽），3.0 起接 J02b 的中心裁切（此时字条正在虚焦，4 帧叠化）。Seedance 没有 4:5，3:4 最接近，裁掉上下各 45 px。`generate_audio=false`：1.5 的声音硬切（轮轨节奏、35 Hz 车厢低频、纸张轻响）、A 段毛毡钢琴 E3 单音 + E1 低频长音（约 −21 LUFS）、3.0 / 3.25 两下手机震动闷响、4.1 盖子轻响、4.5 合盖「啪」都是剪辑点，必须由声音引擎控制。

**输入媒体**

| 任务 | start_image | end_image | image_references |
|---|---|---|---|
| J02a | KF-S02-ECU：字条上「Seat 7」位置的大特写（纸面留白），右手拇指和戒指在画边，画面整体已按后期 12° roll 的反方向预留余量 | KF-S02：整张对折的米白便签占画宽约 62%，右手捏着，左手在画面左下拿着银色翻盖机（合着），纸面留白 | CS-HANDS（2026 老年手）、PROP-NOTE、PROP-PHONE |
| J02b | KF-S02（同上） | KF-S02-END：焦点在左手的翻盖机上，机盖合着，外屏为黑（03「S02 变体」里外屏是亮的，派生时改为黑，消息后期贴字）；字条在前景虚焦；**翻盖机落在 x 600–1300**，保证 4:5 中心裁切时手机完整 | CS-HANDS、PROP-PHONE |
| J02-V | KF-S02-V-ECU：3:4 竖幅，「Seat 7」位置的大特写（纸面留白），与 KF-S02-ECU 同一旋转方向 | KF-S02-V：03「S02 V」竖幅变体，整张字条约占画宽 90%，双手捏着，翻盖机在字条下方画内，纸面留白 | CS-HANDS（2026 老年手）、PROP-NOTE、PROP-PHONE |

**Duration**：J02a 生成 4 s，上片 1.2 s（1.5–2.7）；J02b 生成 4 s，上片约 1.8 s（2.7–4.5）；合计 3.0 s（帧 45–135）。J02-V 生成 4 s，4:5 版上片 1.5 s（1.5–3.0）。如果只出了 KF-S02-V 一张，J02-V 可以只锁首帧 = KF-S02-V，从 Seat 7 大特写到整张字条的后拉在后期做 2D 缩放（字条是平面，手写字是后期矢量贴入，放大不影响字的清晰度）。

**Camera Movement**：J02a：100mm 微距感 f/2.8，从「Seat 7」大特写平滑后拉到整张字条（settle 缓动 0.22,1,0.36,1），约 1.0 s 完成，然后保持；车厢摇晃 ±4 px（0.8 Hz）。1.5 继承 S01 的 12° 旋转，在后期 0.3 s 内 settle 归零。J02b：机位锁定，前 0.3 s 焦点仍在字条上，3.0 起焦点在 0.3 s 内从字条拉到左手翻盖机（settle），摇晃同上。J02-V：同 J02a 的后拉，竖幅构图，后拉结束时字条宽约 972 px（4:5 画宽 90%），首帧「7」注册到 4:5 的 (540, 675)、字高 264 px（05 §1.2.4）。

**Character Action**：同一双手，72 岁：皱纹、老年斑、同一枚磨薄金戒、同一道拇指疤，捏着对折的米白便签，纸随车厢轻颤。J02b 按自然速度表演：3.0 左手的翻盖机震两下（3.0 / 3.25）；约 3.9–4.1 左手拇指把盖子顶开一条缝，停住，犹豫；4.5「啪」地一下合上。合盖必须准确落在 4.5（声音剪辑点）：挑合盖时刻合适的草稿，整体平移取段；如果自然表演仍放不进 1.8 s，只修剪震动与开盖之间的停顿（这段手机在拉焦中、画面半虚），不加速开盖与合盖本身，整体变速 ≤ 1.15×。仍放不进时，建议 master 把 3.0 的焦点转移改为硬切到手机近景。

**Product Position**：无 LiveX 设备。

**Lyra**：无。

**UI**：无 LiveX UI。后期合成：① 字条铅笔字（真实手写扫描，四角追踪贴合）：「奶奶 — Gate C · 114 · Row 12 · Seat 7」「19:30 ♡ 林」，Seat 7 下一道略弯的下划线，2.6–3.0 一道高光沿下划线扫过；② 翻盖机外屏（单色小屏）：「Ming: Mum, I'll come get you?」滚动一次，4.5 熄灭；③ 角标 1.5 由「1985」split-flap 翻成「2026」；④ 遮幅在 10 帧内从 4:3 推开到全画幅（push 缓动）。字条追踪以纸的四角和对折压痕为特征；外屏按机身外屏四角追踪。

**Lighting**：2026 年 Harbour Line 地铁车厢，18:24 晚高峰。5600K 冷白灯管，背景是横向的冷白焦外光带；每 0.5 s 一道隧道灯高光从左向右扫过纸面。调色转为中性偏冷，35mm 颗粒 overlay 16% 同帧接替 16mm。

**Start Frame**：J02a：「Seat 7」位置大特写，纸纹与对折压痕清楚，右手拇指和戒指在画边。J02b：= KF-S02。J02-V：= KF-S02-V-ECU。

**End Frame**：J02a：= KF-S02，16:9 版整张字条占画宽约 62%，左下是合着的翻盖机（4:5 版不裁这一段，改用 J02-V）。J02b：= KF-S02-END，翻盖机合上，焦点在手机，字条虚焦，手机在 x 600–1300。J02-V：= KF-S02-V，字条约占画宽 90%。

**Continuity**：戒指和疤与 S01 位置一致；字条从此刻起一直在她手里（S04 展开、S07 举高、S09 举着、S12–S14 在左手、S16 举高当标语，见 1.8）。J02-V 与 J02a 的手、戒指、纸纹和旋转方向一致。首帧字条上「7」的位置和字高必须等于 S01 冻结的卷帘牌「7」（代码版约 x 700 / y 470，字高 220 px），生成版至少保证旋转方向与位置连续。4.5 合盖「啪」同帧硬切到 S03 的扶梯梳齿节奏。

**Negative Prompt**：NEG-BASE + handwriting or printed text on the note, readable phone screen, smartphone, young hands, missing ring, scar on the wrong hand, glossy paper, bright white paper.

**English Prompt:**
> J02a — Macro close-up in a 2026 subway carriage at evening rush hour. Wrinkled 72-year-old hands with a thin worn gold ring on the right ring finger hold a folded off-white paper note, the paper blank except for fiber texture and a fold crease. Within the first second the camera pulls back smoothly from an extreme close-up of the note's corner to reveal the whole note filling about 60% of the frame width, then holds; the left hand holds a closed silver flip phone at lower left. The paper trembles with the train's sway; a cool tunnel light sweeps across the paper every half second. Cold 5600K fluorescent bokeh behind. Avoid: any writing on the note, smartphone, young skin, extra fingers.
>
> J02b — Same subway close-up, locked camera. For a moment the blank folded note stays in focus, then focus racks to the old silver flip phone in her left hand, near the center of the frame; the phone buzzes twice, the small outer screen stays dark. At a natural, unhurried pace her left thumb, with a small old scar at its base, pushes the lid open a crack, hesitates, then snaps it firmly shut. Cool fluorescent light, gentle train sway. Avoid: readable or lit screen, smartphone, text, extra fingers, rushed movement.
>
> J02-V — Vertical 3:4 macro in a 2026 subway carriage at evening rush hour. Wrinkled 72-year-old hands with a thin worn gold ring on the right ring finger hold a folded off-white paper note, blank except for fiber texture and a fold crease. The camera pulls back within the first second from an extreme close-up of the note's corner until the whole note fills about 90% of the frame width, then holds; a closed silver flip phone is visible below the note. The paper trembles with the train's sway; a cool tunnel light sweeps across it every half second. Cold 5600K fluorescent bokeh behind. Avoid: any writing on the note, smartphone, young skin, extra fingers.

---

### S03 · 04.5–07.5 · 扶梯升入新换乘大厅

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| J03 | omni_reference | 4 s | 1080p | 16:9 | true（A 档，5 个草稿） | false | 素材 0.0–3.0 → 成片 4.5–7.5 |

参数理由：从扶梯低位后退转为横移，起止构图都要锁，用首尾帧。`generate_audio=false`：扶梯梳齿的金属咔嗒锁八分音符网格，站厅 3 s 长混响人声底噪、颗粒化广播、35 Hz 列车次声、钢琴稀疏单音 B2 / G2、7.0 起脚步声变稀，都由声音引擎按节拍放置。

**输入媒体**

| 角色 | 素材 |
|---|---|
| start_image | KF-S03-START：扶梯顶端低位（离地 90 cm）略仰，画面下缘是斜向上移的金属梯级，她的头和肩刚从画面底部升入；背景是白色清水混凝土柱廊与虚焦的导向牌 |
| end_image | KF-S03：她已踏上平台，3/4 侧身全身停在左三分线，重心微微后移（犹豫），人潮从两侧穿过 |
| image_references | CS-CHEN-A、PROP-SCARF（红）、KF-S09-PLATE（锁站厅材质与灯光，Gateway 在该构图里被柱子挡住） |

**Duration**：生成 4 s，上片前 3.0 s（帧 135–225）。

**Camera Movement**：35mm f/2.8。4.5–6.0 摄影机与她同速后退（glide 0.16,1,0.3,1），约 0.5 m/s；6.0 转为 45 cm 的 3/4 侧跟横移（cine 0.65,0,0.35,1），柱子产生视差；6.5–7.5 摄影机停住，她停在左三分线。

**Character Action**：扶梯把她送进大厅：藏蓝大衣、银灰齐下巴短发、玳瑁眼镜、米色帆布托特包，左手攥着字条，红围巾是唯一的暖色。踏上平台后抬头四下找站名，看到的只有箭头和图形。7.0 脚步第一次犹豫：半步停住，重心后移，下一秒又回正。人潮从两侧穿过，带运动模糊。

**Product Position**：无设备入画。Gateway 在世界坐标里立在 Exit B 方向那根柱子旁，在她前方约 2.5 m，被她前方的柱子完全挡住，本镜看不到任何设备的光。7.5 她向柱旁走两步，第二步跨过剪辑点，停下时 Gateway 在她左侧约 0.8 m（接 S04）。

**Lyra**：无。

**UI**：无。四种语言的导向牌全部虚焦（景深虚化 18–30 px），只看得出深灰圆角矩形、白色箭头和四行灰色短条，**不出任何可读文字**；如果生成画面里冒出文字，用 video_edit 抹掉或在合成里加景深虚化。本镜不出站牌字卡。

**Lighting**：05 · Harbour Interchange，18:29 晚高峰。白色清水混凝土柱廊（模板木纹、蜂窝气孔），5600K 线性吊灯，浅灰抛光水磨石地面反射吊灯；远处 Exit B 方向有一点 2700K 暖光。她身上是冷白轮廓光。

**Start Frame**：= KF-S03-START。梯级在画面下缘，她的头肩在画面中下部升入，落在 4:5 安全列内。

**End Frame**：= KF-S03。3/4 侧身全身在左三分线（x 约 640，仍在 x 528–1392 内），她前方约 2.5 m 是那根挡住 Gateway 的柱子，柱廊纵深，人潮拖影。

**Continuity**：左手攥着字条（S02 的同一张）；红围巾在大衣领口外；没有 7 号条纹围巾（32.0 才叠戴）。7.5 动作连续剪辑：她向前方柱旁走两步，第二步跨过剪辑点；S04 里她靠柱停下时，Gateway 在她左侧约 0.8 m。

**Negative Prompt**：NEG-BASE + readable wayfinding signs, advertising screens, any display unit or screen visible, crowded faces in focus, striped scarf on her, escalator brand plates.

**English Prompt:**
> J03 — Low-angle 35mm shot from the top of an escalator in a new metro interchange hall at evening rush hour. A 72-year-old Chinese grandmother, 1.58 m, chin-length silver-grey bob, round tortoiseshell glasses, knee-length navy wool coat, beige canvas tote, chunky hand-knitted red scarf, a folded note in her left hand, rises into frame on the escalator. The camera retreats with her, then glides sideways as she steps onto the terrazzo platform among white board-formed concrete columns under cool linear pendant lights. Commuters stream past with motion blur. She looks up searching the out-of-focus signs, hesitates half a step, stops at the left third. Avoid: readable signs, screens or display units, sharp faces in the crowd.

---

### S04 · 07.5–10.0 · 柱旁展开字条 · May I?

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| J04 | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.0–2.5 → 成片 7.5–10.0 |

参数理由：锁定机位的近景，首尾帧锁住「低头看字条 → 转头看向画左」。8.0–10.0 的 3% 慢推在后期做（85mm 下 3% 推拉与缩放几乎无差别）。`generate_audio=false`：9.0 的「May I?」是全片第一句近讲干声，必须和四周的站厅 3 s 长混响形成对比；8.5 钢琴停住留半拍空，这个对比只能在混音里做。

**输入媒体**

| 角色 | 素材 |
|---|---|
| start_image | KF-S04：她靠柱停下，3/4 侧脸胸像，双手展开字条（纸面留白），画面左缘约 12% 宽是一团完全虚焦的冷白竖向光带，地面有它的竖直倒影 |
| end_image | KF-S04-END：同机位，她已循声把头转向画左（那团光的方向），字条仍在手里 |
| image_references | CS-CHEN-A、PROP-NOTE |

**Duration**：生成 4 s，上片 2.5 s（帧 225–300）。7.5–8.0 展开字条，8.0–9.0 抬眼看人潮再低头，9.0 转头；转头要在素材约 1.5–2.3 s 之间发生。

**Camera Movement**：85mm f/1.8，锁定；只有极轻的呼吸级漂移。8.0–10.0 极慢推 3%（settle）在后期完成。

**Character Action**：她靠柱停下，重新展开字条，手微微发抖（约 8 Hz 的细小抖动，不是夸张的颤抖）；抬眼扫一圈人潮，又低头看字条。9.0 画外传来一个温和、贴近耳边的年轻女声，她循声把头转向画左，神情是意外和警惕之间。

**Product Position**：Gateway 立在她左侧约 0.8 m，屏幕朝向她，但机身完全不入画。画面左缘那团冷白竖光就是 Gateway 左侧 LED 灯条的焦外，以及它在水磨石上的竖直倒影。观众只当它是站厅的灯。**不能看出任何机身轮廓、边框、header 或屏幕。**

**Lyra**：只闻其声（「May I?」，近讲干声，无站厅混响）。不入画。

**UI**：屏幕在画外，Lyra OS 处于 listening，不可见。后期合成影片层字幕「May I?」（Geist 500 46 px 白，y 940 居中，逐词 blur 10→0，0.25 s），下方 2 px 钴蓝语音线（宽 120 px）随振幅起伏——从此钴蓝线 = Lyra 在说话。**4:5 版**：左缘这团竖光在 16:9 的 x 0–230，中心裁切会把 Gateway 光形的第一次教学裁掉。4:5 版把竖光（虚焦光带 + 地面竖直倒影）单独抠出，或按代码版同参数重建（5600K，宽 180 px，模糊 60 px，bloom 0.35，倒影 k 0.3），合成到安全列左缘（16:9 坐标 x 528–640），她的轮廓光方向不变。

**Lighting**：站厅 5600K 冷白。她朝向画左的一侧被那团竖光打出冷白轮廓光，9.0 转头时轮廓光增强约 30%。背景柱廊冷白焦外光斑 + 人潮拖影。

**Start Frame**：= KF-S04。她的 3/4 侧脸在画面中偏右（双眼落在 4:5 安全列内），左缘 12% 是虚焦竖光。

**End Frame**：= KF-S04-END。她的脸转向画左，眼镜上有一道冷白反光。

**Continuity**：同一张字条（留白）、同一副眼镜、红围巾。转头方向（向画左）接 10.0 的视线匹配剪辑：反向过肩。竖光的位置（画左）必须和 S05 里 Gateway 所在的方向一致。

**Negative Prompt**：NEG-BASE + visible display unit, screen edge, bezel, device silhouette, lamp fixture, handwriting on the note, exaggerated shaking, tears.

**English Prompt:**
> J04 — 85mm close-up, locked, shallow depth of field, cool 5600K metro hall light. The same 72-year-old grandmother (silver bob, tortoiseshell glasses, navy coat, red knitted scarf) stops beside a white concrete column and unfolds a small blank off-white note, her hands trembling slightly. She glances at the passing crowd, looks back at the note. The left 12% of the frame is a completely out-of-focus soft vertical band of cool white light with a vertical reflection on the polished floor. At the end she turns her head toward that light on the left, surprised, as if someone spoke softly beside her. Avoid: any visible screen, bezel or device shape, writing on the note, exaggerated trembling.

---

### S05 · 10.0–12.5 · 过肩：They built a stadium on my bus depot.

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| L2 LYRA-LEAN | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.3–2.8 → 成片 10.0–12.5（屏幕内画面层） |
| J05F（可选） | omni_reference | 4 s | 1080p | 16:9 | true | false | 前景层（陈师傅的肩、红围巾、字条纸边） |

参数理由：这一镜画面严格裁在 Gateway 屏幕边框以内，**画面里没有设备的边框和机身**，整个背景就是屏幕内容本身，所以不适用「屏幕底板 + 四角追踪」，而是屏幕内 Lyra 素材 + 前景层合成。J05F 的背景生成为与 1.6 浅色底板同规格的**均匀发光浅灰白平面**，因为陈师傅在这里是背对亮屏的逆光前景，亮底既符合真实光照（屏幕在她的肩和围巾上勾出冷白亮边），又便于按「比屏幕暗」做差值抠像；省预算时可改用 KF-S05 的前景做 roto + 2.5D 微呼吸。`generate_audio=false`：陈师傅的台词带 3 s 混凝土混响、沙哑不修；B 段 Em9 pad 淡入，心跳式 Sub 落在每小节 1、3 拍（10.0 / 11.0 / 12.0）；站厅底噪压低 4 dB。

**输入媒体**

| 任务 | start_image | end_image | image_references |
|---|---|---|---|
| L2 | LYRA-S05：由 `lyra_white.jpg` 编辑，头肩近景，侧身微低头，视线落向画外右下（字条的位置），白色影棚背景，人物在画左 1/3 | — | `lyra_white.jpg`、`lyra_white_cut.png` |
| J05F | KF-S05-FG：由 03「S05 B」派生，保留前景右下的肩线、藏蓝大衣、红围巾和字条纸边（均虚焦），白色影棚换成均匀发光的浅灰白底板（1.6） | — | CS-CHEN-A、PROP-SCARF |

**Duration**：各生成 4 s，上片 2.5 s（帧 300–375）。

**Camera Movement**：85mm f/2，机高 1.45 m、仰 6°（她眼高 1.47 m，Lyra 眼高约 1.75 m）；锁定，呼吸级漂移。两层都锁定生成，漂移在合成里统一加，保证前景和屏幕层同步。焦点在 Lyra 脸上，前景肩线虚化约 26 px。

**Character Action**：陈师傅背对镜头，低声嘟囔「They built a stadium on my bus depot.」——只看到肩和后颈的细微起伏，脸不入画。

**Product Position**：Gateway 距她约 0.8 m 正对；86 英寸竖屏可视区约 107×190 cm，Lyra 1:1 等身，所以过肩机位微仰，像当年乘客仰头看驾驶座上的她。画面裁在屏幕边框以内，边框不入画。

**Lyra**：生成版：穿白色短袖小立领针织衫的年轻女人侧身、微低头看字条，专注、温和，只露侧脸、深色微卷长发和肩，手在画外。白色影棚背景读作一面被灯照亮的白墙，看上去像一个好心的路人。她不说话。

**UI**：listening：语音线在屏幕底部（画布 y 1790，画外）；**无 UI 露出**。屏幕玻璃层叠 4% 站厅反光（柱廊光斑镜像，screen 模式）——这是唯一的「这是屏幕」线索。影片层字幕：「They built a stadium on my bus depot.」（Instrument Serif Italic 46 px 白 92%，y 940，逐词 blur 8→0，错峰 120 ms，读完停 0.4 s 以 exit 离场）；人说话时没有钴蓝线。

**Lighting**：屏幕是均匀的白色光源，Lyra 身上是影棚柔光（右侧柔和投影）；陈师傅的肩和围巾是逆光，边缘被屏幕的冷白光勾出一圈亮边，红围巾在前景右下占约 18%，是唯一暖色。

**Start Frame**：L2 = LYRA-S05；J05F = KF-S05-FG。合成后 = KF-S05：前景右下是虚焦的肩与红围巾，Lyra 头肩在画左 1/3，双眼落在 4:5 安全列内。

**End Frame**：不锁尾帧。L2 结束时她仍在看字条，嘴角开始有一点笑意（为 S06 的先笑后说做准备）。

**Continuity**：Lyra 的发型、耳饰、针织衫立领与 `lyra_white.jpg` 完全一致。与 S06 同焦段、同光比（正反打纪律）。10.0 视线匹配：S04 她转头向画左 → 本镜反向过肩。

**Negative Prompt**：NEG-BASE + screen bezel, device frame, visible UI, Lyra looking at camera, Lyra speaking, heavy makeup, different hairstyle, logo on the wall, the old woman's face visible.

**English Prompt:**
> L2 — 16:9 head-and-shoulders shot of the woman from the reference photo, same face, long dark softly wavy hair, small earrings, white short-sleeve mock-neck knit top with a small blue X mark on the left chest, against a seamless bright white studio with a soft shadow to the right. She stands in the left third of the frame, leans slightly and looks down toward the lower right as if reading a note someone is holding out, attentive, kind, a faint smile beginning. Locked camera, 85mm, soft even studio light. Avoid: bezel or screen edge, looking into the lens, talking, different hair or outfit.
>
> J05F — Locked 85mm over-the-shoulder foreground: the out-of-focus shoulder of an elderly woman's navy wool coat and a chunky red knitted scarf in the lower right, the edge of a small off-white paper note, all softly backlit against an evenly glowing, featureless light grey-white surface that fills the background. Subtle breathing movement as she mutters something. Avoid: her face, any image on the white surface, text.

---

### S06 · 12.5–15.0 · 反打：Route 7's last stop. I know it.

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| L3 LYRA-TALK | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.2–1.7 → 成片 12.5–14.0 |
| J06C | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材约 0.5–1.5 → 成片 14.0–15.0 |

参数理由：12.5–14.0 是屏幕内画面（Lyra 近景白底，无边框），按 Lyra 素材生成；14.0 硬切陈师傅近景，单独首尾帧生成。`generate_audio=false`：12.5 Lyra 动机首次出现（FM 玻璃钟 G5–B5–E6，小调，载波:调制 1:3.5），刻意留给被读懂的这一句；Lyra 仍是干声；14.4 陈师傅短笑 + 吸气带站厅混响；Pad 转 Cmaj7。台词口型可选用 `audio_references`（见 1.10）。

**输入媒体**

| 任务 | start_image | end_image | image_references | audio_references（可选） |
|---|---|---|---|---|
| L3 | LYRA-S06：由 `lyra_white.jpg` 选区重绘（参考 03 S06 展示版），Lyra 胸像，双眼在上三分线，视线略向下约 15–20°、落在镜头右侧（陈师傅的位置），不直视镜头，嘴角刚开始笑，白色影棚背景 | — | `lyra_white.jpg`、`lyra_white_cut.png` | Lyra 干声「Route 7's last stop. I know it.」 |
| J06C | KF-S06-CHEN：陈师傅近景（100mm），微低头，愣住，冷白光从画左（屏幕方向）打来 | KF-S06-CHEN-END：她已慢慢抬头，眼眶发亮，嘴角带一声短笑后的松弛 | CS-CHEN-A | — |

**Duration**：L3 生成 4 s，上片 1.5 s；J06C 生成 4 s，上片 1.0 s。合计 2.5 s（帧 375–450）。

**Camera Movement**：L3：85mm f/2，与 S05 同焦段同光比；生成锁定，12.5–14.0 极慢推 2%（settle）在后期完成。J06C：100mm，锁定，呼吸级漂移。

**Character Action**：L3：Lyra 温暖地看着她，嘴角先笑，然后自然地说「Route 7's last stop. I know it.」，说话的节奏平稳、低声、确定，头部几乎不动。J06C：14.0 陈师傅愣住，慢慢抬头，眼眶一热，14.4 短短笑了一声——有人记得她的总站。不哭，不擦眼泪。

**Product Position**：同 S05。反打陈师傅时，屏幕是她脸上唯一的冷白光源，在画左画外。

**Lyra**：生成版：近景，克制温暖的笑，说话自然。与定妆照同一张脸、同一身衣服。视线统一为：略向下约 15–20°，落在镜头右侧（陈师傅的位置），不直视镜头。Lyra 眼高约 1.75 m、陈师傅眼高 1.47 m、相距 0.8 m，视线向下约 19°（不是 10°）。

**UI**：speaking：语音线振幅由分层噪声驱动（屏幕内，画外）；无卡片。影片层字幕：「Route 7's last stop. I know it.」（Geist 500 46 px，逐词从模糊到清晰，每词 0.14 s），下方 2 px 钴蓝语音线（宽 220 px）振幅跟随配音包络。Lyra 双眼落在影片 y≈360，4:5 安全列内。

**Lighting**：L3：白色影棚柔光，右侧柔和投影，与 S05 完全一致。J06C：画左冷白屏幕光作为主光，眼镜镜片上一道冷白高光（14.4 笑声处高光闪亮一次）；背景柱廊冷白焦外 + 远处一点 Exit B 暖光。

**Start Frame**：L3 = LYRA-S06；J06C = KF-S06-CHEN。

**End Frame**：L3 不锁尾帧（结尾停在一句话说完后的温和微笑）；J06C = KF-S06-CHEN-END。

**Continuity**：正反打同焦段、同光比。L3 的发型、耳饰、立领、左胸蓝色 X 与 S05 一致。J06C 的眼镜、发型、红围巾与 S04 一致。15.0 动作剪辑：她举起字条的动作跨过剪辑点，接 S07。

**Negative Prompt**：NEG-BASE + (L3) bezel, UI, robotic stiffness, exaggerated lip movement, teeth-heavy grin, different outfit; (J06C) tears streaming, crying, hand wiping eyes, open-mouthed laugh, looking into the lens.

**English Prompt:**
> L3 — 16:9 chest-up close-up of the woman from the reference photo against a seamless white studio with a soft shadow to the right, eyes on the upper third, her gaze lowered about 15 to 20 degrees and resting just right of the lens on a shorter person in front of her, never looking into the lens. She smiles first, warmly and with restraint, then says one short sentence calmly and softly, head almost still. 85mm, locked, even soft studio light. Avoid: bezel, UI, exaggerated mouth movement, stiff robotic look, different hair or outfit.
>
> J06C — 100mm close-up of the 72-year-old grandmother (silver bob, round tortoiseshell glasses, red knitted scarf) in a cool-lit metro hall, lit from the left by a soft cool-white light. She freezes, then slowly lifts her head, her eyes glisten, and she lets out one short surprised laugh, moved but not crying. Locked camera, background bokeh of cold white lights and one distant warm light. Avoid: tears running, crying, wiping eyes, looking into the lens.

---

### S07 · 15.0–17.5 · 镜片反光：铅笔字变印刷体

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| J07 | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.0–2.5 → 成片 15.0–17.5 |

参数理由：本镜没有 GPT-image ★ 关键帧，首尾帧由 CS-CHEN-A 派生，锁住「字条从下方升入 → 举高对准摄像头」。`generate_audio=false`：铅笔「沙沙」逐渐变成细小的打印「嗒」（每字一嗒，十六分音符，与字形变化同帧），UI 音只取纸与木，压在 −18 LUFS 以下；心跳 Sub 继续，Pad G/B。

**输入媒体**

| 角色 | 素材 |
|---|---|
| start_image | KF-S07-START：100mm 微距，画面上半是玳瑁圆框眼镜的一只镜片和她的眼睛（侧前方），镜片上有一块干净的冷白矩形反光；画面下半空着（背景虚焦），字条刚从下缘露出一角 |
| end_image | KF-S07-END：同机位，留白的字条已经举起，占画面下半约 48% 宽，前景轻虚，背光透亮；镜片里的冷白反光更亮 |
| image_references | CS-CHEN-A、CS-HANDS、PROP-NOTE |

**Duration**：生成 4 s，上片 2.5 s（帧 450–525）。字条升入要在素材前 0.4 s 内完成（对应 15.0–15.4 的动作切）。

**Camera Movement**：100mm 微距 f/2.8，锁定；焦点在镜片反光上，字条前景轻虚（约 6 px）。

**Character Action**：她下意识把字条举高，对准 Gateway header 正中的黑色玻璃摄像头，像当年乘客把月票举给她看。手稳住了。眼睛透过镜片看着前方的屏幕，瞳孔里是冷白的光。

**Product Position**：屏幕在她正前方约 0.6 m；她举起的字条正对 header 横梁正中的黑色玻璃摄像头模组。设备本身不入画，只以镜片里的冷白反光存在。

**Lyra**：不入画，只以反光中的冷白光存在。

**UI**：后期把 Lyra OS 画布镜像缩略后贴进镜片反光区域（scaleX −1、30% 椭圆遮罩、约 18 px 球面位移模拟凸面镜片）。屏幕下方 22% 区域的路线卡在反光里成形：孙女的铅笔字先以原笔迹浮起，15.9–16.7（0.8 s，settle）逐字变成 Geist 印刷体，组成「Exit B → Market Hall → Gate C · 9 min」；逐字错峰 45 ms，铅笔层 blur 0→6 px 淡出、Geist 层 blur 6→0 px 淡入、字距 0.06em→−0.01em。前景字条本体贴真实手写扫描。镜片反光区按镜框内圈做平面追踪（镜框随头部轻微移动）。

**Lighting**：主光是正前方屏幕的冷白光（在镜片上形成矩形反光），侧面柱廊冷白焦外；字条被屏幕光从背后照透约 12%。

**Start Frame**：= KF-S07-START。镜片在画面上半中间（4:5 安全列内），反光矩形清楚、干净、无内容。

**End Frame**：= KF-S07-END。字条占下半，镜片反光更亮。

**Continuity**：同一副玳瑁眼镜（形状、颜色与 CS-CHEN-A 一致）；右手无名指的戒指在字条边缘可见。17.5 方向连续剪辑：反光里的卡片向画右滑出 → S08 的路线卡边缘从左向右滑过。

**Negative Prompt**：NEG-BASE + readable reflection, text in the lens, writing on the note, a visible screen or display unit, glasses changing shape, thick modern frames, blurry eye.

**English Prompt:**
> J07 — 100mm macro, locked. Upper half of the frame: one lens of an elderly woman's round tortoiseshell glasses and her eye behind it, a clean bright cool-white rectangular reflection in the lens. From the bottom edge she raises a small blank off-white folded note and holds it up steadily toward something in front of her, like showing a bus pass to a driver. The note fills the lower half, slightly out of focus, softly backlit. Focus stays on the lens reflection. Cool white light from the front. Avoid: any text or image in the reflection, writing on the note, visible screen, glasses changing shape.

---

### S08 · 17.5–20.0 · 路线卡滑过 · Step-free route

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| L4 LYRA-POINT-LOW | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.0–2.5 → 成片 17.5–20.0（屏幕内画面层） |

参数理由：画面是屏幕下半（边框刚好不入画），全部在屏幕平面上，所以 60 cm 横移在后期做成纯 2D 平移，Lyra 素材锁定机位只生成手臂动作。尾帧必须等于 S09 起全程使用的唯一指向母版 LYRA-POINT（1.7）。L4 的 16:9 画面对应画布下半窗口约 y 820–1430（全宽 1080），LYRA-POINT 的手在 y 900–1150，完整落在窗口内；交握的手在窗口上缘。`generate_audio=false`：17.5 卡片滑入一声纸页轻响；18.5 Step-free 开关 = 一声软木鱼（第 10 小节第 2 拍）；18.0–20.0 噪声上升音 + 反向钟声吸气，把能量吸向 20.0 的 Boom。

**输入媒体**

| 角色 | 素材 |
|---|---|
| start_image | LYRA-S08-START：由 `lyra_white.jpg` 画布下半窗口（约 y 820–1430）按 16:9 构图重绘到 1080p：黑皮带金扣、在腰前轻轻交握的双手（窗口上缘）、炭灰阔腿裤，白色影棚背景 |
| end_image | LYRA-S08-END：由 LYRA-POINT-9x16 的同一窗口重绘：左手（画面右侧）从腰前松开，在髋高向画右外侧展开，手臂与身体约 30–40°，掌心朝上张开、四指并拢；右手留在腰前 |
| image_references | `lyra_white.jpg`、LYRA-POINT-9x16 |

**Duration**：生成 4 s，上片 2.5 s（帧 525–600）。手的展开在素材约 0.3–1.3 s 完成，之后保持（提示词写明「一秒内完成然后保持」；草稿若把动作摊满 4 秒，改为只锁首帧 + LYRA-POINT-9x16 作参考）。

**Camera Movement**：生成锁定。后期 17.5–20.0 向画右做约 60 cm 等效的 2D 横移（cine 0.65,0,0.35,1），方向与路线一致；边框刚好不入画。

**Character Action**：Lyra 从双手交握的待机姿态，把左手（画面右侧那只）自然地松开，在髋高向画右外侧展开成 LYRA-POINT：掌心朝上、四指并拢，手臂不横过身体；右手留在腰前。动作舒展、从容，像礼宾在给人指一条路；到位后保持不动，只有极轻的呼吸。

**Product Position**：同 S05（Gateway 屏幕下半，画面裁在边框以内）。

**Lyra**：生成版：LYRA-POINT（左手在髋高向画右展开，掌心朝上）。master 写的「右手指向画右」按画面方位读作画面右侧那只手（1.7）。代码版对应的是 makeRoom 让位，生成版不需要。

**UI**：result → handoff。Claude Code 渲染的屏幕画布按同一 2D 平移合成（卡片与 Lyra 同在屏幕平面，跟随同一变换）：卡片区 y ≥ 1160，左右 64 px，圆角 36，rgba(255,255,255,.74) + backdrop blur 28 px + 1.5 px 白描边；眉标「ROUTE」（Geist Mono 21，0.16em）；标题「Exit B → Market Hall → Gate C」（Geist 50/600/−0.025em）；数字「9 min」（Geist 84/500）；RouteMap 细线平面图，钴蓝路线（3 px 圆头）由左画到右并越出卡片右缘（0.9 s，glide）；底行开关「Step-free route」18.5 由灰 #e3e6eb 转钴蓝 #2F5BEA（240 ms，cubic-bezier(0.34,1.56,0.64,1) 轻回弹，同帧一圈 pulseRing）。状态栏：[X] Harbour Interchange ｜ 18:31 ●。卡片不遮挡 Lyra 腰部以上。

**Lighting**：白色影棚柔光，右侧柔和投影，与 S05 / S06 一致。屏幕玻璃层叠 3–4% 站厅反光。

**Start Frame**：= LYRA-S08-START。

**End Frame**：= LYRA-S08-END，左手在髋高向画右展开。

**Continuity**：尾帧姿态 = LYRA-POINT-9x16 = S09 全程的 Lyra 姿态 = S10 27.0 的起始姿态。17.5 的路线卡从左向右滑过，接住 S07 反光里向右滑出的卡片。20.0 硬切到 Lyra 双眼大特写，Reveal 从这一帧开始，Boom 同帧。

**Negative Prompt**：NEG-BASE + bezel, face in frame, arm crossing the body, hand raised above the chest, pointing index finger, fist, finger gun, stiff mannequin arm, different trousers, visible UI generated by the model.

**English Prompt:**
> L4 — 16:9 locked shot of the lower half of the woman from the reference photo against a seamless white studio: black belt with a gold buckle and hands lightly clasped at the waist near the top edge, charcoal high-waisted wide-leg trousers with a front crease below. Within the first second she releases her left hand (on the right side of the frame) and opens it outward to the right at hip height, the arm about 30 to 40 degrees away from her body, palm up, fingers together, like a concierge showing the way; her right hand stays at her waist. Then she holds still, breathing softly. Soft even studio light, soft shadow to the right. Avoid: her face, bezel, text, arm crossing the body, pointing finger, fist, stiff mannequin arm.

---

### S09 · 20.0–27.0 · LiveX Reveal（一镜到底后拉）

**推荐参数**

| 段 / 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| 段 A · LYRA-POINT-MASTER（静帧） | 不用 Seedance | — | ≥ 4320×7680 | 9:16 | — | — | 20.0 → 接缝（≈ 20.6）的 2D 缩放母版 |
| 段 A · L1 LYRA-ECU-MICRO（可选） | omni_reference | 4 s | 1080p | 16:9 | true | false | 约 0.5 s → 20.0–20.5，叠化进母版 |
| 段 A / B · L5 LYRA-POINT-HOLD | omni_reference | **7 s** | 1080p | **9:16**（= 屏幕画布） | true | false | 接缝前 6 帧（≈ 20.4）至 27.0 的屏幕画布（约 6.5 s + 余量）；也是母版呼吸的来源 |
| 段 A′ · KF-S09-SEAM-PLATE（静帧） | 不用 Seedance | — | ≥ 3840×2160 | 16:9 | — | — | 接缝 → ≈ 20.9，两层 2.5D |
| 段 B · J09B | omni_reference | **6 s** | 1080p | 16:9 | true（A 档，5 个草稿） | false | 时间重映射到 ≈ 20.9–26.4（平均约 1.09×） |
| 段 B · J09C | omni_reference | **6 s** | 1080p | 16:9 | true（B 档，**必需**） | false | 人潮层 22.5–27.0，1 倍速 |

参数理由：拆段、接缝和时间重映射的完整方法见 1.5。段 A 全在屏幕玻璃以内，用高分辨率母版做 2D，不让视频模型对屏幕里的人做光学后拉。L5 从 4 s 加到 7 s：它要覆盖接缝前到 27.0 的全部屏幕内容（约 6.5 s），还要留出入点和出点余量（呼吸是周期运动，万一不够可以 ping-pong 循环）。J09B 从 8 s 改为 6 s：人潮已经从 J09B 拿掉，改由 J09C 按 1 倍速提供，J09B 只剩摄影机运动和静止物体，6 s → 约 5.5 s 的重映射在任何局部都不超过 1.8× 加速或 2× 光流慢放。原方案把 8 s 压到 3.9 s（约 2.05×），会让下班人流变成快进式疾走，是最明显的 AI 感。L5 用 9:16，因为它就是 Gateway 的 1080×1920 屏幕画布。`generate_audio=false`：20.0 Boom（62→28 Hz）+ 宽 Pad（Cmaj9 → G/B），直立贝斯拨弦与 35 Hz 低频第一次进入，钢琴旋律，无鼓；Lyra 动机再响一次，干声起步，尾音混响随后拉从 0 s 长到站厅的 3 s；25.5 第一声公交铃「叮」（E6 1318.5 Hz，非谐泛音 1 / 2.76 / 5.40）落在第 13 小节第 4 拍，与字卡同帧；26.0–27.0 木质点击铺垫。声音跟着后拉一起变宽，这是整片声音设计的第一个高潮，不能交给模型。

**输入媒体**

| 任务 | start_image | end_image | image_references |
|---|---|---|---|
| 母版 | LYRA-POINT-MASTER（1.7） | — | — |
| L1（可选） | LYRA-ECU：LYRA-POINT-MASTER 在 20.0 取景处的 16:9 裁切，双眼与微笑，白色影棚 | — | `lyra_white.jpg`、LYRA-POINT-9x16 |
| L5 | LYRA-POINT-9x16：由 `lyra_white.jpg` 选区重绘，全身 LYRA-POINT（左手在髋高向画右展开、掌心朝上，右手在腰前），构图与定妆照一致（头顶约 8%，脚约 99%），脸与头发贴回原图像素 | — | `lyra_white.jpg`、`lyra_white_cut.png` |
| J09B | KF-S09-SEAM-PLATE：屏幕约占画宽 60%（画框高约 1.0 m，距屏幕约 1.7 m，机高约 1.4 m，镜轴垂直屏幕），上下边框在画外；左右细黑边框、内框线、两条白色 LED 竖灯条和侧面打孔格栅可见；**屏幕为浅色底板**（均匀发光的浅灰白，带 3–5% 站厅反光）；背后站厅深度虚焦、偏暗；陈师傅不在画内；无人潮 | KF-S09-CLEAN-PLATE：26.4 海报帧的无人潮版（KF-S09-PLATE 去掉人潮，其他不变；见 End Frame） | `gateway_front.png`、CS-CHEN-A、PROP-SCARF |
| J09C | KF-S09-PLATE（26.4 海报帧，带人潮，同机位锁定） | — | KF-S09-PLATE |

**Duration**：成片 7.0 s（帧 600–810）。段 A：20.0 → ≈ 20.6（母版 2D；可选 L1 叠在 20.0–20.5；接缝前 6 帧叠化到 L5）。段 A′：≈ 20.6 → ≈ 20.9（KF-S09-SEAM-PLATE 两层 2.5D）。段 B：≈ 20.9 → 26.4（J09B 6 s 重映射）+ 26.4–27.0 落幅静止。人潮：22.5–27.0 来自 J09C，1 倍速。

**Camera Movement**：主缓动 cubic-bezier(0.16,1,0.3,1)（glide）。master 关键帧按物理顺序展开（1.5 表）：20.0 双眼大特写 → ≈ 20.6 屏幕宽 = 画宽，之后左右细黑边框、内框线与两条 LED 灯条从两侧进入 → 21.5 Lyra 全身充满画高 → 22.5 上下细黑边框与内框线扫入，屏幕矩形闭合 → 23.5 header、摄像头完整入画，LED 灯条几乎全长，23.5–24.0 降速到 15%，在灯条上多停半拍 → 24.5 底板与锁定脚轮落地、竖直倒影出现，陈师傅从前景左侧入画 → 25.5 升 0.6 m → 26.4 升 3 m、俯 9° → 26.4–27.0 落幅静止 0.6 s（海报帧）。镜头统一为全画幅等效 35mm：Gateway 占画高 90% ↔ 4.2 m，62% ↔ 6.0 m，30% ↔ 12.5 m。段 A 的缩放全部在 2D 里完成；J09B 生成时是「连续后拉 + 缓慢升起 + 最后轻微下俯」，在灯条处自然放慢，最后稳稳停住；精确曲线靠 1.5 的时间重映射表对位。

**Character Action**：Lyra（屏幕内，全程）：20.0 眼睛和微笑，还像一个真人路人；保持 LYRA-POINT，只有呼吸和微笑。陈师傅（段 B）：站在 Gateway 前方约 1.2 m、偏左，3/4 背影，右手仍把字条举在胸前偏高的位置，**完全静止**。人潮（22.5 起，J09C）：下班人流带 1/4 秒快门的拖影，1 倍速，像水一样绕过她们流走；只有她和 Lyra 不动。

**Product Position**：Gateway V2 首次完整亮相。落地立在 30 m 清水混凝土柱廊间、Exit B 方向那根柱旁，4 个万向脚轮锁定，宽大的黑色矩形底板压在浅灰水磨石上，屏幕朝她。哑光黑粉末喷涂钢机身，侧面竖向打孔散热格栅；header 横梁略宽于机身、向前微挑，正中黑色玻璃摄像头对着她举起的字条；细黑边框 + 内框线；正面左右两条几乎通高的白色 LED 竖灯条，在水磨石上拖出两道竖直倒影（Gateway 光形）。整机 2.18 m，比 1.58 m 的她高 60 cm；机身 114 × 218 cm，屏幕约 107 × 190 cm（高宽比 1.78），Lyra 1:1 等身（眼高约 1.75 m），陈师傅的头顶大约与屏幕里 Lyra 的肩线齐平。以真实距离为准：26.4 海报帧摄影机在 Gateway 正前方约 12.5 m、离地约 4.7 m、俯 9°，Gateway 约占画高 30%（35mm）。设备全程静止，镜头只后拉和升起，不绕机。

**Lyra**：全身写实：白色短袖小立领针织上衣（左胸小蓝 X）、黑皮带金扣、炭灰高腰阔腿裤、黑色尖头高跟鞋，白色影棚背景右侧柔和投影；生成版为 LYRA-POINT（她的左手、即画面右侧那只，在髋高向画右展开，掌心朝上；右手在腰前；左胸 X 不被手臂遮挡）。master 写的「右手指向画右」按画面方位读作画面右侧那只手。段 A′ 与段 B 里她只以 L5 画布的形式贴在屏幕上。

**UI**：屏幕 UI 完整可见（段 A 后半起）：状态栏 y 52–108（[X] Harbour Interchange ｜ 18:31 ●，钴蓝在场点呼吸）；Lyra 腰部以上无遮挡；卡片区 y ≥ 1160 路线卡「Exit B → Market Hall → Gate C · 9 min」，钴蓝路线指向画右，「Step-free route」开关为开；语音线 y 1790 平静。影片层：25.5 站牌字卡「05 · Harbour Interchange / Route 7 · 18:31」（x 96 / y 940；4:5 版 x 564），从左 16 px 滑入 320 ms，停 0.8 s，模糊淡出，与「叮」同帧。追踪：段 A′ 在静帧的设备层上直接贴画布（与设备层同一变换）；段 B 以 Gateway 内框线逐镜平面追踪（Mocha 或四边拟合求交，不用 `screens.json`），贴入 L5 + UI 画布；遮挡（陈师傅的肩、发丝、举起的字条）按「比浅色底板暗」差值键控 + roto；玻璃层的站厅反光从接缝起渐入，22.5 达到 4%；随后拉逐步校正屏幕辉光（0.35）与地面冷白溢光（0.25，素材里已有）；景深按后拉逐步加深，对焦始终跟随 Gateway。

**Lighting**：段 A：白色影棚柔光。段 B：05 · Harbour Interchange，18:31 晚高峰。5600K 线性吊灯阵列，白色清水混凝土柱廊（模板木纹、蜂窝气孔），浅灰抛光水磨石反射吊灯和 LED 灯条；Gateway 的两条 LED 竖灯条是画面里最亮的竖向光；画右远处 Exit B 斜坡自动人行道入口的 2700K 暖光（平滑踏面、无梯级，与 Step-free 一致），正是屏幕里路线卡钴蓝箭头所指的方向（指向即现实）。Gateway 的浅色屏幕是陈师傅身上的主光：浅灰白底板真实地照亮她的肩、发丝和举起的字条（字条背光透亮），并在水磨石上留下一片冷白溢光和屏幕倒影；红围巾是画面里唯一的暖红。

**Start Frame**：段 A = LYRA-POINT-MASTER 在 20.0 的取景（可选 L1 = LYRA-ECU）；段 A′ 与段 B = KF-S09-SEAM-PLATE。

**End Frame**：段 B = KF-S09-CLEAN-PLATE（J09C 用带人潮的 KF-S09-PLATE）：机位在 Gateway 正前方约 12.5 m、离地约 4.7 m、俯 9°（全画幅等效 35mm），30 m 柱廊纵深，Gateway 约占画高 30%，陈师傅在它前方约 1.2 m、偏左（3/4 背影、举着字条、红围巾），画右远处 Exit B 斜坡自动人行道的暖光。Gateway 与陈师傅落在 4:5 安全列内，Exit B 暖光在 **x ≤ 1350**：它在安全列内，4:5 版不能把「指向即现实」裁掉。

**Continuity**：S08 尾帧、LYRA-POINT-9x16、LYRA-POINT-MASTER、L5、S10 的 L6 首帧是同一个 LYRA-POINT 姿态。接缝（≈ 20.6）是「屏幕宽 = 画宽」的那一帧，屏幕内容逐像素连续，没有白色外延，也没有退潮；第 675 帧（22.5，屏幕矩形闭合）叠 1 帧 3% 亮度脉冲（master 已写入）。陈师傅的字条、眼镜、红围巾、托特包与 S03–S07 一致，此时还没有条纹围巾。距离：S04–S06 她离屏幕约 0.8 m，S07 举字条时前倾到约 0.6 m，本镜她已后退半步，约 1.2 m。27.0 硬切：从最宽的海报帧切回 Gateway 屏幕近景，开始第一次 Handoff。

**Negative Prompt**：NEG-BASE + (J09B) image, text or gradient on the screen, Lyra in the scene, glowing UI, crowd, walking people, device moving or rotating, orbit, extra LED strips, curved screen, landscape screen, wheels missing or more than four, no base plate, glossy plastic body, logo on the front, escalator steps on the Exit B route; (J09C) camera movement, sharp crowd faces, people frozen, melted people, running; (L1 / L5) bezel, UI, arm movement, pose change, arm crossing the body.

**English Prompt:**
> L1 (optional) — 16:9 locked extreme close-up of the reference woman's eyes and warm smile, matching the start image exactly, soft seamless white studio light. Only tiny living details: the gaze softens slightly, the smile deepens a little, gentle breathing. No head movement, no camera movement. Avoid: bezel, screen edge, UI, head turn, pose change.
>
> L5 — 9:16 full-length shot matching the reference photo framing: the same woman in the white mock-neck knit top with the small blue X on her left chest, black belt with gold buckle, charcoal wide-leg trousers and black pointed heels. Her left hand, on the right side of the frame, is opened outward to the right at hip height, the arm about 30 to 40 degrees from her body, palm up, fingers together; her right hand rests at her waist. She holds this pose with subtle breathing for the whole shot, seamless white studio with a soft shadow to the right. Locked camera. Avoid: walking, extra gestures, arm crossing the body, text.
>
> J09B — One continuous dolly-back and crane move in a 30 m long white board-formed concrete colonnade in the evening, cool 5600K linear pendants, polished light-grey terrazzo. Start close on the LiveX Gateway V2 display unit so that its portrait screen fills about 60% of the frame width: a 2.18 m tall freestanding portrait 86-inch touchscreen in matte black powder-coated steel, thin black bezel with an inner frame line, two thin full-height white LED light bars on its front edges; its display area is an evenly glowing, featureless light grey-white panel with a faint glass reflection, casting soft cool-white light forward; the hall behind is deep out of focus and dim. As the camera pulls back, the top and bottom bezels come into frame, then the slightly wider black header beam overhanging forward with a black-glass camera module at its center (the move slows for a beat on the light bars), perforated side vents, then a wide flat black base plate on four locked casters, and the two light bars cast vertical reflections on the floor. A 72-year-old grandmother (1.58 m) in a navy coat and red knitted scarf stands perfectly still about 1.2 m in front of it on the left, seen three-quarters from behind, holding a small note up toward the camera module, lit by the screen; the Gateway display unit is clearly about 60 cm taller than her. Finally the camera rises about three metres and tilts down slightly, revealing the long colonnade; far right, the warm-lit entrance of an inclined moving walkway glows, a smooth step-free travelator with no steps. No crowd, at most a few distant blurred figures. The device never moves. Avoid: image or text on the screen, crowd, walking people, device rotation, orbit, extra LED strips, curved or landscape screen, plastic look, escalator steps on the Exit B route.
>
> J09C — Locked wide shot, identical framing to the start image: the concrete colonnade, the black Gateway display unit with its evenly glowing light grey-white screen, and the still old woman stay perfectly still; only the rush-hour crowd flows around them at natural walking speed with heavy quarter-second long-exposure motion blur, like water. Avoid: camera movement, sharp faces, people merging, running.

---

### S10 · 27.0–30.0 · Handoff → Exit B 通道的 Portal 55

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| L6 LYRA-TURN | omni_reference | 4 s | 1080p | 9:16 | true | false | 自然速度约 0.77 s → 27.0–27.767（Gateway 画布） |
| L7 LYRA-WALK | omni_reference | 4 s | 1080p | **21:9** | true（A 档） | false | 两次 Handoff 的 f1–f3 / f6–f8 |
| L8 LYRA-UP | omni_reference | 4 s | 1080p | 9:16 | true（A 档） | false | 自然速度约 1.77 s → 28.0–29.767（Portal 画布） |
| J10a（可选） | omni_reference | 4 s | 1080p | 16:9 | true（C 档） | false | 27.0–27.767 的 Gateway 屏幕近景底板 |
| J10b | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.0–2.0 → 成片 28.0–30.0 |

参数理由：上片时长决定表演内容，不压缩表演（1.4）。原方案要把「放下手臂 → 转身 → 走出左边框」（自然约 3–4 s）塞进 0.767 s，把「走入 → 停 → 转向 → 上指 → 放下 → 走出」（约 5 s）塞进 1.87 s，分别是约 4–5 倍和 2.7 倍速，Lyra 会像快进。现在：L6 只做「放下手臂 + 起步转身」（自然约 0.8 s），出框交给 L7 的 3 帧；L8 删掉入框和出框（由 L7 承担），只保留「站定 → 抬手上指 → 放下」（自然约 1.5 s）；两条都只锁首帧，让动作按自然速度发生，从素材里挑自然速度段，变速 ≤ 1.15×。L8 因此从 5 s 改为 4 s。备选：如果 L8 的上指手部不过关，按代码版删掉手势，Lyra 站定微呼吸，「↑」完全交给 UI（钴蓝箭头上弹 + 竖线向上画出）。J10a 是锁定机位的静止设备，视频模型的增益只在背景人潮，省预算时可用 KF 静帧 + 后期人潮拖影层替代。`generate_audio=false`：27.8 高跟鞋 heel click（出框）；27.87–27.93 甩镜 = 立体声呼啸（带通扫频，声像右→左）；28.0「叮」+ 入框 heel click 同帧；D 段半速有机律动从 28.0 起（底鼓 1、2&、4&，拍手 3，沙锤八分，木鱼切分，Sub 八分，刷鼓）；28.5 Lyra 动机在新地点重现；自动人行道低沉的机械嗡声渐远（没有梯级咔嗒）。

**输入媒体**

| 任务 | start_image | end_image | image_references |
|---|---|---|---|
| L6 | LYRA-POINT-9x16（与 S09 相同的指向姿态） | —（只锁首帧，动作按自然速度发生） | `lyra_white.jpg`、`lyra_white_cut.png` |
| L7 | LYRA-WALK-START：21:9 白色无缝影棚，Lyra 全身侧身，刚从画右边缘迈入（向画左走），头顶和脚的留白与定妆照一致 | — | `lyra_white.jpg`、`lyra_white_cut.png` |
| L8 | L7-F8-A：从 L7 定稿导出的第一次 Handoff 入框 f8 那一帧，放在 9:16 画布中央（她侧身向画左，正在最后一步） | — | `lyra_white.jpg`、`lyra_white_cut.png` |
| J10a | KF-S10-GW-PLATE：Gateway 屏幕近景，画面高约为屏幕高的 70%，左右边框和左侧 LED 灯条在画内，**屏幕为浅色底板**（均匀发光的浅灰白），背后是站厅冷白虚焦 | — | `gateway_front.png` |
| J10b | KF-S10-PLATE：白墙步行通道，画左墙上一台 55 寸 Portal（**屏幕为浅色底板**），它背后的蓝色墙晕占画面左 2/3，焦点在墙晕上；通道尽头右侧是上行的斜坡自动人行道（平滑踏面、无梯级）与暖光 | KF-S10-END-PLATE：同机位推近约 5%，焦点在 Portal 屏幕；深处斜坡自动人行道上一个小小的藏蓝身影，领口一点红 | `portal_55.png`、CS-CHEN-A |

**Duration**：成片 3.0 s（帧 810–900）。27.0–27.767 Gateway 屏幕近景（L6 贴屏）；27.767–28.0 第一次 Handoff 8 帧（帧 833–840）；28.0–30.0 Portal 通道（J10b + L8 贴屏，28.0–29.767）；29.767–30.0 第二次 Handoff 8 帧（帧 893–900）的出框部分。

**Camera Movement**：27.0–27.767 锁定。27.767–28.0 Handoff：f1–f3 出框（L7 步行帧在画布内 translateX 0→−760 px，push 缓动，x 向模糊 0→36 px）→ f4–f5 光斑甩镜（环境焦外光斑整体左移 1400 px 拉成横向光条，全画面 +0.3 EV 一帧）→ f6–f8 在 Portal 画布里从右边框入框（L7 紧接的步行帧，+760→0，glide，模糊 36→0），第 840 帧 = 28.0「叮」+ 箭头卡。28.0–30.0 通道内 35mm 缓推 5%（settle），蓝色墙晕先占左 2/3，28.0–28.5 焦点从墙晕拉到屏幕。

**Character Action**：Lyra：27.0 从 LYRA-POINT 放下左手，自然地向画左转身并迈出第一步（L6，约 0.77 s 自然速度）；27.767 起由 L7 的 3 帧 + 2D slide 出框。28.0 在 Portal 画布中央收住最后一步站定（L8 首帧 = L7-F8-A），转向镜头，右手（画面左侧那只，不遮左胸 X）抬起向上一指，再放下（约 1.5 s）；29.767 起再由 L7 出框。陈师傅：29.0–30.0 在画面深处，斜坡自动人行道把她平稳地送向上方的暖光，只看得到一点红围巾。

**Product Position**：Portal 55 寸壁挂在通道白色清水混凝土墙上：机身约 73 × 125 cm，屏幕约 68 × 121 cm（高宽比 1.78），屏幕中心离地约 150 cm；超薄机身，拉丝银色铝合金细边框 + 黑色内边框，顶部正中梯形银色摄像头模组（小 X 标志、镜头、指示灯），背后柔和的蓝色墙晕（Portal 光形）。位于她行进方向的左侧墙上，斜坡自动人行道在它的右后方。设备静止，机位只缓推。

**Lyra**：同一个 Lyra（白底）。Gateway 里 1:1 等身；Portal 55 里约 0.6 倍真人（画布相同，比例来自屏幕尺寸）。生成版：入框靠 L7，站定后抬手向上指（L8）。

**UI**：Portal 画布（light）：状态栏「[X] Exit B passage ｜ 18:34 ●」；卡片区（y ≥ 1160）：大号「Exit B ↑」（Geist 84/500，↑ 为钴蓝），副行「Market Hall 120 m」（Geist 29）；一条钴蓝竖线从卡片顶端向上画出 120 px（0.4 s），与她抬手同步（L8 备选去掉手势时，箭头 28.6 snap 上弹 12 px）。影片层箭头卡「→ Exit B」（StopCard 组件，无副行）与 28.0「叮」同帧。追踪：Gateway 近景以内框线逐镜平面追踪；Portal 以黑色内边框逐镜平面追踪（Mocha 或四边拟合，不用 `screens.json`），缓推与焦点变化带来的尺度与虚化都要跟随；两块浅色屏的遮挡按「比屏幕暗」差值键控。

**Lighting**：27.0 段同 S09 站厅冷白，Gateway 的浅色屏幕是画面里最亮的面。通道：白色清水混凝土墙，冷白顶光；Portal 浅色屏幕在墙面和地面上有微弱的冷白溢光；Portal 的蓝色墙晕是画面里唯一的冷色饱和光；深处斜坡自动人行道入口 2700K 暖光，陈师傅是那里唯一的暖红。

**Start Frame**：J10a = KF-S10-GW-PLATE；J10b = KF-S10-PLATE（墙晕特写，焦点在墙上）。L6 = LYRA-POINT-9x16；L8 = L7-F8-A。

**End Frame**：J10b = KF-S10-END-PLATE（焦点在 Portal，深处斜坡自动人行道上的她）。L6 / L8 不锁尾帧：L6 取到她转身迈出第一步为止，L8 取到手臂放下、重新站定为止，之后都交给 L7 出框。

**Continuity**：L6 的起始姿态 = S09 的 LYRA-POINT。两次 Handoff 的出框 / 入框帧都取自 L7 的连续步行：f1–f3 与 L6（或 L8）末帧的脚步相位对接，f6–f8 紧接其后；接点藏在 36 px 的横向运动模糊里（1.7）。方向：Lyra 始终向画左走，陈师傅始终向画面深处（上行）走。镜像检查：L6 / L7 侧身向画左时，左胸 X 在靠近镜头的一侧。29.767–30.0 第二次 Handoff：Lyra 从 Portal 左边框侧移出框 → 光斑甩镜 → 30.0 从 Market Hall Gateway 右边框入框，「叮」。

**Negative Prompt**：NEG-BASE + (J10a / J10b) image, text or gradient on the screen, Portal on a stand, thick bezel, missing trapezoid camera module, halo in a color other than soft blue, neon sign, (J10b) escalator steps on the Exit B route; (L6 / L7 / L8) moonwalking, sliding feet, floating, changing outfit, camera tracking her, background change, shadow disappearing, rushed or sped-up movement, X logo on the far side.

**English Prompt:**
> L6 — 9:16 locked, seamless white studio with a soft shadow to the right, framing identical to the reference photo. The reference woman starts in her guiding pose (left hand, on the right side of the frame, opened outward at hip height, palm up; right hand at her waist). At a natural, unhurried pace she lowers the left hand, turns toward the left of frame and takes the first step; she keeps walking left; her shadow moves with her. Avoid: camera movement, sliding feet, outfit change, sped-up motion.
>
> L7 — 21:9 wide locked shot of a seamless white studio. The reference woman, full body in profile, walks at a steady natural pace from the right edge to the left edge of the frame and out, one continuous walk, even speed, natural weight shift, heels clicking; the small blue X on her left chest faces the camera; framing leaves the same head and foot margins as the reference photo. Avoid: camera pan, speed changes, turning to camera, sliding feet, mirrored outfit.
>
> L8 — 9:16 locked white studio, starting mid-step exactly as in the start image. The reference woman finishes her last step and settles in the center, turns to face the camera, raises her right arm (on the left side of the frame) and points straight up with a light smile, then lowers it and stands still. Natural pace, soft light, soft shadow to the right. Avoid: walking in or out, camera movement, extra gestures, outfit change, sped-up motion.
>
> J10a — Locked close shot of the upper screen of the LiveX Gateway V2 display unit in a cool-lit concrete metro hall: thin matte black bezel with an inner frame line, one full-height white LED light bar on the left edge; the display area is an evenly glowing, featureless light grey-white panel with a faint reflection of ceiling lights; commuters pass as motion-blurred shapes far behind. Avoid: image or text on the screen, device movement.
>
> J10b — 35mm slow push-in along a white board-formed concrete pedestrian passage. On the left wall hangs a LiveX Portal 55-inch ultra-slim wall-mounted portrait touchscreen (body about 73 × 125 cm), brushed-silver thin aluminum bezel with a black inner border, a small trapezoid silver camera module centered on top, screen center at eye level; its screen is an evenly glowing, featureless light grey-white panel, and a soft blue ambient halo glows on the wall behind it. The shot opens focused on the blue halo filling the left two thirds, then focus racks onto the screen. Deep in the right background an inclined moving walkway, a smooth step-free travelator with no steps, rises gently into warm light, carrying a tiny figure in a navy coat with a red scarf. Avoid: image or text on the screen, Portal on a stand, harsh neon, readable signs, escalator steps on the Exit B route.

---

### S11 · 30.0–33.0 · 06 · Market Hall：零售推荐，两条围巾

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| L9 LYRA-GESTURE | omni_reference | 4 s | 1080p | 9:16 | true | false | 自然速度 2.0 s → 30.0–32.0（Gateway 画布） |
| J11a | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.0–2.0 → 成片 30.0–32.0 |
| J11b | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材约 0.8–1.8 → 成片 32.0–33.0 |

参数理由：中景横移（设备 + 摊位 + 人）和围巾近景是两种景别，32.0 本来就是动作切，拆两条。L9 删掉入框走动（由 L7 的 f6–f8 承担），只保留「站定 → 掌心示意」，只锁首帧，取自然速度段；原方案把「走入 → 停 → 侧身示意」（约 3.5 s）塞进 2.0 s，约 1.75 倍速。`generate_audio=false`：30.0「叮」+ 入框 heel click；Lyra 动机重现；摊贩叫卖（听不清）、塑料袋窸窣、毛线摩擦；D 段律动继续，刷鼓渐密；卡片入场一声木质轻点。

**输入媒体**

| 任务 | start_image | end_image | image_references |
|---|---|---|---|
| L9 | L7-F8-B：从 L7 定稿导出的第二次 Handoff 入框 f8 那一帧，放在 9:16 画布中央 | —（只锁首帧；结束姿态参考 LYRA-POINT-9x16） | `lyra_white.jpg`、`lyra_white_cut.png`、LYRA-POINT-9x16 |
| J11a | KF-S11-PLATE：旧菜市场铁骨玻璃顶下的连廊，Gateway 立在陶土地砖上（**屏幕为浅色底板**），**整机在 x ≥ 30%**（机身中心约 x 33–36%，左缘不小于 x 528）；画右是挂满藏青白条围巾的木摊位 Stall 4（在 x ≤ 1392 内可辨）；陈师傅站在两者之间看向屏幕，只戴红围巾 | KF-S11-B-PLATE：机位横移约 40 cm 后，摊位占画面中右，她正从摊位女孩手里接过一条藏青白条围巾，Gateway 退到安全列左缘（x 约 528–700） | `gateway_front.png`、CS-CHEN-A、PROP-SCARF |
| J11b | KF-S11-CU：近景，她把藏青白条围巾绕上脖子，红围巾在下面 | KF-S11-CU-END：两条围巾叠好，红色从领口露出约 40%；背景虚焦里摊位女孩竖起大拇指 | CS-CHEN-A、PROP-SCARF |

**Duration**：成片 3.0 s（帧 900–990）。J11a 上片 2.0 s；J11b 上片 1.0 s；L9 上片 2.0 s（站定约 0.3 s + 掌心示意约 0.8 s + 保持）。

**Camera Movement**：J11a：40mm f/2.8，30.0–32.0 缓慢横移（cine 0.65,0,0.35,1），从 Gateway 屏幕移向摊位，约 40 cm。J11b：32.0 动作切近景，锁定，呼吸级漂移。

**Character Action**：Lyra：30.0 由 L7 入框到画布中央（f6–f8），L9 从同一步收住站定，左手（画面右侧）向画右展开成 LYRA-POINT 式的掌心示意，指向摊位，保持。陈师傅照着屏幕看向 Stall 4，走过去买下一条藏青白条 7 号围巾，把它叠在自己织的红围巾上（红色仍从领口露出）。摊位上的年轻女孩冲她竖起大拇指（无台词）。

**Product Position**：Gateway 落地立在 Stall 4 左侧的陶土地砖上，4 个脚轮锁定，黑色底板与摊位木台基平行，屏幕朝向连廊人流；2.18 m 的机身略低于木摊位的顶棚。两条白色 LED 竖灯条在地砖上拖出竖直倒影（再教一次 Gateway 光形）。设备静止。

**Lyra**：同一个 Lyra（白底），1:1 等身；生成版入框（L7）后站定，用 LYRA-POINT 的手势示意摊位。

**UI**：Gateway 画布（light）：状态栏「[X] Market Hall ｜ 18:41 ●」；商品卡（y ≥ 1160）：眉标「PICKED FOR TONIGHT」（Geist Mono 21）；标题「No. 7 · Home scarf」（Geist 50/600）；藏青白条针织围巾产品图（代码绘制，藏青 #1c2a4a / 白竖条）；「Last 3」（数字 Geist 84/500，由 4 split-flap 翻到 3）；行动行「Stall 4 →」（钴蓝箭头）。卡片行错峰 0.14，0.7 s glide。影片层站牌字卡「06 · Market Hall / Route 7 · 18:41」与 30.0「叮」同帧。追踪：Gateway 内框线逐镜平面追踪（横移中的透视变化要跟上，不用 `screens.json`）；遮挡按「比屏幕暗」差值键控。4:5 版：Gateway 屏幕与 Stall 4 都要在画框内，横移中用 Δ 跟随（≤ ±200 px）。

**Lighting**：1890 年代铁骨玻璃顶旧菜市场：铸铁柱、陶土地砖、木摊位、钨丝灯（#ffcf9a 暖焦外光斑）；玻璃顶外是黄昏转蓝调的天空（#2a3550→#101522），远处体育场屋盖一排冷白点光。Gateway 的 LED 竖灯条是暖色环境里的冷白竖光；它的浅色屏幕在陈师傅左侧勾出一道冷边，并在陶土地砖上留下一片冷白溢光。

**Start Frame**：J11a = KF-S11-PLATE（Gateway 整机在 x ≥ 30%）；J11b = KF-S11-CU；L9 = L7-F8-B。

**End Frame**：J11a = KF-S11-B-PLATE；J11b = KF-S11-CU-END；L9 不锁尾帧（取到掌心示意到位后保持）。

**Continuity**：30.0–32.0 她只戴红围巾；从 32.0（J11b）起一直戴两条围巾：藏青白条在外，红色从领口露出约 40%，红色仍是画面里唯一的暖红。围巾无队徽、无文字。33.0 动作剪辑：一个背包球迷从画右闯进她的去路。

**Negative Prompt**：NEG-BASE + image, text or gradient on the Gateway screen, club crest, printed logos on scarves, price tags with text, cobalt-blue scarves, supermarket shelves, generic self-service kiosk, red scarf disappearing, two scarves before the purchase; (L9) walking in, arm crossing the body, sped-up motion.

**English Prompt:**
> L9 — 9:16 locked white studio, reference framing, starting mid-step exactly as in the start image. The reference woman settles in the center and, at a natural pace, opens her left hand (on the right side of the frame) outward to the right at hip height, palm up, fingers together, friendly and helpful, showing the way to something on the right; her right hand rests at her waist; then she holds. Avoid: walking in or out, camera movement, outfit change, extra gestures, sped-up motion.
>
> J11a — 40mm slow lateral dolly inside a restored 1890s cast-iron and glass-roofed market hall at dusk, warm tungsten stall lights, terracotta floor tiles. Left of center stands the LiveX Gateway V2 display unit, fully in frame about a third of the way across: a 2.18 m tall matte black freestanding portrait touchscreen, black header beam with a black-glass camera, thin black bezel with an inner frame line, two full-height white LED light bars reflecting on the tiles, wide black base plate on four locked casters; its screen is an evenly glowing, featureless light grey-white panel that casts cool light on the grandmother. On the right, a wooden stall hung with navy-and-white striped knitted scarves. The 72-year-old grandmother (silver bob, tortoiseshell glasses, navy coat, only her red knitted scarf) looks at the Gateway's screen, steps to the stall and takes a striped scarf from a young vendor. Avoid: image or text on the screen, crests or text on scarves, price tags.
>
> J11b — Close-up, locked: the grandmother wraps a navy-and-white striped knitted scarf around her neck over her chunky red scarf, leaving the red visible at the collar; in the soft background a young stall vendor gives her a thumbs-up. Warm tungsten bokeh. Avoid: logos, text, red scarf removed.

---

### S12 · 33.0–37.5 · 她给迷路的球迷指路

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| J12a | omni_reference | 4 s | 1080p | 16:9 | true（A 档，5 个草稿） | false | 素材约 0.6–2.1 → 成片 33.0–34.5 |
| J12b | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.0–3.0 → 成片 34.5–37.5 |

参数理由：J12a 里「闯入、提问、零延迟指路、跑开」挤在 1.5 秒里，自然速度生成后从球迷入画的后半段开始取，不加速人物动作。`generate_audio=false`：球迷的「Gate C?」带铁与玻璃连廊混响（约 1.8 s）；她的回答干脆无停顿，台词跨过 34.5 的剪辑点延续到近景；刷鼓加密到十六分；36.5 一声轻笑；37.5 年长女声无词哼唱的前四个音首次出现（E–G–B–A，未完成）。口型可选 `audio_references`。

**输入媒体**

| 任务 | start_image | end_image | image_references | audio_references（可选） |
|---|---|---|---|---|
| J12a | KF-S12-START：连廊中段人流里的一小块空地，中景，她在画中偏左，左手攥着字条；一个背双肩包、低头看手机的年轻外国球迷正从画右边缘闯入 | KF-S12：她的右臂已抬起，指向画左深处（钟楼方向），左手仍攥着字条；球迷转身，正要向画左跑出 | CS-CHEN-A、PROP-SCARF | 她的台词「Past the clock tower. Follow the scarves.」 |
| J12b | KF-S12-CU：陈师傅近景（85mm），右臂刚放下，左手攥着字条在画面下缘，视线还追着球迷离开的方向（画左） | KF-S12-CU-END：她愣了一下之后，低头短笑，眼角有笑纹 | CS-CHEN-A | 同上（只覆盖句尾） |

**Duration**：成片 4.5 s（帧 990–1125）。J12a 1.5 s；J12b 3.0 s。

**Camera Movement**：J12a：50mm f/2，手持跟随球迷闯入（轻微晃动，glide 式跟随）。J12b：85mm 近景锁定，36.5–37.5 极慢推 3%（后期）。背景深处保留 Gateway 两道白色竖光的焦外。

**Character Action**：一个背双肩包、盯着手机地图的年轻外国球迷拦住她：「Gate C?」她不假思索，6 帧内抬起**右手**指向画左深处（**左手攥着字条**）：「Past the clock tower. Follow the scarves.」球迷顺着她的手跑开了。她自己愣了一下，笑了——31 年的反射还在，她又成了回答问题的人。

**Product Position**：无设备入画。Market Hall 的 Gateway 在她身后约 15 m，只以两道白色竖光与地面倒影出现在焦外，继续教光形。

**Lyra**：不入画。

**UI**：无 LiveX UI。球迷手里的手机只是一块冷白小光，**不出地图细节**。影片层字幕（都是人说的话，Instrument Serif Italic 46 px，y 940，逐词出现）：「Gate C?」（读完 0.3 s 即退）｜「Past the clock tower. Follow the scarves.」

**Lighting**：连廊钨丝暖光，铸铁肋线在玻璃顶下的剪影；摊位暖光做人物轮廓光；深处 Gateway 的 5600K 竖向光条与倒影。36.5 她笑时，轮廓光由冷转暖约 10%（后期）。

**Start Frame**：J12a = KF-S12-START；J12b = KF-S12-CU。

**End Frame**：J12a = KF-S12；J12b = KF-S12-CU-END。

**Continuity**：两条围巾（藏青白条在外、红色露出约 40%）；右手指路，**左手攥着字条**（S12–S14 字条一直在左手，S14 贴砖用右手；不要放进托特包或口袋，也不要凭空消失）。指路方向 = 画左深处 = 钟楼方向，和 S14 的地理一致。人流中约 30% 的人带藏青白条围巾。37.5 切到她的背影跟拍（人流方向连续）。

**Negative Prompt**：NEG-BASE + readable phone map, real club merchandise, cobalt-blue fan gear, the fan's face in sharp focus for long, exaggerated laughter, pointing with the wrong direction, Lyra or screens in frame.

**English Prompt:**
> J12a — 50mm handheld medium shot in a busy iron-and-glass market concourse with warm tungsten light. A young foreign football fan with a backpack, staring at the cold glow of his phone, bursts in from the right and asks the 72-year-old grandmother (silver bob, tortoiseshell glasses, navy coat, navy-and-white striped scarf over a red knitted scarf) something. Without a moment's hesitation she raises her right arm and points decisively toward the far left background, speaking briefly, while her left hand keeps holding a small folded off-white note; he turns and runs off that way. Far behind, two soft vertical white light bars glow out of focus. Avoid: readable phone screen, club logos, sharp faces in the crowd.
>
> J12b — 85mm close-up, locked, warm tungsten bokeh with two distant soft vertical white lights. The grandmother finishes a short sentence, lowers her right arm, a small folded note still in her left hand, looks after the running fan, pauses, then lets out a small surprised laugh at herself, eyes crinkling. Avoid: big open-mouthed laugh, tears, looking into the lens.

---

### S13 · 37.5–42.0 · 步子跟上人潮，门开，风雨与齐唱涌入

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | extension_mode | 上片 |
|---|---|---|---|---|---|---|---|---|
| J13a | omni_reference | 4 s | 1080p | 16:9 | true | false | — | 素材 **1.0–4.0** → 成片 37.5–40.5（1:1；出点 = 末帧） |
| J13b | omni_reference（首帧 = J13a 定稿末帧，尾帧 = KF-S13-END） | 4 s | 1080p | 16:9 | true | false | — | 素材约 0.0–0.9 → 40.5–41.4（她在画内，≤ 1.15×）；之后 → 41.4–42.0（她已出画，≤ 1.8×）+ 后期推进与 bloom |

参数理由：跟拍和推向门是同一条连续运动。J13a 取 1.0–4.0，让出点正好是它的末帧，J13b 以这一帧为首帧往后接，40.5 处运动连续、没有跳帧（原方案用 forward extension 从 J13a 的 4.0 往后续，成片却只用了 J13a 的 0.0–3.0，中间 1 s 被跳过）。J13b 不用 video_extension，因为 extension 没有 end_image，无法保证 42.0 的门缝光落在 x 1040 / y 400、与 S14 的 Paragon 上灯箱同位；改用 omni_reference 首尾帧锁定。最后 0.6 s 画面里只剩门缝光，缺的尺度和位置由后期 2D 推进（scale ≤ 1.8，锚点让门缝光中心落在 (1040, 400)）加 bloom 补齐，这就是代码版的做法。`generate_audio=false`：脚步渐与律动对齐；39.0 屋顶泛光亮起时一声远处低频 Boom；41.0 门开，400 Hz 低通在 6 帧内（41.0–41.2）打开到全频，风、雨、齐唱涌入；41.5–42.0 能量上冲进 E 段。

**输入媒体**

| 任务 | start_image | end_image | image_references / video |
|---|---|---|---|
| J13a | KF-S13-START：斯坦尼康在她身后 2 m，中全景背影：藏蓝大衣、两条围巾、银灰短发，左手攥着字条，走在人流里；连廊纵深、铸铁柱、摊位暖光；玻璃顶外体育场钢屋盖还是暗的 | — | CS-CHEN-A（背面）、PROP-SCARF |
| J13b | J13a 定稿的最后一帧（导出静帧） | KF-S13-END：门已向两侧滑开，门缝里冷白发光的竖向缝隙中心在 **x 1040 / y 400**（4:5 安全列内），她已从画左出画，门外是蓝调细雨 | CS-CHEN-A（背面）、PROP-SCARF |

**Duration**：成片 4.5 s（帧 1125–1260）。J13a 3.0 s（素材 1.0–4.0）；J13b 1.5 s（素材约 0.0–0.9 按 1:1 到 41.4，其余按 ≤ 1.8× 压到 42.0，最后 0.6 s 叠后期推进）。

**Camera Movement**：35mm 斯坦尼康，在她身后 2 m 与人流同速跟拍，约 1.4 m/s（37.5–40.5），步频与四分音符同步（后期微调速度 0.95–1.05 对齐节拍，只移动入点，出点始终是 J13a 的末帧）；40.5 起略快于她，越肩推向门；41.0–42.0 门缝光占满画面中心（push 缓动 0.7,0,0.84,0 加速进入剪辑点）。

**Character Action**：连廊里的条纹围巾越来越多，她的步子第一次跟上了人潮。39.0 玻璃顶外，体育场钢结构屋顶一圈圈亮起。41.0 尽头的自动玻璃门向两侧滑开：风、雨丝和球迷的齐唱一起涌进来，她的围巾被风掀起一角。

**Product Position**：无设备入画。

**Lyra**：无。

**UI**：无。雨丝以后期粒子为主（门缝涌入 300→900 颗），生成里只要一点细雨和风即可。

**Lighting**：连廊两侧摊位钨丝暖光（#ffcf9a），柱与光斑真实视差；39.0 起玻璃顶外体育场屋盖弧形排列的冷白点光逐点亮起；41.0 门缝中心是冷白的广场光 + bloom，外面是蓝调细雨。

**Start Frame**：J13a = KF-S13-START。

**End Frame**：J13b = KF-S13-END：一个冷白发光的竖向缝隙，中心约在 **x 1040 / y 400**（= S14 首帧 Paragon 上灯箱的位置，4:5 安全列内）。42.0 前最后一帧以后期推进后的位置为准，误差 ≤ 4 px。

**Continuity**：42.0 光的匹配剪辑：门缝里的光 → 广场上 Paragon 上灯箱（同位置、同亮度），「叮」同帧。人流中带藏青白条色块的比例从 30% 增到 70%。她始终在画面中偏左。

**Negative Prompt**：NEG-BASE + heavy rain indoors, running, camera shake, faces turning to camera, club banners with text, fireworks.

**English Prompt:**
> J13a — 35mm steadicam following two metres behind the 72-year-old grandmother (navy wool coat, navy-and-white striped scarf over a red knitted scarf, silver bob) as she walks, a small folded note in her left hand, with a growing crowd of fans in navy-and-white striped scarves down a long cast-iron and glass market concourse, warm tungsten stall lights passing with parallax. Her steps fall into the crowd's rhythm. Beyond the glass roof, the steel roof of a stadium lights up ring by ring in cool white. Avoid: faces turning to camera, text on banners, camera shake.
>
> J13b — Continuing exactly from the start image: the camera slightly overtakes the grandmother and pushes over her shoulder toward the glass doors at the end of the concourse; within about half a second the automatic doors slide open, wind and fine rain blow in, her scarf lifts, she drifts out of frame to the left, and the bright cold-white gap of the open doors settles centred slightly right of and above the middle of the frame as the camera accelerates into it. Avoid: heavy indoor rain, fireworks, text, sudden cuts.

---

### S14 · 42.0–47.0 · 07 · Harbour Depot：钟楼、Paragon、背面的 X

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| L10 LYRA-B-TALK | omni_reference | **5 s** | 1080p | 9:16（黑底） | true | false | **42.0–46.35** Paragon 画布（42.0–45.0 待机 / listening，45.0–46.0 说话，46.0 起 SIGNAGE 待机；46.25–46.35 砖角擦除时正面仍在画内） |
| J14a | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材 0.0–1.0 → 成片 42.0–43.0 |
| J14b | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材约 0.3–2.3 → 成片 43.0–45.0 |
| J14c | omni_reference | 4 s | 1080p | 16:9 | true | false | 素材约 0.5–1.5 → 成片 45.0–46.0 |
| J14d1 | omni_reference | 4 s | 1080p | 16:9 | true（A 档） | false | 素材末段 → 成片 46.0–46.35 |
| J14d2 | omni_reference | 4 s | 1080p | 16:9 | true（A 档） | false | 素材前段 → 成片 46.35–47.0 |

参数理由：L10 从 4 s 加到 5 s：Paragon 正面要一直贴到 46.35（46.0–46.35 横移擦除时正面仍在画内，46.25–46.35 砖角遮满画面才换成背面），画布只算到 46.0 会在这几帧留下黑屏；4.35 s 加出入点各约 0.3 s 余量。全景、手掌贴砖、Paragon 中景、绕到背面是四个景别；「绕到背面」不做绕机运镜，而是 J14d1（正面一侧横移，砖角扫过遮满画面）+ J14d2（背面一侧，砖角移开露出背面），在 46.25–46.35 砖角遮满画面的 3 帧里切换（隐形剪辑）。`generate_audio=false`：42.0「叮」+ E 段全速起步，但对白期间只留底鼓和球迷整齐的拍手（2、4 拍，实录 120 BPM，城市自己在演奏）；雨打不锈钢顶棚的高频「嗒嗒」对比砖砌钟楼的低沉共鸣；43.0 手掌贴砖一记 90 Hz 闷响；43.2–44.8 她的台词（广场混响 1.2 s）；45.0 Lyra 动机重现 + 台词（干声）；46.0 起 Bass 十六分与十六分踩镲进入；46.5 卷帘倒卷的机械「rrrrt」（即 00.0 那一声的倒放）。

**输入媒体**

| 任务 | start_image | end_image | image_references | audio_references（可选） |
|---|---|---|---|---|
| L10 | `lyra_black.jpg`（全身，纯黑背景） | — | `lyra_black.jpg`、`lyra_black_cut.png` | Lyra 干声「Then you know the way.」 |
| J14a | KF-S14-WIDE-PLATE（= 03「S14 变体 A」的底板版）：28mm 低位全景，蓝调细雨，1978 年红砖钟楼与 Paragon Outdoor 并立（深色模式，屏幕纯黑），湿花岗岩上两道长倒影，条纹围巾的人潮穿过；**Paragon 上灯箱中心约在 x 1040 / y 400**；钟楼与 Paragon 同在 4:5 画框内（Δ 可取 −120） | — | `paragon_front.png`、CS-CHEN-B | — |
| J14b | KF-S14-B-START-PLATE：50mm 中近景，她在画左（脸与手 x ≥ 528），红砖墙在画中，Paragon 屏幕（纯黑）在画右、**屏幕中心 x ≤ 1267（66%）**；她的右手正抬向砖墙，左手攥着字条 | KF-S14-PLATE（= 03 S14 主帧 43.8 的底板版）：右手掌贴在砖上、金戒可见，左手仍攥着字条，她侧头看向 Paragon 的屏幕 | CS-CHEN-B、`paragon_front.png` | 她的台词「I drove this route for thirty years.」 |
| J14c | KF-S14-C-PLATE：Paragon 中景，上下灯箱都在画内，屏幕纯黑，屏幕中心 x ≤ 1267；她在画左边缘 | KF-S14-C-END-PLATE：她已挺直背向画右出画，Paragon 独立于雨中 | `paragon_front.png`、CS-CHEN-B | — |
| J14d1 | KF-S14-C-END-PLATE（正面一侧） | KF-S14-D1-END：钟楼砖角遮满画面（深色红砖 + 钠灯侧光） | `paragon_front.png` | — |
| J14d2 | KF-S14-D1-END（同一面砖角遮满画面） | KF-S14-BACK（由 03「S14 变体 B」派生）：Paragon 背面，黑色点阵面板，上下灯箱亮着，**中央标志区为未点亮的黑色点阵**，4:5 安全列内居中 | `paragon_back.png` | — |

**Duration**：成片 5.0 s（帧 1260–1410）：42.0–43.0 全景；43.0–45.0 手掌贴砖；45.0–46.0 Paragon 中景；46.0–47.0 横移擦除到背面（46.25–46.35 砖角遮满画面的 3 帧里切换）。

**Camera Movement**：42.0 28mm 低位全景，锁定，轻微漂移。43.0 切 50mm 中近景，锁定。45.0 切 Paragon 中景，锁定。46.0 她出画，摄影机左→右横移 1.8 m 掠过钟楼砖角（cine，1.0 s），砖角（离镜头约 2 m）从画右扫到画左，借前景遮挡做隐形剪辑，擦除后机位已在 Paragon 背面。设备始终静止。

**Character Action**：42.0 她走进广场，走向钟楼，左手攥着字条。43.0 她把**右手**手掌贴上红砖（settle 0.4 s），说「I drove this route for thirty years.」；侧头看 Paragon。45.0 Paragon 里的 Lyra（黑底）答「Then you know the way.」，轻轻点头。她挺直背，46.0 汇入右侧的条纹人潮出画。

**Product Position**：Paragon Outdoor 落地固定在钟楼东侧 2 m 的花岗岩铺地上（无脚轮），高 2.46 m，比她高近 90 cm，与钟楼底层拱门同高。缎面拉丝不锈钢图腾柱体（satin，非镜面）；平直的薄银雨棚由两根短的深色立柱托起，雨水沿檐口滴成一线；正面整块黑色玻璃；屏幕上下各一个白色点阵打孔灯箱，银色边框 + 明亮的白色 LED 边缘光，在湿花岗岩上拉出两道长白矩形倒影（Paragon 光形）；屏幕上下各两条深色圆角扬声器格栅；屏幕正上方居中摄像头；侧板竖向打孔散热。背面：黑色点阵面板，中央发光 X + LIVEX.AI（后期用 `paragon_back.png` 真实像素贴合），同样有上下灯箱。机身 97 × 246 cm，屏幕约 81 × 143 cm（高宽比 1.77），Lyra 约 0.75 倍真人。上下两个白色点阵灯箱是产品本身的结构，不是广告灯箱。

**Lyra**：同一个 Lyra，纯黑背景夜间模式，约 0.75 倍真人；3200 nits 在雨夜里清楚。生成版说话时轻轻点头。

**UI**：Paragon 画布（dark）：状态栏「[X] Harbour Depot ｜ 18:52 ●」；深色卡片 rgba(18,22,30,.62)（y ≥ 1160）：眉标「TONIGHT」；标题「Harbour FC Women」；「Kick-off 19:30」（数字 Geist 84/500）；行动行「Gate C → 120 m · short queue」（→ 钴蓝）。说话时字幕区 y 1030–1150 出 Geist 字幕，语音线 y 1790 起伏。影片层：42.0 站牌字卡「07 · Harbour Depot / Route 7 · 18:52」；字幕「I drove this route for thirty years.」（Instrument Serif Italic）/「Then you know the way.」（Geist + 钴蓝语音线）；背面 LIVEX.AI；46.5 字卡数字 split-flap 倒翻 07→06→05→04→03→02→01（每片 40 ms），站名逐字同步翻到 St. Mary's。追踪：Paragon 以黑玻璃屏区边缘逐镜平面追踪（Mocha 或四边拟合，不用 `screens.json`），遮挡按「比屏幕亮」差值键控 + roto；L10 画布贴到 46.35，46.25–46.35 砖角遮满画面的 3 帧里换成背面；背面以点阵面板四角追踪，贴 `paragon_back.png` 的 X 与字标（bloom 0.5）。雨丝（约 900 颗粒子）和檐口滴水（每 0.12 s 一滴，落地 3 帧溅环）后期叠加。

**Lighting**：18:52 蓝调细雨。钠灯 #ffb468 从侧面照亮红砖钟楼，钟面暖光（指针 6:52，后期校正）；湿花岗岩高反射，Paragon 的上下灯箱在地上拉出两道长白倒影；3200 nits 的屏幕在雨夜里清楚。她身上是蓝调环境光 + 钠灯侧光，红围巾仍是唯一暖红。

**Start Frame**：J14a = KF-S14-WIDE-PLATE（上灯箱与 S13 门缝光同位同亮）；J14b = KF-S14-B-START-PLATE；J14c = KF-S14-C-PLATE；J14d1 = KF-S14-C-END-PLATE；J14d2 = KF-S14-D1-END。

**End Frame**：J14b = KF-S14-PLATE；J14c = KF-S14-C-END-PLATE；J14d1 = KF-S14-D1-END；J14d2 = KF-S14-BACK（Paragon 背面，4:5 安全列内居中）。4:5 检查：43.0 手掌、红砖、Paragon 屏幕三者同在画框内（Paragon 屏幕中心 ≤ x 1267）。

**Continuity**：S13 → S14 光的匹配（门缝光 → 上灯箱）。钟楼在 S12 她指路的方向。她戴两条围巾，字条一直在**左手**（贴砖用右手，戒指在右手无名指，可见）。Lyra 的黑底版与 S15-01 / 02 同一张定妆照。47.0「叮」硬切：字卡已翻到 01，进入上游四站蒙太奇。

**Negative Prompt**：NEG-BASE + mirror chrome, plastic body, Paragon on wheels, missing canopy posts, canopy as a curved roof, lightboxes as solid panels without dot pattern, lightbox with printed advertising graphics, readable clock numerals, glowing logo generated by the model, heavy downpour, umbrella covering her face, camera orbiting the Paragon; (J14d2) front screen visible, Lyra, wheels, mirror chrome.

**English Prompt:**
> L10 — 9:16 locked, pure black background, framing identical to the black reference photo: the same woman in the white mock-neck knit top and charcoal wide-leg trousers stands still and listens with subtle breathing for about three seconds, then says one short sentence warmly with a small nod, then returns to a calm standing pose with hands lightly clasped at the waist. Avoid: camera movement, background light, outfit change.
>
> J14a — 28mm low wide shot, blue hour, fine rain, wet granite plaza in front of a stadium. A 1978 red-brick clock tower with a warm-lit clock face stands beside the LiveX Paragon outdoor display pillar: 2.46 m tall, satin brushed stainless-steel body (not mirror), thin flat silver rain canopy on two short dark posts, full black glass front; the two white perforated dot-matrix light boxes above and below the screen, framed in silver with bright white LED edge glow, are part of the product itself; small dark speaker grilles, a small camera above the screen, floor-fixed with no wheels; its 65-inch portrait screen is pure solid black glass. The two light boxes cast long white reflections on the wet stone. Fans in navy-and-white striped scarves stream across; the grandmother in a navy coat with a red scarf walks toward the tower. Avoid: image on the screen, mirror chrome, wheels, readable clock numerals, heavy rain.
>
> J14b — 50mm medium close-up, locked, blue hour drizzle, sodium side light on red brick. The grandmother (silver bob, tortoiseshell glasses, navy coat, striped scarf over red knitted scarf), a small folded note in her left hand, places her right palm flat on the old brick wall, a thin gold ring on her right ring finger, and says one quiet sentence, then turns her head toward the dark screen of the steel Paragon display pillar on the right. Avoid: crying, text, image on the screen.
>
> J14c — Medium shot, locked: the brushed-steel Paragon outdoor display pillar fills the frame with both glowing white dot-matrix light boxes of the product visible, screen pure black glass, rain dripping in a line from the canopy edge; the grandmother at the left edge, note in her left hand, straightens her back and walks out to the right into the crowd. Avoid: image on the screen, mirror chrome.
>
> J14d1 — The camera trucks smoothly left to right past the Paragon in the rain; the dark red-brick corner of the clock tower, very close to the lens, sweeps in from the right until it fills the entire frame. Avoid: camera orbit, device moving.
>
> J14d2 — Starting fully blocked by the dark brick corner, the camera continues trucking to the right as the brick slides away to the left, revealing the back of the steel Paragon display pillar: a black dot-matrix panel with its central area dark and unlit, the upper and lower white light boxes glowing, rain in the sodium light. Avoid: any logo or text on the panel, front screen visible, Lyra, wheels, mirror chrome, device rotation.

---

### S15 · 47.0–52.0 · 上游四站 Center-Lock + → Gate C

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| L11 LYRA-B-HUSH | omni_reference | 4 s | 1080p | 9:16（黑底） | true | false | 01 格 |
| L12 LYRA-B-IDLE | omni_reference | 4 s | 1080p | 9:16（黑底） | true（C 档） | false | 02 格 |
| L13 LYRA-W-IDLE | omni_reference | 4 s | 1080p | 9:16（白底） | true（C 档） | false | 03 / 04 / Gate C 格（错开取段） |
| J15-01 | omni_reference | 4 s | 1080p | 16:9 | true | false | 1.0 s → 47.0–48.0 |
| J15-02 | omni_reference | 4 s | 1080p | 16:9 | true | false | 1.0 s → 48.0–49.0 |
| J15-03 | omni_reference | 4 s | 1080p | 16:9 | true | false | 1.0 s → 49.0–50.0 |
| J15-04 | omni_reference | 4 s | 1080p | 16:9 | true | false | 1.0 s → 50.0–51.0 |
| J15-GC | omni_reference | 4 s | 1080p | 16:9 | true | false | 0.5 s → 51.0–51.5 |
| J15-TN | omni_reference | 4 s | 1080p | 16:9 | true（C 档） | false | 0.5 s → 51.5–52.0 |

参数理由：每格都是独立地点，各自首帧 I2V；每格上片只有 1.0 s（Gate C 与隧道各 0.5 s），从素材里挑动作最好的一秒。Center-Lock 靠首帧构图 + 后期对 Lyra 双眼做稳定：五格首帧里设备屏幕都放在同一个框里（1.6 第 7 条：约 321×571 px，水平居中，上沿约 y 322，下沿约 y 893，正对镜头）。`generate_audio=false`：E 段推进（底鼓更密、十六分踩镲、拍手 2/4、Bass 十六分、滤波逐小节打开）；47.0 / 48.0 / 49.0 / 50.0 / 51.0 各一声「叮」+ 4 帧真实环境声（轮椅轮子、校园欢呼、行李车滚轮、写字楼闸机翼门气动声）+ 一声短玻璃音；01 格音乐瞬间压低 6 dB 0.5 s（安静的一拍）；49.75 噪声上升音；51.5 闸机「咔嗒」；51.75 一拍静默；52.0 接球场轰鸣。

**输入媒体**

| 任务 | start_image | image_references |
|---|---|---|
| L11 / L12 | `lyra_black.jpg` | `lyra_black.jpg`、`lyra_black_cut.png` |
| L13 | `lyra_white.jpg` | `lyra_white.jpg`、`lyra_white_cut.png` |
| J15-01 | KF-S15-01-PLATE（03「S15 B ①」，01 · St. Mary's）：病房走廊，木饰面墙上的 55 寸 Portal（夜间深色模式，屏幕纯黑）位于 Center-Lock 框，蓝色墙晕是暖黄夜灯里唯一的冷色；护士推着围条纹围巾的轮椅老人从画右进入；走廊尽头休息厅里两道白色竖光在焦外 | `portal_55.png`、`gateway_front.png` |
| J15-02 | KF-S15-02-PLATE（03「S15 B ②」，02 · Western Univ）：Quad 草坪边石材步道上的 Paragon（深色模式，屏幕纯黑）位于 Center-Lock 框，雨棚与上下灯箱清晰，背后校舍 2700K 窗灯 | `paragon_front.png` |
| J15-03 | KF-S15-03-PLATE（03「S15 B ③」，03 · Harbour Hotel）：胡桃木与黄铜大堂，接待台一侧的 Gateway（浅色模式，屏幕为浅灰白底板）位于 Center-Lock 框，LED 竖灯条在抛光石材地面拖出倒影；一家三口在前景侧边 | `gateway_front.png` |
| J15-04 | KF-S15-04-PLATE（03「S15 B ④」，04 · Pier Tower）：胡桃木墙板电梯厅，43 寸 Portal（浅色模式，屏幕为浅灰白底板）位于 Center-Lock 框；玻璃门外 Paragon 的两块白矩形在焦外；加班的女人在画左 | `portal_43.png`、`paragon_front.png` |
| J15-GC | KF-S15-05-PLATE（03「S15 B ⑤」，→ Gate C）：清水混凝土墙上的 32 寸 Portal（浅色模式，屏幕为浅灰白底板）位于 Center-Lock 框；三辊闸紧贴墙面（离墙 ≤ 0.5 m）排在 Portal 右侧，按 Center-Lock 的取景，墙面在画内只有离地约 0.95–2.2 m，所以**画面下缘只露出闸机顶部与白色状态灯**；陈师傅离镜头约 2 m，从画右走向闸机，在 Portal 右侧（x ≥ 1150）以胸像以上入画，不遮挡屏幕；闸机另一侧的球场内廊在焦外深处：一个挂满与 Stall 4 同款藏青白条围巾的球迷商店摊位（暖色灯泡），旁边两道白色竖光（Gateway 光形），落在 4:5 安全列内，她入画时不把它完全挡住 | `portal_32.png`、CS-CHEN-B、`gateway_front.png` |
| J15-TN | KF-S15-TN：看台隧道，尽头是泛光灯下展开的碗形看台（逆光，人群为剪影） | — |

**Duration**：成片 5.0 s（帧 1410–1560），剪辑点全部在整秒：47.0 / 48.0 / 49.0 / 50.0 / 51.0；51.5 闸机咔嗒切隧道。

**Camera Movement**：每格锁定 + 3% 推进（settle，后期做，保证 Lyra 双眼不动）；焦距按设备大小换算，使五台屏幕里 Lyra 双眼都注册在影片坐标 (960, 405)、双眼间距恒为 20 px。51.5–52.0 穿过隧道向泛光推进（push），这一段由 J15-TN 生成真实的前推。

**Character Action**：01：护士推着围条纹围巾的轮椅老人去休息厅看比赛（Lyra 食指轻放唇前）。02：学生披着条纹旗从 Paragon 前跑过。03：一家三口在大堂换上球衣。04：加班的女人把西装外套换成球衣。Gate C：陈师傅从画右入画，在 Portal 右侧（x ≥ 1150）推闸通过，左手攥着字条，51.5 闸杆转动（画面下缘只露闸机顶部与白色状态灯）。所有人都为同一场比赛出发。

**Product Position**：01 Portal 55 寸（机身约 73 × 125 cm，屏幕约 68 × 121 cm）壁挂在病房走廊木饰面墙上，屏幕中心约 150 cm；02 Paragon 落地固定在 Quad 草坪边石材步道上，无脚轮；03 Gateway 落地立在接待台一侧的石材地面，脚轮锁定；04 Portal 43 寸（机身约 57 × 99 cm，屏幕约 53 × 95 cm）壁挂在胡桃木墙板上，屏幕中心约 150 cm；Gate C Portal 32 寸（机身约 43 × 74 cm，屏幕约 40 × 71 cm）壁挂在闸机旁清水混凝土墙上，屏幕中心约 150 cm，屏幕下缘约 1.15 m，高于约 100 cm 的三辊闸。Gate C 格的取景：屏幕 71 cm 高占 571 px，墙面在画内只有离地约 0.95–2.2 m，三辊闸紧贴墙面排在 Portal 右侧，画面下缘露出闸机顶部与白色状态灯；陈师傅离镜头约 2 m，比墙近约 0.3 m 以上，所以在画面里更大，从 Portal 右侧以胸像以上过闸。因为 Center-Lock 要求屏幕在画面里一样大，小尺寸 Portal 的机位更近，大设备机位更远，设备与环境的比例由此自然不同。Gate C 格焦外深处（51.0–51.5）：闸机后的球场内廊里有一个挂满与 Stall 4 同款藏青白条围巾的球迷商店摊位，旁边一台 Gateway，只以两道白色竖光与地面倒影出现。它立在摊位旁，是零售角色（与 S11 同一种用法），不属于负向词里要排除的「走廊里的 Gateway」。

**Lyra**：五格同一个 Lyra、同一坐标：01 黑底夜间模式（生成版食指放唇前，L11）；02 黑底（L12）；03 白底 1:1 等身（L13）；04 白底（L13，另取一段）；Gate C 白底（L13，再取一段）。后期先对每段 Lyra 素材做以双眼为基准的稳定，再贴屏。

**UI**：同一栅格、同一位置（y ≥ 1160），状态栏时间都是 18:53（同一分钟），UI 快速 reveal 0.35 s：01「Match on · Lounge 2F · Quiet volume」（dark，整屏亮度约 30%，音量滑杆 0.4 s 从 60% 滑到 20%）；02「Fan Zone · Quad · 19:30」（dark）；03「Welcome · Late checkout tonight」（light）；04「Your ride · Door B · 3 min」（light）；Gate C「Section 114 · Lift 3 · Step-free」（light，19:02）。影片层字卡 split-flap 逐格翻：01 · St. Mary's → 02 · Western Univ → 03 · Harbour Hotel → 04 · Pier Tower → 箭头卡 → Gate C（每片 40 ms）。追踪：各设备逐镜平面追踪屏幕边缘（Mocha 或四边拟合，不用 `screens.json`），五格屏幕的高宽比都应接近 1.78；遮挡键控按模式：①② 深色屏取「比屏幕亮」，③④⑤ 浅色屏取「比屏幕暗」。Center-Lock 在贴屏后校验双眼中点与间距，误差 > 2 px 时以缩放和平移微调整个贴屏层。

**Lighting**：01 病房走廊暖黄夜灯、木饰面，Portal 蓝晕是唯一冷色，屏幕只有 30% 亮度；02 蓝调草坪，校舍 2700K 窗灯，Paragon 灯箱冷白；03 胡桃木黄铜暖焦外，Gateway LED 竖灯条；04 胡桃木电梯厅暖光，玻璃门外两块白矩形焦外；Gate C 清水混凝土冷白 + 三辊闸不锈钢与白色状态灯，闸机后的内廊深处是球迷商店摊位的暖色灯泡（#ffcf9a，焦外）和旁边 Gateway 的两道 5600K 白色竖光；隧道尽头 5600K 泛光。

**Start Frame**：各格 KF（见输入表），屏幕都在 Center-Lock 框内。

**End Frame**：不锁尾帧；每格取动作最清楚的 1.0 s（Gate C 与隧道各 0.5 s）。

**Continuity**：五格同一分钟（18:53），Lyra 双眼坐标不动，地点在她周围换掉。01 与 04 格的焦外里能看到该站主节点（01 休息厅 Gateway 两道竖光、04 门外 Paragon 两块白矩形），字卡标的是站本身。陈师傅在 Gate C 格戴两条围巾。Gate C 格焦外的球迷商店摊位与 Gateway 竖光是零售在城市段的回声，靠与 Stall 4 同款的围巾和 Gateway 光形被认出，不加时间、文案和声音。52.0 硬切：隧道尽头的泛光 → 看台 12 排 7 号，Boom 同帧。

**Negative Prompt**：NEG-BASE + image, text or gradient on any screen, off-center screens, tilted devices, mirror chrome, Paragon on wheels, missing canopy posts, Portal on a stand, no wall halo, round camera module, Gateway without base plate or casters, Gateway without header beam, Paragon indoors, Gateway in a corridor, hospital signage text, patient faces in focus, real university crest, hotel brand names, elevator floor numbers, turnstile brand plates, fan-shop signs or price tags with text, stadium sponsor boards, sharp faces in the stands.

**English Prompt:**
> L11 — 9:16 locked, pure black background, black-reference framing: the reference woman gently raises her index finger to her lips, kind eyes, head steady, then holds. Avoid: camera movement, head turning.
>
> L12 / L13 — 9:16 locked, pure black (L12) / seamless white studio (L13), reference framing: the reference woman stands with hands lightly clasped at the waist, subtle breathing, calm warm expression, head perfectly steady. Avoid: gestures, head movement, camera movement.
>
> J15-01 — Hospital ward corridor at night, warm dim night lights, wood-panelled wall. A LiveX Portal 55-inch ultra-slim wall-mounted portrait touchscreen hangs centered in frame at eye level, facing the camera, brushed-silver thin bezel, black inner border, small trapezoid silver camera module on top, soft blue halo on the wall; in night mode its screen is pure solid black glass. A nurse pushes an elderly man in a wheelchair, wearing a navy-and-white striped scarf, past it toward a lounge; at the far end two soft vertical white light bars glow out of focus. Locked camera. Avoid: image on the screen, text, sharp patient faces.
>
> J15-02 — Blue-hour university quad, the LiveX Paragon outdoor display pillar (2.46 m, satin brushed stainless steel, not mirror, thin flat canopy on two short dark posts, the product's own white dot-matrix light boxes above and below the screen, floor-fixed with no wheels, screen pure solid black glass) stands centered on a stone path at the lawn's edge; students with navy-and-white striped flags run past. Warm windows behind. Locked. Avoid: image on the screen, mirror chrome, wheels, crests, text.
>
> J15-03 — Walnut and brass hotel lobby, the LiveX Gateway V2 display unit (2.18 m, matte black powder-coated steel, thin black bezel with an inner frame line, two full-height white LED bars on the front edges, perforated vertical side vents, slightly overhanging header beam with a black-glass camera, wide black base plate on four locked casters) stands centered beside the reception desk, facing the camera; its screen is an evenly glowing, featureless light grey-white panel; its light bars reflect on the polished stone; a family of three pulls on navy-and-white striped jerseys at the side. Locked. Avoid: image or text on the screen, hotel logos.
>
> J15-04 — Walnut-panelled office elevator lobby, a LiveX Portal 43-inch ultra-slim wall-mounted portrait touchscreen centered at eye level, facing the camera: brushed-silver thin aluminum bezel, black inner border, a small trapezoid silver camera module centered on top, a soft blue halo washing the wall behind it; its screen is an evenly glowing, featureless light grey-white panel. A woman working late swaps her blazer for a striped jersey; through the glass doors two white rectangular light boxes glow out of focus. Locked. Avoid: floor numbers, text, image on the screen, Portal on a stand.
>
> J15-GC — Stadium gate: a LiveX Portal 32-inch ultra-slim wall-mounted portrait touchscreen centered at eye level on a board-formed concrete wall, facing the camera: brushed-silver thin aluminum bezel, black inner border, a small trapezoid silver camera module centered on top, a soft blue halo on the wall; its screen is an evenly glowing, featureless light grey-white panel. Stainless tripod turnstiles stand close to the wall to the right of the screen; only their tops and white status lights show along the bottom edge of the frame. The grandmother in a navy coat with striped and red scarves, a small note in her left hand, walks in from the right, chest-up and larger in the foreground, and pushes through the turnstile to the right of the screen without covering it. Beyond the turnstiles, deep in the stadium's inner concourse and far out of focus, a small fan-shop stall hung with navy-and-white striped scarves glows under warm bulbs, with two soft vertical white light bars beside it. Locked. Avoid: sponsor boards, text, shop signs, image on the screen, Portal on a stand.
>
> J15-TN — Fast push through a dark stadium tunnel toward a blinding wall of floodlight; the bowl of the stands opens up at the end, crowd only as backlit silhouettes. Avoid: logos, sponsor boards, sharp faces.

---

### S16 · 52.0–54.0 · 12 排 7 号：Last stop，林拍胸口的 7

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | 上片 |
|---|---|---|---|---|---|---|---|
| J16a | omni_reference | 4 s | 1080p | 16:9 | true | false | 0.5 s → 52.0–52.5 |
| J16b | omni_reference | 4 s | 1080p | 16:9 | true | false | 0.5 s → 52.5–53.0 |
| J16c | omni_reference | 4 s | 1080p | 16:9 | true | false | 0.5 s → 53.0–53.5 |
| J16d | omni_reference | 4 s | 1080p | 16:9 | true | false | 0.5 s → 53.5–54.0 |

参数理由：四个 0.5 s 的镜头剪在拍上，每个都是独立景别和焦段，各自首帧 I2V，只取动作最准的 0.5 s。`generate_audio=false`：52.0 Boom + E 大调绽放（Emaj9）+ Sub E1 长音 + 钢琴；字卡翻牌细碎 split-flap 声；53.0 林拍胸口两记闷响（53.0 / 53.25）的同时所有乐器抽空，看台声浪推远到 −20 dB，只剩风声和年长女声哼唱的最后两个音（第一次唱完整，落在 E）；53.5 七声铃的第一声（01 · St. Mary's，B5）从城市另一头穿过静默——先闻其声。这段「抽空」是全片情绪的最高点，只能由混音做。

**输入媒体**

| 任务 | start_image | end_image | image_references |
|---|---|---|---|
| J16a | KF-S16-SIT（由 03 S16 主帧 `S16_A.png` 派生）：50mm 侧前方中近景，她正在 12 排 7 号坐下，字条在手里、还没举起，身后看台焦外是泛光灯的巨大光斑墙，细雨在光里发亮 | KF-S16-SIT-END：已坐稳，抬眼看向草坪 | CS-CHEN-B、PROP-SCARF |
| J16b | KF-S16-POV（= 03「S16 变体 A」`S16_A_varA.png`）：林的 POV，300mm 从草坪仰拍看台，空间压缩，人海是逆光的暗色人头点阵，其中一张白纸被高高举起，下面一粒红色 | — | KF-S16-POV |
| J16c | KF-S16-LIN（= 03「S16 变体 B」`S16_A_varB.png`）：200mm，林的中景，泛光逆光，看台焦外；藏青白条球衣，**胸口号码区留白** | — | CS-LIN |
| J16d | KF-S16-CU（由 03 S16 主帧派生）：85mm 陈师傅近景，字条正从头顶收回胸前 | — | CS-CHEN-B、PROP-NOTE |

**Duration**：成片 2.0 s（帧 1560–1620），四格各 0.5 s，剪辑点 52.0 / 52.5 / 53.0 / 53.5。

**Camera Movement**：52.0 50mm 侧前方，锁定。52.5 300mm 从草坪仰拍看台，锁定（长焦轻微呼吸）。53.0 200mm 林的中景，锁定。53.5 85mm 回到陈师傅，锁定；下一镜摄影机从她身边升起。

**Character Action**：52.0 她在 12 排 7 号坐下。52.5 草坪上热身的林抬头扫视看台，陈师傅把铅笔字条高高举起当标语——满场人海里一张白纸、一点红。53.0 林看见了，笑着用右手拍了两下胸口的 7。53.5 她把字条收回胸前，笑了；城市另一头响起一声铃。

**Product Position**：无设备入画。

**Lyra**：无。

**UI**：无 LiveX UI。影片层：52.0 站牌字卡主行「07 · Harbour Depot」的站名部分 split-flap 翻成「07 · Last stop」（每字 40 ms，约 360 ms，「07 ·」不动）；53.0 节点标签「No. 7 · Lin」（Geist Mono 13 px，0.18em，1 px 竖向引线）；字条内容「Seat 7 · 19:30 ♡ 林」（手写扫描贴合）。林的球衣胸口「7」后期贴片（按胸口平面追踪）。

**Lighting**：19:08，泛光灯 5600K，细雨在光里发亮。看台是逆光剪影；林是强逆光轮廓 + 看台焦外光斑；53.5 陈师傅的轮廓光由冷白转为泛光暖白。

**Start Frame**：见输入表，四格各自的 KF。

**End Frame**：只有 J16a 锁尾帧（KF-S16-SIT-END）；其余不锁尾帧。

**Continuity**：12 排 7 号、Seat 7、7 号球衣——三个「7」中的两个在这里汇合。她戴两条围巾，白纸 + 红点在最远景里也要一眼可辨。林的球衣是虚构俱乐部配色（藏青 #1c2a4a + 白竖条），避开钴蓝。54.0 连续运动：摄影机从她身边升起，接航拍，节点铃声继续。

**Negative Prompt**：NEG-BASE + real club crest, sponsor logos on jerseys or boards, printed number generated on the jersey, sharp faces in the crowd, cobalt blue kit, confetti, flares, big-screen replays.

**English Prompt:**
> J16a — 50mm medium close-up from the front side: the 72-year-old grandmother (silver bob, tortoiseshell glasses, navy coat, navy-and-white striped scarf over a red knitted scarf) sits down in a stadium seat and looks toward the pitch; behind her, a huge out-of-focus wall of white floodlights, fine rain sparkling in the light. Avoid: sharp faces, logos, text.
>
> J16b — 300mm telephoto from the pitch looking up at a packed, compressed stadium stand, backlit crowd as dark silhouettes; in the middle one small white sheet of paper is held high, with a tiny spot of red just below it. Locked. Avoid: sharp faces, sponsor boards, banners with text.
>
> J16c — 200mm medium shot of a 19-year-old female footballer warming up under floodlights, navy-and-white vertically striped jersey with a plain chest, backlit, stands blurred behind; she looks up at the stands, spots someone, smiles and pats her chest twice with her right hand. Avoid: printed numbers, crests, sponsor logos.
>
> J16d — 85mm close-up, locked: the grandmother brings the small white note back down to her chest and smiles, eyes bright, warm floodlight rim light. Avoid: tears, text on the note.

---

### S17 · 54.0–57.0 · AI City：100 m → 500 m，七站依次亮起

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | extension_mode | 上片 |
|---|---|---|---|---|---|---|---|---|
| J17a | omni_reference | 4 s | 1080p | 16:9 | true（A 档） | false | — | 约 1.0 s 素材压到 0.5 s → 54.0–54.5（取钟楼广场已入画、她仍可辨为一点红的那一段，供 54.0–54.3「一个设备」） |
| J17b | omni_reference | 4 s | 1080p | 16:9 | true | false | — | **最后 1.0 s（3.0–4.0）** → 54.5–55.5（出点 = 末帧，J17c 从这里续接） |
| J17c | video_extension（输入 = J17b 定稿） | 5 s | 1080p | 16:9 | 视面板而定 | false | forward | 续接段 0.0–4.0 压到 1.5 s → 55.5–57.0（约 2.7×，航拍 ≤ 3×）；4.0–4.4 → 57.0–57.15 压黑用 |

参数理由：从人到城市的连续上升拆成三段：离座升起越过顶棚（J17a）、100 m 悬停（J17b）、forward extension 升到 500 m（J17c），保证 100 m → 500 m 是同一条运动。航拍里人物极小，允许 2–3 倍加速。extension 从源片段的**最后一帧**往后续，所以 J17b 必须取最后 1.0 s（3.0–4.0）上片，否则 55.5 处会跳帧；extension 输出如果包含原片段，按拼接点裁切。**节点的光一律不让模型生成**：生成的城市只有真实城市的光，LiveX 节点的光形、七站点亮、数百节点、站号标签全部后期合成。**航拍备选方案**（J17a–J17c 生成不过关时）：① 3D 城市底：按虚构港城的街区布局程序化建模（红砖旧城 + 清水混凝土新区 + 河与港湾 + 体育场碗形），蓝调与湿地面按本镜 Lighting 打光，摄影机路径直接用本镜的高度与俯角关键帧；② 授权航拍素材：选蓝调、雨后湿地面、有体育场与河湾的真实港城航拍，做 3D 摄影机反求。两种底都不带任何节点光，节点作为 3D 点挂接到真实街角，后期逐个点亮。`generate_audio=false`：七声铃每 0.5 s 一声（第一声 53.5 已在上一镜）：53.5 01 B5 · 54.0 02 C#6 · 54.5 03 E6 · 55.0 04 F#6 · 55.5 05 G#6 · 56.0 06 B6 · 56.5 07 E7，沿 E 大调五声音阶上行、由远及近；Pad 展开，Sub E1，无鼓；56.5–57.0 数百节点亮起时一层极轻的玻璃颗粒声。每一声铃都要和一个节点同帧点亮，只能由声音引擎和合成共同对齐。

**输入媒体**

| 任务 | start_image | end_image | image_references |
|---|---|---|---|
| J17a | KF-S17-RISE：从她座位正上方约 5 m 俯视，她是人海里一点红和一张白纸，看台顶棚边缘在画面上方 | KF-S17-ROOF：机位刚越过看台顶棚边缘（约 40 m），朝向与之后 100 m 悬停段一致（朝 02–04 所在的方向）；碗形看台与草坪在下方展开；看台外 Gate C 一侧的钟楼广场在画面一侧清楚可见，钟楼旁那台 Paragon 是画面里唯一近处的设备（只有机身，灯箱不点亮）；远处 02 Western Univ 的校园留在画内 | CS-CHEN-B、KF-S14（锁钟楼广场） |
| J17b | KF-S17-100-PLATE（由 03「S17 变体」100 m 派生，**不是**「S17 B」500 m 底板；该变体若仍是 −40°，按本条重出）：约 100 m 高、俯角约 −28°（全画幅等效约 20–22mm），蓝调中的体育场与四个入口广场（12 / 3 / 6 / 9 点方向，湿花岗岩），钟楼在其中一个广场旁、离摄影机最近，Market Hall 的玻璃顶在附近；摄影机朝向 02–04 所在的方向，体育场外 1.5 km 内的街区一直铺到画面上沿，地平线刚好不入画；**画面里去掉所有节点光，只保留真实城市光** | — | KF-S17-100-PLATE；`S17_B.png`（500 m 的城市面貌参考） |
| J17c | — | — | 输入视频 = J17b 定稿片段 |

**Duration**：成片 3.0 s（帧 1620–1710）：54.0–54.5 升起越过顶棚；54.5–55.5 约 100 m 近乎悬停；55.5–56.5 升到约 500 m；56.5–57.0 缓慢上升 + 0.5° 漂移。

**Camera Movement**：54.0–54.5 从她身边垂直升起越过看台顶棚（crane 缓动 0.45,0,0.1,1），摄影机始终朝向 02–04 所在的方向；54.5–55.5 在约 100 m 减速到近乎悬停，俯角约 −28°（由 −40° 放缓，让摄影机朝向上、距体育场 ≤ 1.5 km 的 02–04 在铃响同帧可见）；55.5–56.5 升到约 500 m，俯角抬到 −22°，地平线入画；56.5–57.0 缓慢上升 + 0.5° 漂移。航拍段按全画幅等效约 20–22mm（16:9 竖向视场约 49–54°）：100 m、俯角 −28° 时画面上沿约在水平线下 1–3°，体育场外 1.5 km 内的街区都在画面上部，地平线刚好不入画；500 m、俯角 −22° 时地平线进入画面上部。若按 35mm（竖向视场 32°），−28° 时画面上沿只看到约 0.5 km，02–04 会出画。J17a 起点与 S16 最后一格（她的近景）位置连续，她随上升缩小并被顶棚遮挡。

**Character Action**：无可辨识的人物动作；看台上的人群是逆光的点阵，她只是一点红和一张白纸。

**Product Position**：节点按真实街角与建筑手工布点（后期）：Paragon 只在室外广场与草坪（体育场四个入口、钟楼旁、Western Univ），Gateway 在室内大堂与连廊（透过玻璃见两道竖光），Portal 在走廊与电梯厅窗内（一圈蓝晕）。100 m 时四个入口广场上四台 Paragon 的上下灯箱像一圈白色表盘刻度，钟楼旁那台最近，两块白矩形光形清楚；Market Hall 玻璃顶下 Gateway 的两道白色竖光也认得出。54.0–54.3 升起的前 0.3 s，钟楼旁那台 Paragon 是画面里唯一近处的设备（上下两块白矩形清楚可辨）——「一个设备」这一级；同帧远处 02 点亮。生成素材里这些位置只要是空的广场、玻璃顶和窗户（J17a 里钟楼旁那台 Paragon 可以有机身，灯箱不点亮）；所有光形由后期挂接。

**Lyra**：不入画（太远）；每个节点里都是她。

**UI**：无屏幕 UI。后期合成：① 节点光：Gateway / Paragon 节点为 5600K 中性白的竖向光形，Portal 节点为柔和蓝晕；三者亮度上限同为周围 2700K 窗灯的 1.3 倍。100 m 时画成三种真实光形（Gateway 两道白竖条、Paragon 上下两块白矩形、Portal 一圈蓝晕），升到 500 m 时收成光点（settle 0.5 s；Portal 节点仍是蓝色的小晕点）；② 七站点亮：每声铃同帧，对应节点 120 ms 升亮到峰值、900 ms 余辉回落到常亮（峰值 60%），由远（近地平线）到近（体育场旁）：01 St. Mary's → 02 Western Univ → 03 Harbour Hotel → 04 Pier Tower → 05 Harbour Interchange → 06 Market Hall → 07 Harbour Depot。七个站号全部可见：01 的铃（53.5）落在 S16，先闻其声，55.5 地平线入画时补显 0.6 s「01 · St. Mary's」（此时 01 节点已是常亮）；02（54.0，J17a 远处）、03（54.5）、04（55.0）布在摄影机朝向、距体育场 ≤ 1.5 km 处，铃响同帧在画内；③ 节点标签（Geist Mono 13 px，0.18em，1 px 竖向引线），每个 0.6 s：「01 · St. Mary's」｜「02 · Western Univ」｜「03 · Harbour Hotel」｜「04 · Pier Tower」｜「05 · Harbour Interchange」｜「06 · Market Hall」｜「07 · Harbour Depot」；④ 56.5 起其余约 420 个节点以 20–60 ms 随机延迟逐个亮起，随后与 Sub 拍点同步呼吸 ±6%。**全程不画任何连线。** 追踪：对航拍素材做 3D 摄影机反求，节点作为地面上的 3D 点挂接，保证视差正确。

**Lighting**：蓝调中的真实港城，雨刚停，地面湿亮；街道钠灯与 2700K 暖黄窗灯；体育场外环冷白泛光；黑色的河与港湾；地平线雾气。Gateway / Paragon 节点的 5600K 中性白、Portal 节点的柔和蓝晕，都与窗灯的暖黄形成色温对比（后期）。

**Start Frame**：J17a = KF-S17-RISE；J17b = KF-S17-100-PLATE。

**End Frame**：J17a = KF-S17-ROOF；J17c 结束在约 500 m、俯角 −22°、地平线入画的城市大全景。

**Continuity**：七声铃、七站、七个「叮」一一对应，落点见声音行；七个站号都在画面里出现过（01 在 55.5 补显）。钟楼、Market Hall、体育场的相对地理与 S12 / S13 / S14 一致；02–04 在摄影机朝向、距体育场 ≤ 1.5 km 处。57.0 城市画面在 0.15 s 内压到全黑，接 End Card，只剩雨声与远处球场声浪尾音。

**Negative Prompt**：NEG-BASE + glowing network lines, light trails connecting buildings, holographic city, blue data grid, bright screens on rooftops, billboards, drone-show lights, fireworks, daytime sky, sunset orange, fake miniature tilt-shift look, repeating copy-paste buildings.

**English Prompt:**
> J17a — Fast vertical crane rising from directly above a stadium seat: a packed stand of backlit spectators below, one tiny spot of red and a small white paper among them; the camera rises past the edge of the stand roof, heading toward the distant city, and the floodlit bowl and pitch open up below; to one side, outside the stand, the wet plaza with a small red-brick clock tower comes into clear view, the LiveX Paragon outdoor display pillar standing unlit beside it, and far away a university campus lawn stays in frame. Blue hour, wet surfaces. Avoid: logos, sponsor boards, light trails, glowing screens, lit light boxes.
>
> J17b — Wide-angle aerial (about 20mm) at about 100 metres, looking down at about 28 degrees on a real harbour city stadium at blue hour after rain: the floodlit bowl, four wet granite entrance plazas around it at twelve, three, six and nine o'clock, a small red-brick clock tower beside the nearest plaza, the glass roof of an old market hall nearby; beyond the stadium, city blocks with a campus lawn, a hotel and an office tower stretch up to the top edge of the frame, the horizon just out of frame; sodium streetlights and warm windows. Nearly hovering, very slow drift. Avoid: glowing lines, holograms, screens, billboards, fireworks.
>
> J17c (extension, forward) — Continue smoothly: the camera climbs to about 500 metres and tilts up until the horizon enters the frame, revealing the whole real harbour city in blue hour, warm windows, sodium streets, dark river and harbour, light mist on the horizon; ends with a slow rise and a slight drift. Avoid: network lines, holographic city, drone lights, daylight.

---

### S18 · 57.0–60.0 · End Card：两笔成 X → LIVEX.AI → AI City → Ask the city.

**推荐参数**

| 任务 | mode | duration | resolution | aspect_ratio | draft | generate_audio | extension_mode | 上片 |
|---|---|---|---|---|---|---|---|---|
| 主体 | **不使用 Seedance** | — | — | — | — | — | — | End Card 由 Claude Code 逐帧渲染（扩展 titles.js 的 EndCard） |
| J18（可选） | video_extension（输入 = J17c 定稿） | 4 s | 1080p | 16:9 | 视面板而定（C 档） | false | forward | 只在 J17c 可用段不足时，给 57.0–57.15 的压黑提供画面余量 |

参数理由：品牌卡必须逐像素精确（LiveX X 标志来自官方规格单描摹、LOCKUP 比例、字体、句号色值），任何生成模型都不适合。唯一可能用到 Seedance 的地方，是 S17 尾部在 57.0 之后还需要 0.15 s 的城市画面来做压黑。按 S17 的映射，J17c 在 4.0 之后还有约 1.0 s 素材，压黑用 4.0–4.4 即可，一般不需要 J18；只有 J17c 定稿的可用段不足时才启用 J18。J18 从 J17c 的**末帧**往后续，所以启用 J18 时 J17c 必须用到末帧（按拼接点裁切）。`generate_audio=false`：57.0 音乐与城市声在 0.15 s 内压掉，只剩雨声和远处球场声浪尾音；57.5 Sonic Logo 第一声「叮」：原始公交铃 E6（与 X 交叉同帧）；58.0 第二声「叮」：玻璃 + 钢质合成铃 B6（上行纯五度）+ 40 Hz 低频，落在第 30 小节强拍；58.5 起大调动机 G#5–B5–E6 轻声收尾；尾音 2.5 s，59.6–60.0 只剩雨声；成片 −14 LUFS / −1 dBTP。

**输入媒体**：J18 的输入视频 = J17c 定稿片段。End Card 本体不需要任何生成素材：`film/assets/logo_paths.json`（MARK 两个回旋镖子路径）、Geist、Instrument Serif、色值 #06080b / #2F5BEA / #C8372D。

**Duration**：成片 3.0 s（帧 1710–1800）。J18 只用 0.15 s。

**Camera Movement**：无摄影机运动；58.5「AI City」一次轻微对焦（blur 6→0、scale 1.01→1）。J18 延续 J17c 的缓慢上升与 0.5° 漂移。

**Character Action**：无人物。57.0–57.15 城市画面压到全黑（exit）。57.15–57.45 第一笔：铅笔石墨质感的回旋笔画从左下向右上画出（来自字条上 Seat 7 下的那道线）；57.2–57.5 第二笔：钴蓝 #2F5BEA 发光笔画从右下向左上画出（来自 Lyra 路线卡上的路线，外发光 18 px）；57.5 两笔在中心交叉的那一帧同时转为纯白（1 帧闪白 + 发光 0.3 s 衰减），成为 LiveX 的 X。

**Product Position**：无设备。

**Lyra**：无。

**UI**：上片文字自上而下三行，逐字：第一行「[LiveX X 标志]  LIVEX.AI」（品牌规范横向锁定组合）；第二行「AI City」；第三行「Ask the city.」。时序：58.0 X 右侧出现 LIVEX.AI 字标（按 LOCKUP：gap 0.115、wordH 0.423、wordTop 0.288；blur 10→0、x −12→0，0.5 s，glide）；58.5「AI City」（Geist 500 176 px，−0.045em）；59.0「Ask the city.」（Instrument Serif Italic 56 px，逐词从模糊到清晰）；59.25–59.6 句号从红围巾暖红 #C8372D 过渡到 LiveX 钴蓝 #2F5BEA（settle）——从「人」到「品牌」；59.6–60.0 完全静止，最后一帧不淡出。16:9 版锁定组合整体视觉中心在画高 47%；4:5 版三行居中，整体上移到画面 42% 高度。片中不再叠加其他文案；客户句 AI meets you. Where life happens. 放在 X 帖子正文第一行，不上片。

**Lighting**：黑底 #06080b；只有第二笔的钴蓝外发光和交叉帧的闪白。

**Start Frame**：J18 的起点 = J17c 定稿的最后一帧。End Card 起点 = 全黑。

**End Frame**：J18 结束于继续缓慢上升的城市大全景（只用前 0.15 s）。End Card 结束于三行静止的品牌卡。

**Continuity**：第一笔来自 S02 字条上 Seat 7 下的那道铅笔下划线（S02 2.6–3.0 高光扫过时埋点）；第二笔来自 S08 路线卡的钴蓝路线；句号起点色 = 陈师傅的红围巾。

**Negative Prompt**：（仅 J18）NEG-BASE + network lines, holographic overlays, sudden camera moves, daylight, fireworks.

**English Prompt:**
> J18 (extension, forward, optional) — Continue the same aerial shot of the real harbour city at blue hour for a few more seconds: the same slow rise and slight drift, warm windows, sodium streets, dark harbour, light horizon mist, nothing new appears. Avoid: network lines, holograms, drone lights, daylight, sudden moves.

---

## 附录 A · 生成任务总表与预算

草稿档位：A = 5 个草稿，B = 3 个，C = 2 个。定稿每条 1 次（1080p，`bitrate_mode=high`）。

| # | 任务 | 镜号 | mode | aspect | 生成 s | 档位 | 草稿 s（生成 s × 条数） | 定稿 s | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | J01 | S01 | omni_reference | 16:9 | 4 | B | 12 | 4 | 裁 4:3；4:5 按 05 §1.2.4 重排 |
| 2 | J02a | S02 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 3 | J02b | S02 | omni_reference | 16:9 | 4 | B | 12 | 4 | 自然表演 |
| 4 | J02-V | S02 | omni_reference | 3:4 | 4 | B | 12 | 4 | 新增：4:5 版竖幅，裁 1080×1350 |
| 5 | J03 | S03 | omni_reference | 16:9 | 4 | A | 20 | 4 |  |
| 6 | J04 | S04 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 7 | J05F | S05 | omni_reference | 16:9 | 4 | B | 12 | 4 | 可选 |
| 8 | J06C | S06 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 9 | J07 | S07 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 10 | J09B | S09 | omni_reference | 16:9 | 6 | A | 30 | 6 | 8 → 6 s；无人潮，时间重映射 |
| 11 | J09C | S09 | omni_reference | 16:9 | 6 | B | 18 | 6 | 5 → 6 s；人潮层，改为必需 |
| 12 | J10a | S10 | omni_reference | 16:9 | 4 | C | 8 | 4 | 可选 |
| 13 | J10b | S10 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 14 | J11a | S11 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 15 | J11b | S11 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 16 | J12a | S12 | omni_reference | 16:9 | 4 | A | 20 | 4 |  |
| 17 | J12b | S12 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 18 | J13a | S13 | omni_reference | 16:9 | 4 | B | 12 | 4 | 取 1.0–4.0 |
| 19 | J13b | S13 | omni_reference | 16:9 | 4 | B | 12 | 4 | 首帧 = J13a 末帧 |
| 20 | J14a | S14 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 21 | J14b | S14 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 22 | J14c | S14 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 23 | J14d1 | S14 | omni_reference | 16:9 | 4 | A | 20 | 4 |  |
| 24 | J14d2 | S14 | omni_reference | 16:9 | 4 | A | 20 | 4 |  |
| 25 | J15-01 | S15 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 26 | J15-02 | S15 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 27 | J15-03 | S15 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 28 | J15-04 | S15 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 29 | J15-GC | S15 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 30 | J15-TN | S15 | omni_reference | 16:9 | 4 | C | 8 | 4 |  |
| 31 | J16a | S16 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 32 | J16b | S16 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 33 | J16c | S16 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 34 | J16d | S16 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 35 | J17a | S17 | omni_reference | 16:9 | 4 | A | 20 | 4 |  |
| 36 | J17b | S17 | omni_reference | 16:9 | 4 | B | 12 | 4 | 取 3.0–4.0 |
| 37 | J17c | S17 | video_extension | 16:9 | 5 | B | 15 | 5 | forward |
| 38 | J18 | S18 | video_extension | 16:9 | 4 | C | 8 | 4 | 可选，forward |
| 39 | L1 | S09 | omni_reference | 16:9 | 4 | B | 12 | 4 | 可选：ECU 微表情（原光学后拉已取消） |
| 40 | L2 | S05 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 41 | L3 | S06 | omni_reference | 16:9 | 4 | B | 12 | 4 | 口型可选 |
| 42 | L4 | S08 | omni_reference | 16:9 | 4 | B | 12 | 4 |  |
| 43 | L5 | S09 / S10 | omni_reference | 9:16 | 7 | B | 21 | 7 | 4 → 7 s |
| 44 | L6 | S10 | omni_reference | 9:16 | 4 | B | 12 | 4 |  |
| 45 | L7 | S10 / S11 | omni_reference | 21:9 | 4 | A | 20 | 4 | Handoff 母版 |
| 46 | L8 | S10 | omni_reference | 9:16 | 4 | A | 20 | 4 | 5 → 4 s |
| 47 | L9 | S11 | omni_reference | 9:16 | 4 | B | 12 | 4 |  |
| 48 | L10 | S14 | omni_reference | 9:16 | 5 | B | 15 | 5 | 4 → 5 s；口型可选 |
| 49 | L11 | S15 | omni_reference | 9:16 | 4 | B | 12 | 4 |  |
| 50 | L12 | S15 | omni_reference | 9:16 | 4 | C | 8 | 4 |  |
| 51 | L13 | S15 / S11 | omni_reference | 9:16 | 4 | C | 8 | 4 |  |
| | **合计** | | | | **213** | | **687** | **213** | 草稿 164 条；定稿 51 条 |
| | **精简版**（去掉 J05F、J10a、J18、L1） | | | | **197** | | **647** | **197** | 草稿 154 条；定稿 47 条 |

相对上一版（50 条 / 207 s / 草稿 160 条 670 s）：J02-V 新增（+4 s，草稿 +12 s，+1 条）；J09B 8 → 6 s；J09C 5 → 6 s 且从 C 档可选改为 B 档必需；L5 4 → 7 s；L8 5 → 4 s；L10 4 → 5 s；L1 改为可选。

**预算填表**：

| 项 | 数量 | 单价（从 Higgsfield 面板读取） | 小计 |
|---|---|---|---|
| 草稿 480p | 687 s（或 164 条） | P_480p = ____ | 687 × P_480p |
| 定稿 1080p（draft_job_id） | 213 s（或 51 条） | P_1080p定稿 = ____ | 213 × P_1080p定稿 |
| 余量（返修、video_edit、重新定稿） | +20% | — | (草稿 + 定稿) × 0.2 |
| **总计** | | | (687 × P_480p + 213 × P_1080p定稿) × 1.2 |
| 精简版总计 | 草稿 647 s（154 条）· 定稿 197 s（47 条） | | (647 × P_480p + 197 × P_1080p定稿) × 1.2 |

---

## 附录 B · 定稿检查清单

**产品保真（逐台对照产品抠像）**
- Gateway V2：2.18 m、竖屏、哑光黑粉末喷涂钢；header 横梁略宽于机身、向前微挑，正中黑色玻璃摄像头；细黑边框 + 内框线；正面左右两条几乎通高的白色 LED 竖灯条；侧面竖向打孔格栅；宽大的黑色矩形底板 + **4 个**锁定的万向脚轮。机身 114 × 218 cm，屏幕约 107 × 190 cm。比 1.58 m 的陈师傅高约 60 cm。
- Paragon Outdoor：2.46 m；缎面拉丝不锈钢（**不是镜面，不是塑料**）；平直的薄银雨棚由**两根**短的深色立柱托起；整块黑色玻璃正面；屏幕上下各一个白色点阵打孔灯箱 + 银框 + 白色 LED 边缘光（产品结构，不是广告灯箱）；上下各两条深色圆角扬声器格栅；屏幕正上方居中摄像头；落地固定，**无脚轮**。机身 97 × 246 cm，屏幕约 81 × 143 cm。
- Portal：超薄壁挂竖屏；拉丝银色铝合金细边框 + 黑色内边框；顶部正中**梯形**银色摄像头模组；柔和的蓝色墙晕；屏幕中心约 150 cm。尺寸与场景对应：55 寸（机身 73 × 125，屏幕约 68 × 121 cm）Exit B 通道、医院走廊；43 寸（57 × 99，屏幕约 53 × 95）电梯厅；32 寸（43 × 74，屏幕约 40 × 71）Gate C。
- 屏幕在画面里的高宽比按正视真实比例约 1.78 校验（正对镜头时），不按 `screens.json` 的透视比例。
- 任何设备都没有移动、旋转；没有通用自助机、售票机、电视立架、带印刷画面的广告灯箱的外形；正向提示词里没有 kiosk、totem。

**屏幕与文字**
- 浅色模式屏幕（Gateway、日间 Portal）在生成素材里是均匀发光的浅灰白底板（约 `--paper` 的 85%，只有 3–5% 玻璃反光），并真实地照亮面前的人、字条和地面，地面有屏幕倒影；深色模式屏幕（Paragon、医院夜间 Portal）是纯黑（只有淡反光）。底板没有图像、文字、渐变，四边干净可追踪。
- 遮挡键控：浅色屏按「比屏幕暗」、深色屏按「比屏幕亮」取遮挡物，头发、手指、镜框边缘 roto 过；UI 没有盖到陈师傅的肩、头发或字条上。
- 画面里没有任何模型生成的文字、数字、logo（字条、卷帘牌、导向牌、球衣号码、钟面数字、背面品牌全部后期）；翻盖机外屏在生成素材里是黑的。

**人物**
- 陈师傅：银灰齐下巴短发、玳瑁圆框眼镜、藏蓝及膝大衣、米色托特包、黑色运动鞋、红围巾；**32.0 起**外叠藏青白条围巾，红色露出约 40%（32.0 之前只有红围巾）；戒指在右手无名指，疤在左手拇指根。
- 1985 年的手是 **31 岁**：年轻、皮肤紧致、有少量生活痕迹、指节有职业司机的粗壮，不是少女手；拇指疤约 2 cm、两年的旧疤，淡粉偏白、已平整，不是新伤。
- 字条：S12–S14 一直在她左手（S12 右手指路，S14 右手贴砖），没有凭空消失，没有塞进包或口袋。
- Lyra（每条 L 素材和每张 LYRA 帧都要过）：与 `lyra_white.jpg` 做面部叠图差异比对，脸型、五官位置一致；X 标在**左胸**（画面右侧）；小圈耳饰；头发垂在她右肩一侧；黑皮带金扣；白色短袖小立领针织衫、炭灰阔腿裤、黑色尖头高跟鞋；白底素材右侧有柔和投影，黑底素材背景纯黑。
- Lyra 没有被镜像：侧身向画左走时（L6、L7）左胸 X 在靠近镜头的一侧；X 消失或跑到右胸就重生成。
- LYRA-POINT：左手（画面右侧）在髋高向画右展开，掌心朝上、四指并拢，右手在腰前，手在画布 y 900–1150；左胸 X 可见，没有被手臂遮挡；S08 尾帧、S09 全程、S10 首帧是同一个姿态。
- S06 的 Lyra 视线略向下约 15–20°，落在镜头右侧，不直视镜头。
- 人潮没有「融化」、合并或变形的人；人潮全程 1 倍速（S09 人潮来自 J09C）；前景人脸不长时间清晰。

**构图与时间**
- 关键动作、人脸与 Lyra 双眼在 4:5 安全列 x 528–1392 内；产品与反转要素也在列内：S04 竖光（4:5 版单独放到列左缘）、S09 Exit B 暖光 x ≤ 1350、S11 Gateway 整机 x ≥ 30%、S13 门缝光 x 1040、S14 Paragon 屏幕中心 x ≤ 1267。S01、S02、S18 的 4:5 版按 05 §1.2.4 原生重排（S02 用 J02-V，字条约 90% 画宽）。
- S09：镜头口径为全画幅等效 35mm，距离与占画高一致（90% ↔ 4.2 m，62% ↔ 6.0 m，30% ↔ 12.5 m）；接缝是「屏幕宽 = 画宽」的那一帧（约 20.6），屏幕内容逐像素连续，没有白色外延或退潮；左右边框约 20.6 起从两侧进入，22.5 上下边框扫入、屏幕矩形闭合。
- S15 五格 Lyra 双眼中点在 (960, 405)、间距 20 px，误差 ≤ 2 px；Gate C 格画面下缘可见闸机顶部与白色状态灯，陈师傅在 Portal 右侧过闸，不遮挡屏幕。
- 光的匹配：S13 门缝光 = S14 上灯箱（约 x 1040 / y 400）。
- Step-free 路线：S09 画右的暖光与 S10 通道尽头都是斜坡自动人行道（平滑踏面、无梯级）；只有 S02→S03 进站那段是扶梯。
- S15 Gate C 格：闸机后内廊深处的球迷商店摊位（藏青白条围巾、暖色灯泡）与旁边 Gateway 的两道竖光在焦外可辨，没有文字。
- S17：100 m 悬停段俯角约 −28°（等效 20–22mm），02–04 铃响同帧在画内，01 在 55.5 补显站号；54.0–54.3 近处只有钟楼旁那台 Paragon；Gateway / Paragon 节点是 5600K 中性白竖向光形，Portal 节点是柔和蓝晕，三者亮度上限都是周围窗灯的 1.3 倍。
- 连续性：J13a 取 1.0–4.0，J13b 从 J13a 的末帧接上；J17b 取 3.0–4.0，J17c 从它的末帧续接；40.5 与 55.5 没有跳帧。
- 变速：有人物动作的片段 0.9–1.15×（L6、L8、L9、J02b、J01 都取自然速度段）；纯摄影机或环境 ≤ 1.8×（光流慢放 ≤ 2×，只用于静止场景）；航拍 ≤ 3×。
- S14 的 Paragon 正面画布贴到 46.35，46.0–46.35 没有黑屏。
- 每条定稿片段出入点外至少 6 帧余量（首帧来源 / extension 源除外，见 1.4）；帧率已转换到 30 fps。
- 所有「叮」的剪辑点与 master 时间码一致：25.5 · 28.0 · 30.0 · 42.0 · 47.0 · 48.0 · 49.0 · 50.0 · 51.0 · 53.5 · 54.0 · 54.5 · 55.0 · 55.5 · 56.0 · 56.5 · Sonic Logo 57.5 / 58.0。

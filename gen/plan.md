# 生成版《7 路 / Route 7》· 制作计划

画面：GPT-image-2.5 关键帧 → Seedance 2.5（omni_reference，1080p，首帧锁定）。
声音：陈师傅旁白与台词（ElevenLabs v4，预设声音 Nora），Lyra 台词（账户里的 Lyra 声音元素），球迷一句（预设男声）；配乐沿用 `film/audio` 的 E 调总谱。
合成：Higgsfield 沙盒 ffmpeg。字幕、站牌字卡、1985/2026 年份角标、End Card 由 `film/` 代码渲染为透明图层。

## 旁白与台词（英文；字幕同时烧录）

| 时刻 | 谁 | 文本 | 画面 |
|---|---|---|---|
| 00.4 | 陈（旁白） | Thirty-one years, I drove the number seven. | 1985 年的手与卷帘牌 |
| 03.3 | 陈（旁白） | Tonight, my granddaughter plays her first match… | 字条 Seat 7，翻盖机合上 |
| 06.2 | 陈（旁白） | …right where my old depot used to be. | 新换乘大厅，找不到旧站名 |
| 09.0 | Lyra（画外） | May I? | 柱旁，左缘冷白竖光 |
| 10.4 | 陈（过肩，背对镜头） | They built a stadium on my bus depot. | S05 过肩 |
| 12.8 | Lyra（对口型） | Route seven's last stop. I know it. | S06 反打 |
| 21.2 | 陈（旁白） | Somebody still remembered. | Reveal 后拉途中 |
| 33.6 | 球迷 | Gate C? | S12 |
| 34.4 | 陈 | Past the clock tower. Follow the scarves. | S12，她抬手指路 |
| 38.4 | 陈（旁白） | The city had changed. The route hadn't. | S13 门开之前 |
| 42.8 | 陈 | I drove this route for thirty years. | S14 手贴红砖 |
| 45.1 | Lyra | Then you know the way. | S14 Paragon |
| 52.8 | 陈（旁白，轻声） | Last stop. | S16 看台坐定 |
| 59.0 | Lyra | Ask the city. | End Card |

## 镜头与生成任务

| 镜 | 时间 | 关键帧 | 用途 / 取用 |
|---|---|---|---|
| G01 | 0.0–1.5 | K01 1985 手与卷帘牌 | Seedance 4 s，取 1.5 s |
| G02 | 1.5–4.5 | K02 字条 Seat 7 | 4 s，取 3 s |
| G03 | 4.5–7.5 | K03 扶梯升入大厅 | 4 s，取 3 s |
| G04 | 7.5–10.0 | K04 柱旁，左缘竖光 | 4 s，取 2.5 s |
| G05 | 10.0–12.5 | K05 过肩 | 4 s，取 2.5 s |
| G06 | 12.5–15.0 | K06 Lyra 反打（对口型） | 4 s，取 2.5 s |
| G07 | 15.0–17.5 | K07 愣住→笑 | 4 s，取 2.5 s |
| G08 | 17.5–20.0 | K08 路线卡 | 4 s，取 2.5 s |
| G09 | 20.0–27.0 | K09a → K09（首尾帧） | 8 s，取 7 s |
| G10 | 27.0–30.0 | K10 Portal 55 + 斜坡人行道 | 4 s，取 3 s |
| G11 | 30.0–33.0 | K11 Market Hall | 4 s，取 3 s |
| G12 | 33.0–37.5 | K12 Gate C? | 5 s，取 4.5 s |
| G13 | 37.5–42.0 | K13 人潮与门开 | 5 s，取 4.5 s |
| G14a | 42.0–45.5 | K14a 钟楼与 Paragon | 4 s，取 3.5 s |
| G14b | 45.5–47.0 | K14b Paragon 背面 | 4 s，取 1.5 s |
| G15a–d | 47.0–51.0 | 医院 / 校园 / 酒店 / 写字楼 | 各 4 s，各取 1 s |
| G15e | 51.0–52.0 | Gate C 闸机 | 4 s，取 1 s |
| G16 | 52.0–53.2 | K16 看台举字条 | 4 s，取 1.2 s |
| G16b | 53.2–54.0 | K16b 林拍胸口 | 4 s，取 0.8 s |
| G17 | 54.0–57.0 | K17 航拍夜城 | 5 s，取 3 s |
| S18 | 57.0–60.0 | 代码 End Card | — |

【已实现的 Claude Code 动态影片系统（film/src，确定性逐帧渲染）】
画幅：影片 1920×1080，30fps，H.264；所有设备屏幕 UI 画布统一 1080×1920 竖屏（9:16），通过单应矩阵（homography / CSS matrix3d）精确贴进真实产品渲染图的屏幕四角（屏幕四角由图像分析测得）。
设备：Gateway / Portal 32·43·55 / Paragon Outdoor 使用客户产品图 SAM 抠像的真实渲染；每台设备按真实高度（Gateway 218cm、Paragon 246cm、Portal55 125.5cm、Portal43 98.6cm、Portal32 73.9cm）放入 2.5D 空间；落地设备带接触阴影、抛光地面倒影、屏幕辉光与地面溢光；壁挂 Portal 抬高到屏幕中心约 150–160cm 视线高度，并带产品图同款柔和钴蓝背光墙晕。
色彩 Token：--ink #06080b（影片黑）、--graphite #0f1216、--steel #8a919c、--mist #d9dee5、--paper #f4f5f7、--cobalt #2f5bea（LiveX 蓝，全片唯一饱和色，只用于 Lyra 的"活着"信号：语音线、状态点、路线、强调按钮）、--warm #ffcf9a / --sodium #ffb468（钨丝灯与城市钠灯）。屏幕 UI：--ui-ink #0d1117、--ui-ink-2 #4a5260、--ui-ink-3 #8b93a1、卡片 rgba(255,255,255,.74) + backdrop blur 28px saturate 1.5 + 1.5px 白色描边、圆角 36px、阴影 0 30px 80px rgba(18,28,58,.14)。深色模式（户外 Paragon、夜间）卡片 rgba(18,22,30,.62)。
字体：Geist（UI 与影片标题）、Geist Mono（事实信息：地点、时间、坐标、节点标签，全大写，字距 0.14–0.22em）、Instrument Serif Italic（全片只用一次的情绪时刻：End Card 品牌线）。
屏幕 UI 字号（1080×1920 画布）：状态栏 22 mono；字幕 44–46 / 500 / -0.02em；卡片标题 50 / 600 / -0.025em；正文 29 / 1.38；眉标 21 mono 0.16em；数字 84 / 500 / -0.04em。
影片层字号（1920×1080）：地点字幕条 17 mono 0.22em + 56px 细线；时钟 18 mono tabular；标题 176 Geist 500 -0.045em；品牌线 46 Instrument Serif Italic；节点标签 13 mono 0.18em。
Lyra OS 屏幕布局：64px 边距，6 栏/24px 槽；状态栏 y52–108（LiveX 标志 + 地点 | 时间 + 钴蓝"在场"呼吸点）；Lyra 全身照占满画布，腰部以上永不遮挡；字幕区 y1030–1150；内容卡片区 y≥1160；语音线 y1790。
UI 状态：idle（Lyra 呼吸：0.35% 缩放 @0.24Hz + 极轻摆动，状态点呼吸）→ listening（语音线平静起伏）→ speaking（语音线由分层噪声驱动振幅，字幕逐词"从模糊到清晰"出现）→ result（卡片入场，行元素错峰 0.14 进度）→ handoff（路线绘制 + 行走点移动，目的地点弹出）。
场景 UI：Retail 商品推荐卡（"Picked for you · 3 left / Cashmere scarf, oat / 色板 / Aisle 2 →"）；Hotel 欢迎卡（"Welcome back / Room 1204 is ready."）；Hospital 导航（建筑线稿平面 + 路线自绘 + "Maternity · Level 6 / Elevator B · 2 min"）；Campus 导航（"Hall C · Room 204 / Starts 18:50 · 4 min walk"）；Stadium 座位卡（"212 Section / F·9 Row·Seat"）；Corporate 访客卡（"Your host is on the way down."）；Outdoor 活动与城市信息（"Riverfront Lights, 20:00 / 18° clear / Line 2 · 3 min"）。
动效原则："从模糊到清晰"（像镜头跟焦），没有飞入：reveal = opacity 0→1、blur 10→0px、y 14→0、scale .985→1。卡片 0.6–0.9s glide；行错峰；退出 0.35s exit 曲线，y -18px，blur 10px。
缓动（cubic-bezier）：glide (.16,1,.3,1) UI 到达；settle (.22,1,.36,1) 文字与卡片；cine (.65,0,.35,1) 对称镜头运动；crane (.45,0,.1,1) 大尺度拉远；push (.7,0,.84,0) 加速进入剪辑点；exit (.5,0,.75,0) 离场；snap (.2,.9,.1,1) 微交互。
深度与模糊：2.5D 摄影机（焦距常数 F=1150，屏幕缩放 = F/(z−camZ)），推拉产生真实视差；景深按薄透镜弥散圆计算，对焦始终跟随设备；环境由 3D 点光源构成（吊顶筒灯阵列、吊灯、窗外城市、货架灯带、体育场泛光灯组），焦外光斑大小由弥散圆决定、亮度按能量守恒衰减；抛光地面反射光源；前景路人为巨大深度虚化剪影；主角为真实人体比例剪影 + 屏幕光轮廓光。
后期：35mm 颗粒（每秒 24 个独立颗粒场，overlay 16%）、暗角、全局闪白与黑场层。
城市：程序化夜间城市光图（旋转街区格网的路灯链、街区窗户光点、弧形主干道与车灯、黑色河流与公园、泛光层），CSS 3D 真透视航拍；LiveX 节点 = 地面上的纯白光点，按距中心顺序"醒来"，并与音乐拍点同步呼吸（网络 = 同步，而不是连线）；重点节点用 1px 竖向引线 + mono 标签标注；地平线雾气 + 移轴模糊。
转场库：屏幕矩形 Match Cut；连续拉远（Lyra 脸 → 屏幕 → 设备 → 人 → 空间）；"十的次方"（整个地点画面收缩成城市中的一个节点光点）；地点字幕条从细线延展而出。
End Card：LiveX X 标志从模糊与光晕中聚焦 → LIVEX.AI 字标 → 大标题 → 衬线斜体品牌线；背景为变暗的城市。
品牌标志：从官方规格单平面印刷版描摹（6 倍超采样轮廓追踪，even-odd 填充）。

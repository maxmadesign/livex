"""Assemble the treatment page (docs/treatment/index.html) from the production
bible: master.json (story, timeline, shots), the markdown docs, rendered stills.

  python3 docs/treatment/build.py
"""
import html
import json
import os
import re
import markdown

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.dirname(HERE)
M = json.load(open(os.path.join(DOCS, 'master.json'), encoding='utf-8'))
FIN = json.load(open(os.path.join(DOCS, 'concepts.json'), encoding='utf-8'))
tpl = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()


def md(name):
    p = os.path.join(DOCS, name)
    if not os.path.exists(p):
        return ''
    src = open(p, encoding='utf-8').read()
    out = markdown.markdown(src, extensions=['tables', 'fenced_code', 'sane_lists'])
    return re.sub(r'<table>', '<div class="tablewrap"><table>', out).replace('</table>', '</table></div>')


def esc(s):
    return html.escape(str(s or ''))


def split_prompts(name):
    """Split a prompt doc into (head, [(shot title, body)], tail): one block per `### Sxx` heading."""
    p = os.path.join(DOCS, name)
    if not os.path.exists(p):
        return '', [], ''
    src = open(p, encoding='utf-8').read()
    shots = list(re.finditer(r'^### (S\d\d.*)$', src, re.M))
    if not shots:
        return src, [], ''
    head, blocks, tail = src[:shots[0].start()], [], ''
    for i, m in enumerate(shots):
        end = shots[i + 1].start() if i + 1 < len(shots) else len(src)
        body = src[m.end():end]
        cut = re.search(r'^## ', body, re.M)
        if cut:
            tail, body = body[cut.start():], body[:cut.start()]
        blocks.append((m.group(1).strip(), body.strip()))
    return head, blocks, tail


def md_sections(src, open_first=False):
    """Render markdown as collapsible <details>, one per `## ` section; text before the first one stays open."""
    parts = re.split(r'^## ', src, flags=re.M)
    out = []
    if parts[0].strip():
        out.append(f'<div class="md">{mdx(re.sub(r"^# .*$", "", parts[0], count=1, flags=re.M))}</div>')
    for i, part in enumerate(parts[1:]):
        title, _, body = part.partition('\n')
        if title.strip() in ('目录', 'Contents'):
            continue
        out.append(f'<details class="doc"{" open" if open_first and i == 0 else ""}><summary>{esc(title.strip())}</summary><div class="md">{mdx(body)}</div></details>')
    return ''.join(out)


def mdx(src):
    out = markdown.markdown(src, extensions=['tables', 'fenced_code', 'sane_lists'])
    return re.sub(r'<table>', '<div class="tablewrap"><table>', out).replace('</table>', '</table></div>')


def doc(name):
    p = os.path.join(DOCS, name)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


DOCLIST = [('00_三个概念与选择.md', '三个概念、评审与选择'), ('01_60秒故事与时间线.md', '60 秒故事、人物与世界设定、时间线、完整分镜表'),
           ('02_Shot_List.md', '18 镜总览与跨文档索引'), ('03_GPT-image-2.5_分镜提示词.md', '14 张关键帧的中文提示词与负向词'),
           ('04_Seedance-2.5_视频提示词.md', '逐镜视频提示词、拆段、首尾帧与预算'), ('05_ClaudeCode_Motion_UI_Brief.md', 'Motion Graphic 与屏幕 UI 规范'),
           ('06_音乐与声音设计.md', '配乐、环境、Foley、UI 音、Sonic Logo 与逐秒 Cue'), ('07_Claude_Code_动态影片说明.md', '这支代码版影片的做法与复现'),
           ('master.json', '主剧本：所有文档的唯一权威来源')]


LADDER = [('PERSON', '一个人，一件真实发生的事'), ('AI', 'Lyra 以人的方式回应'), ('LIVEX', '原来她在一台真实的设备里'),
          ('PLACE', '设备属于一个真实空间'), ('NETWORK', '同一个 Lyra，许多地方'), ('AI CITY', '节点连起来，就是城市')]
SEC_COL = {'HUMAN': '#8d96a3', 'AI': '#3f6bff', 'REVEAL': '#ffffff', 'JOURNEY': '#ffcf9a', 'CITY': '#ffb468', 'AI CITY': '#e9edf2'}


def page(video='LiveX_AI_City_60s_web.mp4', poster='stills/poster.jpg', stills_dir='stills'):
    win = next(c for c in FIN['finalists'] if c['id'] == FIN['winner_id'])
    out = []
    out.append(f'''<div class="wrap">
<header class="hero">
  <div class="eyebrow">LiveX · 60 秒品牌影片 · 导演 Treatment</div>
  <h1>LiveX <em>AI City</em></h1>
  <p class="lede">{esc(M['logline_zh'])}</p>
  <div class="film"><video src="{video}" poster="{poster}" controls playsinline preload="metadata"></video></div>
  <div class="meta"><span>片名 <b>{esc(M['title_zh'])} / {esc(M['title_en'])}</b></span><span>时长 <b>60.0 s</b></span><span>画幅 <b>1920×1080 · 30 fps</b></span><span>品牌线 <b>{esc(M['tagline'])}</b></span></div>
</header>''')
    # idea
    out.append('<section><div class="eyebrow">核心想法</div><h2>LiveX 的设备不是摆进城市里的东西。<br>它们本身就是城市的 AI 节点。</h2>'
               '<div class="ladder">' + ''.join(f'<div>{a}<small>{b}</small></div>' for a, b in LADDER) + '</div></section>')
    # concepts
    cards = []
    for c in FIN['finalists']:
        w = c['id'] == FIN['winner_id']
        cards.append(f'''<article class="concept{' win' if w else ''}"><div class="tag">{'选定方案' if w else '备选方案'} · {esc(c['id'])}</div>
<h3>{esc(c['title_en'])}</h3><div class="zh">{esc(c['title_zh'])}</div><p>{esc(c['logline_zh'])}</p>
<dl><dt>主角</dt><dd>{esc(c['protagonist_zh'][:220])}…</dd><dt>标志性手法</dt><dd>{esc(c['signature_device_zh'][:260])}…</dd><dt>Reveal</dt><dd>{esc(c['reveal_zh'][:200])}…</dd><dt>AI City 结尾</dt><dd>{esc(c['ai_city_ending_zh'][:200])}…</dd></dl></article>''')
    out.append(f'<section><div class="eyebrow">三个概念</div><h2>三条完全不同的路，选一条走到底</h2><div class="concepts">{"".join(cards)}</div>'
               f'<div class="read md"><p><b>为什么选它：</b>{esc(FIN["winner_rationale_zh"])}</p><p><b>嫁接进来的想法：</b>{esc(FIN["grafted_ideas_zh"])}</p></div></section>')
    # story + timeline strip
    secs = []
    for s in M['shots']:
        pass
    strip = ['<div class="strip-scroll"><div class="strip">']
    last = None
    for s in M['shots']:
        L = s['tc_in'] / 60 * 100
        Wd = (s['tc_out'] - s['tc_in']) / 60 * 100
        if s['section'] != last:
            strip.append(f'<div class="sec" style="left:{L}%;width:{100 - L}%;color:{SEC_COL.get(s["section"], "#8d96a3")}">{esc(s["section"])}</div>')
            last = s['section']
        strip.append(f'<div class="shot" style="left:{L}%;width:{Wd}%;background-image:url({stills_dir}/{s["id"]}.jpg)"><span>{esc(s["id"])}</span></div>')
    strip.append('<div class="ticks">' + ''.join(f'<i style="left:{t / 60 * 100}%"><b>{t}</b></i>' for t in range(0, 61, 5)) + '</div></div></div>')
    out.append(f'<section><div class="eyebrow">60 秒故事</div><h2>{esc(M["title_zh"])}</h2><div class="read md">{"".join(f"<p>{esc(x)}</p>" for x in M["story_zh"].split(chr(10)) if x.strip())}</div>{"".join(strip)}</section>')
    # shot list
    rows = []
    for s in M['shots']:
        rows.append(f'''<div class="shotrow"><img src="{stills_dir}/{s['id']}.jpg" alt="{esc(s['id'])} 代码影片画面" loading="lazy"><div>
<h3><span class="tc">{s['tc_in']:05.2f}–{s['tc_out']:05.2f}</span> {esc(s['id'])} · {esc(s['location_zh'])}</h3>
<div class="facts"><div><b>尺度</b>{esc(s['scale_step'])} · {esc(s['section'])}</div><div><b>景别 / 运镜</b>{esc(s['shot_size_zh'])}；{esc(s['camera_zh'])}</div>
<div><b>动作</b>{esc(s['action_zh'])}</div><div><b>设备</b>{esc(s['device'])}：{esc(s['device_placement_zh'])}</div>
<div><b>Lyra</b>{esc(s['lyra_zh'])}</div><div><b>UI</b>{esc(s['ui_zh'])}</div>
<div><b>声音</b>{esc(s['sound_zh'])}</div><div><b>转场</b>{esc(s['transition_out_zh'])}</div></div></div></div>''')
    out.append(f'<section><div class="eyebrow">分镜表 · Shot List</div><h2>{len(M["shots"])} 个镜头，一条尺度阶梯</h2><p class="note">每一行左侧的画面取自代码版影片的对应时刻；文字是实拍 / 生成版的主剧本。</p><div class="shots">{"".join(rows)}</div></section>')
    # prompts
    for name, title, eb, lead in [('03_GPT-image-2.5_分镜提示词.md', 'GPT-image-2.5 分镜提示词', 'Storyboard', '14 张关键帧，每张一条可直接粘贴的中文提示词，末尾带负向词与生成后检查清单。先读使用方法与全局前缀。'),
                                  ('04_Seedance-2.5_视频提示词.md', 'Seedance 2.5 视频提示词', 'Video', '18 个镜头的视频提示词：时长、摄影机、动作、产品位置、Lyra、UI、光线、首尾帧、连续性与负向词。先读生成与剪辑策略。')]:
        head, blocks, tail = split_prompts(name)
        items = ''.join(f'<details class="prompt"><summary><h3>{esc(t)}</h3></summary><div class="body"><pre>{esc(b)}</pre><button class="copy" type="button">复制提示词</button></div></details>' for t, b in blocks)
        out.append(f'<section><div class="eyebrow">{eb}</div><h2>{title}</h2><p class="note read">{lead}</p>{md_sections(head)}<div class="prompts">{items}</div>{md_sections(tail)}</section>')
    # system + sound
    out.append(f'<section><div class="eyebrow">Claude Code · Motion / UI</div><h2>一套系统，所有节点</h2><div class="stills">' +
               ''.join(f'<img src="{stills_dir}/{n}" alt="" loading="lazy">' for n in ('ui_a.jpg', 'ui_b.jpg', 'ui_c.jpg')) +
               f'</div>{md_sections(doc("05_ClaudeCode_Motion_UI_Brief.md"))}</section>')
    out.append(f'<section><div class="eyebrow">Music + Sound</div><h2>从小调到大调：孤独到连接</h2>{md_sections(doc("06_音乐与声音设计.md"))}</section>')
    out.append(f'<section><div class="eyebrow">Code Film</div><h2>这支片的代码版</h2>{md_sections(doc("07_Claude_Code_动态影片说明.md"), open_first=True)}</section>')
    out.append('<section><div class="eyebrow">Files</div><h2>整套文件</h2><div class="tablewrap"><table class="files"><tbody>' +
               ''.join(f'<tr><td><code>docs/{esc(f)}</code></td><td>{esc(d)}</td></tr>' for f, d in DOCLIST) +
               '<tr><td><code>film/</code></td><td>影片的全部代码：画面引擎、五幕场景、Lyra OS、合成器与总谱</td></tr></tbody></table></div></section>')
    out.append('<footer>LiveX AI City · 概念、导演 Treatment、分镜、提示词、动态影片（画面 / UI / 动效 / 声音）全部由 Claude 生成；影片每一帧与每一个声音都由代码渲染。</footer></div>')
    out.append('''<script>
document.querySelectorAll('.copy').forEach(b => b.addEventListener('click', () => {
  const pre = b.parentElement.querySelector('pre');
  const done = () => { b.textContent = '已复制'; setTimeout(() => b.textContent = '复制提示词', 1600); };
  if (navigator.clipboard) navigator.clipboard.writeText(pre.textContent).then(done, () => { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = '已选中，请按复制'; });
}));
</script>''')
    return tpl.replace('<!--CONTENT-->', '\n'.join(out))


if __name__ == '__main__':
    open(os.path.join(HERE, 'index.html'), 'w', encoding='utf-8').write(page())
    print('wrote', os.path.join(HERE, 'index.html'))

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


def split_prompts(name, level=3):
    """Split a prompt doc into (title, body) blocks on headings of `level`."""
    p = os.path.join(DOCS, name)
    if not os.path.exists(p):
        return '', []
    src = open(p, encoding='utf-8').read()
    marker = '\n' + '#' * level + ' '
    parts = src.split(marker)
    head = parts[0]
    blocks = []
    for part in parts[1:]:
        title, _, body = part.partition('\n')
        blocks.append((title.strip(), body.strip()))
    return head, blocks


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
    out.append(f'<section><div class="eyebrow">60 秒故事</div><h2>{esc(M["title_zh"])}</h2><div class="read md"><p>{esc(M["story_zh"])}</p></div>{"".join(strip)}</section>')
    # shot list
    rows = []
    for s in M['shots']:
        rows.append(f'''<div class="shotrow"><img src="{stills_dir}/{s['id']}.jpg" alt="{esc(s['id'])} 代码影片画面" loading="lazy"><div>
<h3><span class="tc">{s['tc_in']:05.2f}–{s['tc_out']:05.2f}</span> {esc(s['id'])} · {esc(s['location_zh'])}</h3>
<div class="facts"><div><b>尺度</b>{esc(s['scale_step'])} · {esc(s['section'])}</div><div><b>景别 / 运镜</b>{esc(s['shot_size_zh'])}；{esc(s['camera_zh'])}</div>
<div><b>动作</b>{esc(s['action_zh'])}</div><div><b>设备</b>{esc(s['device'])}：{esc(s['device_placement_zh'])}</div>
<div><b>Lyra</b>{esc(s['lyra_zh'])}</div><div><b>UI</b>{esc(s['ui_zh'])}</div>
<div><b>声音</b>{esc(s['sound_zh'])}</div><div><b>转场</b>{esc(s['transition_out_zh'])}</div></div></div></div>''')
    out.append(f'<section><div class="eyebrow">分镜表 · Shot List</div><h2>{len(M["shots"])} 个镜头，一条尺度阶梯</h2><div class="shots">{"".join(rows)}</div></section>')
    # prompts
    for name, title, eb in [('03_GPT-image-2.5_分镜提示词.md', 'GPT-image-2.5 分镜提示词', 'Storyboard'), ('04_Seedance-2.5_视频提示词.md', 'Seedance 2.5 视频提示词', 'Video')]:
        head, blocks = split_prompts(name)
        items = ''.join(f'<details class="prompt"><summary><h3>{esc(t)}</h3></summary><div class="body"><pre>{esc(b)}</pre><button class="copy" type="button">复制提示词</button></div></details>' for t, b in blocks)
        out.append(f'<section><div class="eyebrow">{eb}</div><h2>{title}</h2><div class="read md">{markdown.markdown(head, extensions=["tables"])}</div>{items}</section>')
    # system + sound
    out.append(f'<section><div class="eyebrow">Claude Code · Motion / UI</div><h2>一套系统，所有节点</h2><div class="stills">' +
               ''.join(f'<img src="{stills_dir}/{n}" alt="" loading="lazy">' for n in ('ui_a.jpg', 'ui_b.jpg', 'ui_c.jpg')) +
               f'</div><div class="md">{md("05_ClaudeCode_Motion_UI_Brief.md")}</div></section>')
    out.append(f'<section><div class="eyebrow">Music + Sound</div><h2>从小调到大调：孤独到连接</h2><div class="md">{md("06_音乐与声音设计.md")}</div></section>')
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

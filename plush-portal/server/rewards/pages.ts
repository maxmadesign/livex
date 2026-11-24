/**
 * Server-rendered claim and staff pages: plain HTML and one static stylesheet, no script at all
 * (the CSP forbids it), readable on a 390 × 844 phone. Every dynamic value goes through `esc`:
 * prize names and discount text come from the kiosk and are never trusted as markup.
 *
 * Colours are the brand kit's palette (NVIDIA: black, white, #76B900 and neutral greys). The logo
 * is an <img> drawn as supplied: fixed height, natural aspect ratio, never tinted, and the kit's
 * clear space kept free around it. The only light effect is a soft glow behind the page.
 */
import type { BrandKit } from '../../src/brand/kits';
import type { Lang } from '../../src/core/types';
import { LANGS } from '../../src/core/types';
import { formatCode, isSafeHttpUrl, type ClaimRecord } from '../../src/rewards/protocol';
import { LANG_NAMES, t, tierKey, type TextKey } from './i18n';
import type { RewardCounts, RewardState } from './service';

/* ------------------------------------------------------------- escaping */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for element content and quoted attribute values alike. */
export function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

/* ------------------------------------------------------------- layout */

export interface PageContext {
  kit: BrandKit;
  lang: Lang;
  /** Relative path from the current URL to the site root ('../' for /c/CODE), so the pages also work behind a path prefix. */
  root: string;
  /** Logo files present (else the header shows the event name as text). */
  hasLogo: boolean;
  hasHostLogo: boolean;
  /** Query kept on language links and forms, e.g. '' or '?lang=zh'. */
  langQuery: string;
}

/** Logo height in CSS pixels: wide wordmarks shorter, square emblems taller (same optical weight). */
export const logoHeight = (kit: BrandKit) => (kit.logo.aspect >= 2 ? 52 : 84);

function header(ctx: PageContext): string {
  const mark = ctx.hasLogo
    ? `<img class="logo" src="${esc(ctx.root)}claim-assets/logo" alt="${esc(ctx.kit.eventName)}" height="${logoHeight(ctx.kit)}">`
    : `<span class="wordmark">${esc(ctx.kit.eventName)}</span>`;
  // The kit's clear space is the header's own padding (see renderCss): nothing else is drawn inside it.
  return `<header class="brand">${mark}</header>`;
}

function langLinks(ctx: PageContext, extraQuery = ''): string {
  const links = LANGS.map((lang) => {
    const href = `?${extraQuery ? `${extraQuery}&` : ''}lang=${lang}`;
    const current = lang === ctx.lang ? ' aria-current="true"' : '';
    return `<a href="${esc(href)}" lang="${lang}" hreflang="${lang}"${current}>${esc(LANG_NAMES[lang])}</a>`;
  });
  return `<nav class="langs" aria-label="Language">${links.join('')}</nav>`;
}

function footer(ctx: PageContext, options: { privacy?: boolean; extraQuery?: string } = {}): string {
  const host = ctx.hasHostLogo ? `<img class="host-logo" src="${esc(ctx.root)}claim-assets/host-logo" alt="${esc(ctx.kit.hostName)}" height="22">` : '';
  const privacy = options.privacy === false ? '' : `<p class="privacy">${esc(t(ctx.lang, 'footer.privacy'))}</p>`;
  return `<footer class="foot">${host}${privacy}${langLinks(ctx, options.extraQuery)}</footer>`;
}

function page(ctx: PageContext, title: string, body: string, options: { variant?: 'claim' | 'staff'; footer?: string } = {}): string {
  const variant = options.variant ?? 'claim';
  return `<!doctype html>
<html lang="${ctx.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${esc(ctx.root)}claim-assets/claim.css">
</head>
<body class="${variant}">
<div class="wrap">
${header(ctx)}
${body}
${options.footer ?? footer(ctx)}
</div>
</body>
</html>
`;
}

/* -------------------------------------------------------- claim views */

function remaining(ctx: PageContext, record: ClaimRecord, now: number): string {
  const ms = Date.parse(record.expiresAt) - now;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return t(ctx.lang, 'claim.validMinutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? t(ctx.lang, 'claim.validHour') : t(ctx.lang, 'claim.validHours', { n: hours });
}

function tierBadge(ctx: PageContext, record: ClaimRecord): string {
  return `<span class="tier tier-${record.tier}">${esc(t(ctx.lang, tierKey(record.tier)))}</span>`;
}

function ticket(code: string, status: string, statusClass: string, line = ''): string {
  return `<div class="ticket">${line}<div class="code" aria-label="${esc(code.split('').join(' '))}">${esc(formatCode(code))}</div><div class="status ${statusClass}">${esc(status)}</div></div>`;
}

export function renderChoose(ctx: PageContext, record: ClaimRecord, now: number): string {
  const { lang } = ctx;
  const event = ctx.kit.eventName;
  const prizeButton = `<button class="btn" type="submit" name="choice" value="prize"><span class="btn-main">${esc(t(lang, 'claim.prize'))}</span><span class="btn-sub">${esc(t(lang, 'claim.prize.sub', { prize: record.prizeName }))}</span></button>`;
  const swagSub = record.discountText || t(lang, 'claim.swag.sub');
  const swagButton = `<button class="btn" type="submit" name="choice" value="swag"><span class="btn-main">${esc(t(lang, 'claim.swag'))}</span><span class="btn-sub">${esc(swagSub)}</span></button>`;
  const buttons = record.options === 'both' ? prizeButton + swagButton : record.options === 'prize' ? prizeButton : swagButton;
  const lead = record.options === 'both' ? t(lang, 'claim.pick') : t(lang, 'claim.only');
  const body = `<main class="card">
<p class="eyebrow">${esc(t(lang, 'claim.eyebrow', { event }))}</p>
<h1>${esc(t(lang, 'claim.caught', { prize: record.prizeName }))}</h1>
${tierBadge(ctx, record)}
<p class="lead">${esc(lead)}</p>
<form method="post" action="${esc(`${record.code}/choose${ctx.langQuery}`)}" class="choices">${buttons}</form>
<p class="meta">${esc(t(lang, 'claim.code', { code: formatCode(record.code) }))} · ${esc(remaining(ctx, record, now))}</p>
</main>`;
  return page(ctx, t(lang, 'claim.title', { event }), body);
}

export function renderTicket(ctx: PageContext, record: ClaimRecord, now: number): string {
  const { lang } = ctx;
  const line = `<div class="ticket-plush">${esc(record.prizeName)} ${tierBadge(ctx, record)}</div>`;
  const body = `<main class="card">
<p class="eyebrow">${esc(t(lang, 'ticket.eyebrow'))}</p>
<h1>${esc(t(lang, 'ticket.title'))}</h1>
${ticket(record.code, t(lang, 'ticket.status'), 'ready', line)}
<p class="meta">${esc(remaining(ctx, record, now))}</p>
<p class="tip">${esc(t(lang, 'ticket.tip'))}</p>
</main>`;
  return page(ctx, t(lang, 'ticket.eyebrow'), body);
}

export function renderDiscount(ctx: PageContext, record: ClaimRecord, now: number): string {
  const { lang } = ctx;
  // Re-checked at render time too: the record could come from a hand-edited file.
  const store = record.swagUrl && isSafeHttpUrl(record.swagUrl) ? record.swagUrl : '';
  const action = store
    ? `<a class="btn" href="${esc(store)}" rel="noopener noreferrer"><span class="btn-main">${esc(t(lang, 'swag.open'))}</span></a>`
    : '';
  const body = `<main class="card">
<p class="eyebrow">${esc(t(lang, 'swag.eyebrow'))}</p>
<h1>${esc(record.discountText || t(lang, 'swag.title'))}</h1>
<p class="lead">${esc(t(lang, store ? 'swag.store' : 'swag.counter'))}</p>
${ticket(record.code, t(lang, 'swag.status'), 'ready')}
${action}
<p class="meta">${esc(remaining(ctx, record, now))}</p>
</main>`;
  return page(ctx, t(lang, 'swag.eyebrow'), body);
}

export function renderRedeemed(ctx: PageContext, record: ClaimRecord): string {
  const { lang } = ctx;
  const swag = record.choice === 'swag';
  const body = `<main class="card">
<p class="eyebrow">${esc(t(lang, swag ? 'swag.eyebrow' : 'ticket.eyebrow'))}</p>
<h1>${esc(t(lang, 'done.title'))}</h1>
<p class="lead">${esc(swag ? t(lang, 'done.swag') : t(lang, 'done.prize', { prize: record.prizeName }))}</p>
${ticket(record.code, t(lang, swag ? 'done.status.swag' : 'done.status.prize'), 'done')}
</main>`;
  return page(ctx, t(lang, 'done.title'), body);
}

export function renderExpired(ctx: PageContext, record: ClaimRecord, ttlHours: number): string {
  const { lang } = ctx;
  const body = `<main class="card">
<p class="eyebrow">${esc(ctx.kit.eventName)}</p>
<h1>${esc(t(lang, 'expired.title'))}</h1>
<p class="lead">${esc(t(lang, 'expired.text', { ttl: ttlHours }))}</p>
${ticket(record.code, t(lang, 'expired.status'), 'done')}
</main>`;
  return page(ctx, t(lang, 'expired.title'), body);
}

/** A page with a title, one paragraph and an optional link (not found, slow down, already chosen…). */
export function renderMessage(ctx: PageContext, titleKey: TextKey, textKey: TextKey, link?: { href: string; label: string }): string {
  const { lang } = ctx;
  const action = link ? `<a class="btn" href="${esc(link.href)}"><span class="btn-main">${esc(link.label)}</span></a>` : '';
  const body = `<main class="card">
<p class="eyebrow">${esc(ctx.kit.eventName)}</p>
<h1>${esc(t(lang, titleKey))}</h1>
<p class="lead">${esc(t(lang, textKey))}</p>
${action}
</main>`;
  return page(ctx, t(lang, titleKey), body);
}

/** The claim view that matches the record's state. */
export function renderClaim(ctx: PageContext, record: ClaimRecord, state: RewardState, now: number, ttlHours: number): string {
  if (state === 'redeemed') return renderRedeemed(ctx, record);
  if (state === 'expired') return renderExpired(ctx, record, ttlHours);
  if (record.choice === 'prize') return renderTicket(ctx, record, now);
  if (record.choice === 'swag') return renderDiscount(ctx, record, now);
  return renderChoose(ctx, record, now);
}

/* --------------------------------------------------------- staff page */

export interface StaffView {
  counts: RewardCounts;
  records: { record: ClaimRecord; state: RewardState }[];
  query: string;
  notice: { tone: 'ok' | 'warn'; text: string } | null;
}

const utc = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export function renderStaff(ctx: PageContext, view: StaffView): string {
  const { lang } = ctx;
  const stats = (['issued', 'chosen', 'redeemed', 'expired'] as const)
    .map((key) => `<div class="stat"><span class="stat-n">${view.counts[key]}</span><span class="stat-l">${esc(t(lang, `staff.${key}`))}</span></div>`)
    .join('');
  const notice = view.notice ? `<p class="notice ${view.notice.tone}" role="status">${esc(view.notice.text)}</p>` : '';
  const rows = view.records
    .map(({ record, state }) => {
      const choice = record.choice ? t(lang, record.choice === 'prize' ? 'staff.choice.prize' : 'staff.choice.swag') : t(lang, 'staff.choice.none');
      const action =
        state === 'chosen'
          ? `<form method="post" action="/staff/rewards/${esc(record.code)}/redeem${ctx.lang === 'en' ? '' : `?lang=${ctx.lang}`}"><button class="btn btn-small" type="submit">${esc(t(lang, 'staff.redeem'))}</button></form>`
          : '';
      return `<li class="row state-${state}">
<span class="row-code">${esc(formatCode(record.code))}</span>
<span class="row-plush">${esc(record.prizeName)} <span class="tier tier-${record.tier}">${esc(t(lang, tierKey(record.tier)))}</span></span>
<span class="row-choice">${esc(choice)}</span>
<span class="row-state">${esc(t(lang, `staff.state.${state}`))}</span>
<span class="row-time">${esc(utc(record.issuedAt))}</span>
<span class="row-action">${action}</span>
</li>`;
    })
    .join('\n');
  const heading = view.query ? t(lang, 'staff.matches', { q: view.query }) : t(lang, 'staff.recent');
  const empty = view.records.length === 0 ? `<p class="lead">${esc(t(lang, view.query ? 'staff.noMatch' : 'staff.none'))}</p>` : '';
  const clear = view.query ? `<a class="link" href="/staff/rewards${ctx.lang === 'en' ? '' : `?lang=${ctx.lang}`}">${esc(t(lang, 'staff.clear'))}</a>` : '';
  const body = `<main class="card staff-card">
<div class="staff-head"><h1>${esc(t(lang, 'staff.title'))}</h1><a class="link" href="/staff/rewards.csv">${esc(t(lang, 'staff.csv'))}</a></div>
<div class="stats">${stats}</div>
<form method="get" action="/staff/rewards" class="search" role="search">
<label for="q">${esc(t(lang, 'staff.search'))}</label>
<input id="q" name="q" value="${esc(view.query)}" placeholder="${esc(t(lang, 'staff.searchHint'))}" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20">
${ctx.lang === 'en' ? '' : `<input type="hidden" name="lang" value="${ctx.lang}">`}
<button class="btn btn-small" type="submit">${esc(t(lang, 'staff.find'))}</button>
${clear}
</form>
${notice}
<h2>${esc(heading)}</h2>
<ul class="rows">
<li class="row row-headings" aria-hidden="true"><span>${esc(t(lang, 'staff.col.code'))}</span><span>${esc(t(lang, 'staff.col.plush'))}</span><span>${esc(t(lang, 'staff.col.choice'))}</span><span>${esc(t(lang, 'staff.col.status'))}</span><span>${esc(t(lang, 'staff.col.issued'))}</span><span></span></li>
${rows}
</ul>
${empty}
</main>`;
  return page(ctx, t(lang, 'staff.title'), body, {
    variant: 'staff',
    footer: footer(ctx, { privacy: false, extraQuery: view.query ? `q=${encodeURIComponent(view.query)}` : '' }),
  });
}

export function renderStaffMessage(ctx: PageContext, titleKey: TextKey, textKey: TextKey, link?: { href: string; label: string }): string {
  const { lang } = ctx;
  const action = link ? `<a class="btn" href="${esc(link.href)}"><span class="btn-main">${esc(link.label)}</span></a>` : '';
  const body = `<main class="card">
<h1>${esc(t(lang, titleKey))}</h1>
<p class="lead">${esc(t(lang, textKey))}</p>
${action}
</main>`;
  return page(ctx, t(lang, titleKey), body, { variant: 'staff', footer: footer(ctx, { privacy: false }) });
}

/* --------------------------------------------------------------- CSV */

/** One CSV cell: quoted, quotes doubled, and a leading = + - @ (spreadsheet formulas) defused. */
function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const CSV_COLUMNS = ['code', 'status', 'choice', 'prizeName', 'tier', 'prizeId', 'themeId', 'lang', 'options', 'issuedAt', 'expiresAt', 'chosenAt', 'redeemedAt'] as const;

export function renderCsv(rows: { record: ClaimRecord; state: RewardState }[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const { record, state } of rows) {
    const values: Record<(typeof CSV_COLUMNS)[number], string | number | null> = {
      code: formatCode(record.code),
      status: state,
      choice: record.choice,
      prizeName: record.prizeName,
      tier: record.tier,
      prizeId: record.prizeId,
      themeId: record.themeId,
      lang: record.lang,
      options: record.options,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      chosenAt: record.chosenAt,
      redeemedAt: record.redeemedAt,
    };
    lines.push(CSV_COLUMNS.map((column) => csvCell(values[column])).join(','));
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------ styles */

export interface StyleOptions {
  kit: BrandKit;
  /** Brand font weights whose files exist (served from claim-assets/font/<weight>). */
  fontWeights: number[];
}

/** The one stylesheet of the claim and staff pages (served from a static route, so the CSP needs no inline styles). */
export function renderCss({ kit, fontWeights }: StyleOptions): string {
  const p = kit.palette;
  const faces = kit.font.family
    ? fontWeights
        .map((weight) => `@font-face{font-family:"${kit.font.family.replace(/["\\]/g, '')}";src:url("font/${weight}") format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`)
        .join('\n')
    : '';
  const family = faces ? `"${kit.font.family.replace(/["\\]/g, '')}", ${kit.font.fallback}` : kit.font.fallback;
  const logoH = logoHeight(kit);
  const clear = Math.round(logoH * kit.logo.clearSpace);
  return `${faces}
:root{color-scheme:dark;--green:${p.green};--green-deep:${p.greenDeep};--green-light:${p.greenLight};--black:${p.black};--white:${p.white};--g950:${p.gray950};--g900:${p.gray900};--g800:${p.gray800};--g700:${p.gray700};--g600:${p.gray600};--g500:${p.gray500};--g400:${p.gray400};--g300:${p.gray300};--g200:${p.gray200};--g100:${p.gray100}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;background:var(--black)}
html:lang(ja){word-break:auto-phrase}
h1,.btn-main{text-wrap:balance}
.lead,.privacy{text-wrap:pretty}
body{margin:0;min-height:100vh;min-height:100dvh;color:var(--white);font-family:${family};font-size:17px;line-height:1.45;-webkit-font-smoothing:antialiased;
background:var(--black) radial-gradient(120% 55% at 50% -8%,rgba(118,185,0,.26),rgba(118,185,0,.07) 45%,transparent 72%) no-repeat}
.wrap{width:100%;max-width:460px;margin:0 auto;padding:max(12px,env(safe-area-inset-top)) 16px max(20px,env(safe-area-inset-bottom));min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
.staff .wrap{max-width:980px}
.brand{display:flex;justify-content:center;align-items:center;padding:${clear}px 0;min-height:${logoH + 2 * clear}px}
.logo{display:block;height:${logoH}px;width:auto;max-width:100%;object-fit:contain}
.wordmark{font-weight:800;font-size:30px;letter-spacing:.04em;color:var(--white)}
.card{background:var(--g950);border:1px solid var(--g800);border-top:3px solid var(--green);padding:24px 20px 22px;margin:0 0 20px}
.eyebrow{margin:0 0 10px;color:var(--green);font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{margin:0 0 12px;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-.01em;overflow-wrap:anywhere}
h2{margin:22px 0 10px;font-size:15px;font-weight:700;color:var(--g300);letter-spacing:.06em;text-transform:uppercase}
.lead{margin:14px 0 18px;color:var(--g200)}
.meta{margin:16px 0 0;color:var(--g400);font-size:14px;text-align:center}
.tip{margin:10px 0 0;color:var(--g400);font-size:13px;text-align:center}
.tier{display:inline-block;padding:2px 9px;border:1px solid var(--g600);color:var(--g200);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;vertical-align:middle;white-space:nowrap}
.tier-rare{border-color:var(--g300);color:var(--white)}
.tier-epic{border-color:var(--green-light);color:var(--green-light)}
.tier-legendary{border-color:var(--green);background:var(--green);color:var(--black)}
.choices{display:flex;flex-direction:column;gap:12px;margin:0}
.btn{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;width:100%;min-height:64px;margin:0;padding:14px 48px 14px 18px;position:relative;
background:var(--green);color:var(--black);border:0;border-radius:2px;font:inherit;font-size:18px;font-weight:700;line-height:1.25;text-align:left;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
.btn::after{content:"";position:absolute;right:20px;top:50%;width:10px;height:10px;border-top:3px solid var(--black);border-right:3px solid var(--black);transform:translateY(-50%) rotate(45deg)}
.btn:hover{background:var(--green-light)}
.btn:active{background:var(--green-deep)}
.btn:focus-visible{outline:3px solid var(--white);outline-offset:3px}
.btn-sub{font-size:14px;font-weight:400}
.card > .btn{margin-top:18px}
.btn-small{display:inline-flex;width:auto;min-height:40px;padding:8px 16px;font-size:15px}
.btn-small::after{display:none}
.ticket{margin:20px 0 0;padding:18px 12px 20px;border:1px dashed var(--g600);background:var(--black);text-align:center}
.ticket-plush{margin:0 0 10px;color:var(--g200);font-size:16px;font-weight:700;overflow-wrap:anywhere}
.code{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:clamp(30px,10.5vw,48px);font-weight:700;letter-spacing:.06em;line-height:1.1;white-space:nowrap;color:var(--white)}
.status{display:inline-block;margin-top:12px;padding:5px 14px;font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.status.ready{background:var(--green);color:var(--black)}
.status.done{background:var(--g700);color:var(--white)}
.foot{margin-top:auto;padding:8px 0 4px;text-align:center;color:var(--g400);font-size:13px}
.host-logo{display:block;height:22px;width:auto;margin:0 auto 14px;object-fit:contain}
.privacy{margin:0 0 10px}
.langs{display:flex;justify-content:center;gap:18px}
.langs a{color:var(--g300);text-decoration:none;padding:8px 2px}
.langs a[aria-current]{color:var(--white);font-weight:700;border-bottom:2px solid var(--green)}
.link{color:var(--green);font-weight:700;text-decoration:none}
.link:hover{text-decoration:underline}
.staff-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.staff-head h1{margin:0}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:18px 0}
.stat{background:var(--black);border:1px solid var(--g800);padding:12px 14px}
.stat-n{display:block;font-size:30px;font-weight:800;line-height:1.1;color:var(--white)}
.stat-l{display:block;margin-top:2px;color:var(--g400);font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.stat:first-child .stat-n{color:var(--green)}
.search{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 6px}
.search label{width:100%;color:var(--g300);font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.search input{flex:1 1 180px;min-height:44px;padding:8px 12px;background:var(--black);color:var(--white);border:1px solid var(--g600);border-radius:2px;font:inherit;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:18px;letter-spacing:.06em;text-transform:uppercase}
.search input::placeholder{color:var(--g500);text-transform:none;letter-spacing:0}
.search input:focus{outline:2px solid var(--green);outline-offset:1px}
.notice{margin:14px 0 0;padding:10px 14px;border-left:4px solid var(--green);background:var(--g900)}
.notice.warn{border-left-color:var(--g300)}
.rows{list-style:none;margin:0;padding:0}
.row{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:12px 0;border-top:1px solid var(--g800)}
.row-headings{display:none}
.row-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:19px;font-weight:700;letter-spacing:.05em}
.row-plush{grid-column:1 / -1;color:var(--g200);overflow-wrap:anywhere}
.row-choice,.row-time{color:var(--g400);font-size:14px}
.row-state{justify-self:end;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--g300)}
.state-chosen .row-state{color:var(--green)}
.row-action{grid-column:1 / -1}
.row-action:empty{display:none}
.row-action form{margin:4px 0 0}
@media (min-width:720px){
.stats{grid-template-columns:repeat(4,1fr)}
.search label{width:auto}
.row{grid-template-columns:130px minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) 140px 170px;align-items:center}
.row-headings{display:grid;color:var(--g400);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-top:0}
.row-plush,.row-action{grid-column:auto}
.row-state{justify-self:start}
.row-action:empty{display:block}
.row-action form{margin:0}
}
@media (prefers-reduced-motion:no-preference){.btn{transition:background-color .15s ease}}
`;
}

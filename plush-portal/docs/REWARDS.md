# Prize claims (QR codes)

After a real win (never a demo round) the win card shows a QR code. The visitor scans it with their
own phone and picks **one** reward on the claim page: collect the plush at the booth, or a discount
on swag. Booth staff mark the code redeemed on the prize desk. The server keeps codes only: no
names, e-mail addresses, phone numbers or camera data.

```
kiosk (game, this machine)                 API server (server/)                      visitor's phone
──────────────────────────                 ──────────────────────                    ───────────────
real win ──POST /api/rewards/issue──────▶  code + record in rewards.json
         ◀── { code, url, reach } ───────  (loopback or admin token only)
win card shows QR(url) ─────────────────────────────────────────────────────────────▶ scans it
                                           GET  /c/:code         claim page ◀──────── opens it
                                           POST /c/:code/choose  "prize" | "swag" ◀── one tap, final
                                           GET  /c/:code         ticket / discount ─▶ shows it at the booth
booth staff ── /staff/rewards ──────────▶  search code → "Mark redeemed"
```

The wire format (request / response bodies, error codes, code alphabet, limits) is in
`src/rewards/protocol.ts`; the kiosk's settings are the `rewards` section of
`src/settings/spec.ts`. This page covers the server: `server/rewards/`.

## Running it

Nothing to set up for a first try: rewards are on by default.

```
npm run build && npm start        # game + API on 127.0.0.1:8787, claim pages also on 0.0.0.0:8788
```

The start-up log says where the QR codes point:

```
info rewards enabled="true" brand="gtc" codes="12" ttlHours="24" store=".data/rewards.json"
info claim pages url="http://192.168.1.20:8788/c/<code>" reach="lan" listener="0.0.0.0:8788"
```

`reach` is what the kiosk is told (`GET /api/rewards/status`), and it decides what the win card does:

| reach | QR points to | Who can open it |
| --- | --- | --- |
| `external` | `PLUSH_CLAIM_PUBLIC_URL`, or the kiosk's own `rewards.claimUrl` template | anyone with internet access (if that URL really forwards here) |
| `lan` | the claim listener on this machine's first LAN IPv4 address | phones on the same network, **if** the network lets them talk to each other |
| `loopback` | `127.0.0.1` (no LAN address, listener off or its port busy) | only this machine; the kiosk says so instead of drawing a useless QR |

## Configuration

Server side, in `.env` (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PLUSH_REWARDS` | `on` | `off`: no new codes (`issue` answers `rewards_off`, status says `enabled: false`) and no claim listener. Codes issued before stay viewable and redeemable on the main server. |
| `PLUSH_CLAIM_PORT` | `8788` | Port of the claim listener. `0` picks any free port (tests). |
| `PLUSH_CLAIM_LAN` | `on` | `off`: no claim listener; QR links point at the main server's loopback URL (`reach: loopback`) unless a public URL is set. |
| `PLUSH_CLAIM_PUBLIC_URL` | – | Base URL the QR codes use instead, e.g. `https://claim.example.com` (`reach: external`). http(s), no credentials, query or fragment; a path prefix is fine. Invalid values are ignored with a start-up note. |
| `PLUSH_REWARD_TTL_HOURS` | `24` | How long a code stays valid (1–720). |
| `PLUSH_BRAND` | `gtc` | Brand kit of the claim and staff pages: `gtc` or `neutral`. Keep it equal to the build's `VITE_BRAND`. |
| `PLUSH_DATA_DIR` | `.data` | Where `rewards.json` is kept (same folder as the replaced OpenAI key). |
| `PLUSH_ADMIN_TOKEN` | – | Lets a device that is not the booth machine issue codes and open the prize desk. |
| `PLUSH_TRUST_PROXY` | `false` | Rate limits use the first `X-Forwarded-For` address. Only behind a reverse proxy that sets it. |

Kiosk side (Settings → Rewards, stored in the browser): `rewards.mode` (`gtc` theme only / all / off),
`rewards.options` (`both` / `prize` / `swag`), `rewards.claimUrl` (an https URL template with
`{code}`; the code is still issued and tracked here), `rewards.swagUrl`, `rewards.discountText`,
`rewards.qrSeconds`.

## Booth setup

### The easy case: booth network

Kiosk machine and visitors' phones on one network that lets devices reach each other (the booth's
own router or hotspot). Start the server, check the `claim pages` log line shows `reach="lan"`, scan
a test QR with a phone. Allow incoming TCP on the claim port (8788) in the machine's firewall.

Only the claim listener faces the network. It serves `/c/*` and `/claim-assets/*` and answers 404
for everything else: the game, `/api` and `/staff` are not reachable through it. The main server
stays on `127.0.0.1` unless you change `PLUSH_API_HOST`.

The LAN link is plain `http://`; phones show "Not secure" in the address bar but the page works
(it needs no camera, storage or script).

### Event Wi-Fi: client isolation

Most conference Wi-Fi networks isolate clients: a phone can reach the internet but not another
device on the same Wi-Fi, and many visitors are on mobile data anyway. A `http://192.168.x.x:8788`
link then simply times out. Test it with a phone **on the visitor network** before the doors open.
If it fails, use one of these:

1. **External URL (recommended for events).** Put the claim listener behind an https reverse proxy
   or tunnel that forwards `/c/*` and `/claim-assets/*` to `http://<kiosk>:8788`, and set
   `PLUSH_CLAIM_PUBLIC_URL=https://claim.example.com`. Forward only the claim listener's port: it
   serves nothing else, so the game and the staff page stay private. If the proxy sets
   `X-Forwarded-For` and the claim port is not reachable directly, set `PLUSH_TRUST_PROXY=true` so
   the per-visitor rate limit sees real addresses.
2. **Own claim system.** Set the kiosk's `rewards.claimUrl` to a template such as
   `https://example.com/claim?c={code}`. The code is still issued, stored and redeemable here;
   whatever runs at that URL must show the visitor their code (for example by proxying `/c/{code}`).
3. **Booth hotspot.** A separate booth network without isolation (visitors join it to claim).

### Staff devices

- **On the booth machine:** open `http://127.0.0.1:8787/staff/rewards`. Requests made on this
  machine need no login (same rule as replacing the OpenAI key in Settings).
- **On a tablet or phone:** the main server must listen on the network
  (`PLUSH_API_HOST=0.0.0.0`; this also exposes the game and API there) and `PLUSH_ADMIN_TOKEN` must
  be set. Open `http://<booth-ip>:8787/staff/rewards?token=<admin token>` **once**: the token is
  exchanged for a random HttpOnly, SameSite=Strict cookie (12 hours, kept in server memory, so a
  restart signs everyone out) and removed from the address bar. Scripts can send
  `Authorization: Bearer <admin token>` instead.

## Visitor flow

1. **Choose** (`GET /c/:code`): the event logo, "You caught *Neon Byte*!", the rarity, and one
   button per option the code has: "Collect your plush at the booth" and / or "Get your swag
   discount" (with the kiosk's `discountText`). The choice is final; a second tap on the same button
   is harmless, a different option answers "Your choice is already saved".
2. **Prize ticket**: "Show this screen to booth staff", the code in large `XXXX-XXXX` letters, the
   plush and its rarity, "Ready to collect" and the time left.
3. **Swag discount**: the discount text (or "Your swag discount"), the code, and either an
   "Open the swag store" button (`swagUrl`) or "Show this screen at the swag counter".
4. **Already collected** once staff redeemed it; **This code has expired** after the TTL;
   **Code not found** for anything else.

Text is English, Chinese or Japanese: the language the game was in when the code was issued,
switchable at the bottom (`?lang=en|zh|ja`, kept through the form). Unknown codes follow the
browser's language.

## Staff workflow

1. The visitor shows the ticket or discount screen.
2. Type the code (case, dashes, `O`/`0` and `I`/`L`/`1` do not matter) into **Code** and press
   **Find**, or find it in **Most recent codes**.
3. Check the plush / choice in the row, hand over the prize or apply the discount, press
   **Mark redeemed**. The visitor's page now says "Already collected".

The counters show **Issued**, **Chosen** (a choice was made, redeemed ones included), **Redeemed**
and **Expired** (never redeemed in time). **Download CSV** exports every stored code (code, status,
choice, plush, rarity, prize id, theme, language, options and the four timestamps; no session ids).
A code can only be redeemed after the visitor chose a reward and before it expires.

## HTTP interface

| Route | Who | Answers |
| --- | --- | --- |
| `GET /api/rewards/status` | anyone | `RewardsStatusBody` (`canIssue` true for loopback or admin token) |
| `POST /api/rewards/issue` | loopback or admin token | `IssueResponseBody`; same session + round → same code, `repeated: true` |
| `GET /c/:code` | public (main server and claim listener) | claim page (HTML); 404 unknown, 410 expired; `Accept: application/json` → `{ code, state, choice, options, expiresAt }` |
| `POST /c/:code/choose` | public | form field `choice=prize\|swag` → 303 to the page; 409 `already_chosen`, 400 option not offered |
| `GET /claim-assets/claim.css`, `/logo`, `/host-logo`, `/font/:weight` | public | stylesheet and brand files |
| `GET /staff/rewards` | loopback, admin token or staff cookie | prize desk (`?q=` search, `?token=` sign-in) |
| `POST /staff/rewards/:code/redeem` | same, from a page of this origin | 303 back to the desk; JSON with `Accept: application/json` |
| `GET /staff/rewards.csv` | same | CSV download |

API errors use `{ error: { code, message } }` with these codes:

| Code | Status | When |
| --- | --- | --- |
| `rewards_off` | 503 | `PLUSH_REWARDS=off` |
| `forbidden` | 403 | not loopback and no admin token; foreign `Origin`; staff post from another origin |
| `bad_request` | 400 / 413 | body is not JSON, fails validation, or is larger than 4 KB |
| `rate_limited` | 429 | see limits below (`Retry-After` is set) |
| `storage` | 500 | `rewards.json` could not be written: **nothing was issued** (or changed) |
| `not_found` | 404 | unknown code / route |
| `expired` / `already_chosen` / `already_redeemed` | 410 / 409 / 409 | state rules |

## Storage

`<PLUSH_DATA_DIR>/rewards.json` (`.data/` by default, git-ignored): `{ "version": 1, "records": [...] }`
with one `ClaimRecord` per code. It is loaded once at start into an in-memory index (by code and by
session + round) and rewritten as a whole for every change: temp file, then rename, file mode 0600
in a 0700 folder. A change only counts once the file was written; if writing fails the request
answers `storage` and memory and disk keep the previous state.

At start, records whose code expired more than 30 days ago are dropped, malformed records are
skipped (both counted in the log line), and a file that is not valid JSON is renamed to
`rewards.json.corrupt-<time>` and a new one is started. A file that exists but can not be read
blocks new codes instead of being overwritten.

To wipe all codes, stop the server and delete `rewards.json`.

## Privacy

Stored per code: the code, a random page-load id and round number (for de-duplication), prize id,
plush name and rarity, theme, language, the offered options, the discount text and swag link, and the
times it was issued, chosen, redeemed and expires. Nothing about the visitor: no name, e-mail, phone
number, IP address, user agent, cookie or camera data. The claim pages set no cookies and load
nothing from other sites. Logs never contain codes at the default `info` level (only counts by
rarity, theme and choice); `PLUSH_LOG_LEVEL=debug` adds the code to the issue / choose / redeem
lines. The only cookie is the staff sign-in cookie, a random value with no personal meaning.

## Security

- **Issuing** needs a request made on this machine (`isLocalRequest`: loopback socket, no forwarding
  header naming another client, loopback `Host` and `Origin`, which also defeats DNS rebinding) or
  the admin token. The `/api` origin check refuses foreign pages before that. Bodies are validated
  strictly: unknown fields, wrong enums, over-long text, control and bidi-override characters, and
  URLs other than `http(s)` without credentials are refused.
- **Codes** are 8 symbols of Crockford base32 from the OS CSPRNG (40 bits, uniform). With the
  claim-page limit of 40 requests per minute and address, guessing one valid code among thousands
  would take years per address.
- **Pages** carry `Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self';
  font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` (no script at all,
  no inline style), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Cache-Control: no-store`, `Cross-Origin-Resource-Policy: same-origin` and a restrictive
  `Permissions-Policy`. Every value (plush names and discount text come from the kiosk) is
  HTML-escaped; the swag link is re-checked before it is rendered and opens with
  `rel="noopener noreferrer"`. The CSV defuses spreadsheet formulas (`=`, `+`, `-`, `@`).
- **Referrer policy**: claim pages send `no-referrer`. Staff pages send `same-origin`: under
  `no-referrer` browsers send `Origin: null` with form posts, which would make the booth machine
  fail its own same-origin and loopback checks. Neither leaks a Referer to another site.
- **Staff posts** must come from this origin: `Sec-Fetch-Site: same-origin` when the browser sends
  it, else an `Origin` naming this host; `Origin: null` is refused. Requests with neither header are
  not browsers (curl), so they can not be cross-site forgeries.
- **Rate limits** (per client address, token bucket): issuing 10/min, claim pages 40/min, claim
  assets 240/min, staff routes 120/min.
- **Claim listener**: only `/c/*` and `/claim-assets/*`; it can not issue, redeem or serve the game.
- Use https (`PLUSH_CLAIM_PUBLIC_URL` behind a TLS proxy) when the claim page crosses the internet.

## Brand

The pages use the server's brand kit (`PLUSH_BRAND`, `src/brand/kits.ts`): its event name, palette
(NVIDIA: black background, white text, `#76B900` buttons with black text, neutral greys) and logo
slot. The logo is looked up on disk like the game does it: the official file
(`public/assets/brand/gtc/gtc-logo.svg` or `.png`, or the same path in the build) if present, else
the original placeholder `gtc-logo.placeholder.svg`. It is served byte for byte and drawn at a fixed
height with its natural aspect ratio and the kit's clear space around it; the only light effect is
a soft green glow behind the page. The host logo (`nvidia-logo.svg`) appears in the footer only
when the official file exists. The brand font is used when its files exist under `fonts/`, else
Inter / Helvetica / Arial. New files are picked up within seconds, no restart needed. The neutral
kit (`PLUSH_BRAND=neutral`) shows "GPU Party" and its own emblem and no GTC or NVIDIA marks.

## Limits

- One server process per data folder: the index lives in memory and every change rewrites the
  file, so two servers sharing `rewards.json` would overwrite each other. Thousands of codes are
  fine; it is not built for hundreds of thousands.
- The server does not draw QR codes; the kiosk does (from `url`).
- De-duplication is per page load + round. A reload of the game starts a new session.
- Expiry uses the server clock. Redeemed codes stay redeemed after their expiry time.
- Staff can not redeem a code before the visitor chose a reward, nor after it expired.
- Rate limits are per address: many visitors behind one NAT share a bucket (40 page views per
  minute is still plenty for a booth).
- `reach: lan` is a guess (first non-internal IPv4 address); with several networks or a VPN,
  set `PLUSH_CLAIM_PUBLIC_URL` to the right one.

## Verified / not verified

Verified by running it (headless Chromium on Linux, keyless server):

- Unit tests `tests/unit/server/rewards.test.ts` and `rewards-http.test.ts`: code format,
  distribution and uniqueness; strict validation; de-duplication; loopback vs LAN address vs admin
  token; forwarded and DNS-rebinding requests; rate limits; storage failure (simulated and a data
  folder that can not be created); choose once; redeem once; expiry; restart persistence; corrupt
  and malformed files; HTML escaping of a `<script>` plush name; CSP and the other headers; staff
  token cookie and same-origin redeem; CSV formula defusing; LAN listener isolation (only `/c/*`
  and assets); claim base selection; a busy claim port; the neutral kit; official logo / font files
  (stand-in files in a temp folder).
- Manual smoke on a real server process: issued codes with curl from loopback (and a 403 from the
  LAN address), opened the claim pages through the claim listener's LAN address at 390 × 844,
  chose prize and swag, redeemed on the prize desk (booth machine at 1280 wide and 390 wide),
  restarted on the same data folder (all states came back, expired page shown), neutral kit, staff
  sign-in with `?token=` from a non-loopback address and redeem from there, and a busy claim port
  with `--serve-dist` (logged, main server kept serving, QR fallback to loopback).

Not verified:

- Real phones (iOS Safari, Android Chrome) and a real event Wi-Fi with client isolation.
- A reverse proxy or tunnel in front of `PLUSH_CLAIM_PUBLIC_URL`, and the claim pages over the
  optional HTTPS listener.
- The official GTC / NVIDIA artwork and font files (not in the repo; only stand-ins were tested).
- The kiosk side (win card, QR drawing, settings) together with this server: that is a separate
  workstream and was not run against these routes here.

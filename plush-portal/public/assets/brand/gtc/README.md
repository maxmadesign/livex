# GTC brand kit files

Drop the official artwork here (from the event's brand portal). The game picks them up on the
next page load; no code changes are needed. See `docs/BRAND.md`.

| File | Used for | Missing → |
|---|---|---|
| `gtc-logo.svg` (or `gtc-logo.png`) | Back-wall LED panel, attract screen, loading screen, win card, claim page | `gtc-logo.placeholder.svg` (original stand-in) |
| `nvidia-logo.svg` (or `nvidia-logo.png`) | Secondary host mark (marquee, claim page footer) | not drawn |
| `fonts/NVIDIASans-Regular.woff2`, `fonts/NVIDIASans-Bold.woff2` | Brand typeface for the GTC theme UI and claim page | Inter / Helvetica / Arial |

Use white-on-dark (reversed) versions: the theme draws them on black. Logos are drawn as supplied
(never recoloured, stretched or animated); light effects pass behind them, not over them.

The event and host marks (logos, names, the NVIDIA Sans typeface) belong to their owner: whoever
deploys the machine with this kit is responsible for having permission to show them and for using
the files as the event's brand guidelines require. The game shows no notice about this in its UI.
Settings → Themes & Toys → Brand kit shows which files were found (official or placeholder logo,
brand font or fallback). Public demo copies are built with `VITE_BRAND=neutral` instead, which
carries no real event, host or logo.

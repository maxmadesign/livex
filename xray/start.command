#!/bin/bash
# X-Ray Mirror on this computer. Double-click on a Mac (the first time: right-click, Open).
# It serves this folder to this computer only and opens the page in the browser. A page from http://localhost keeps
# its camera permission; a file opened by double-click is asked again every time and cannot load the data folder.
# With the offline copies in ./vendor (tools/fetch_vendor.sh) no internet is needed.
cd "$(dirname "$0")" || exit 1
port=8010
while lsof -i ":$port" >/dev/null 2>&1; do port=$((port + 1)); done
query=""; [ -f vendor/three.module.js ] && query="?local"
url="http://localhost:$port/$query"
echo "X-Ray Mirror: $url"
echo "Keep this window open while you use it. Close it to stop."
( sleep 1
  if [ -d "/Applications/Google Chrome.app" ]; then open -a "Google Chrome" "$url"
  elif command -v open >/dev/null 2>&1; then open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"; fi ) &
# A Mac without the developer tools has a python3 that only offers to install them, so Ruby (always there) is used then.
py=$(command -v python3 2>/dev/null)
if [ -n "$py" ] && { [ "$(uname)" != "Darwin" ] || [ "$py" != "/usr/bin/python3" ] || xcode-select -p >/dev/null 2>&1; }; then
  exec "$py" -m http.server "$port" --bind 127.0.0.1
elif command -v ruby >/dev/null 2>&1; then
  exec ruby -run -e httpd . -p "$port" -b 127.0.0.1
else
  echo "Neither python3 nor ruby was found. Any static web server pointed at this folder will do."; read -r _
fi

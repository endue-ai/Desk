#!/bin/sh
# One screenshot of the preview: dev/shot.sh <query> <out.png> [width] [height]. Headless Chromium
# runs the page's timers in virtual time, so the scan finishes before the picture.
SHELL_BIN="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell"
exec "$SHELL_BIN" --headless --no-sandbox --hide-scrollbars --force-device-scale-factor=2 \
  --window-size="${3:-1280},${4:-900}" --virtual-time-budget=20000 \
  --screenshot="$2" "http://localhost:${PORT:-4351}/ui/index.html?$1" 2>/dev/null

#!/bin/sh
# Files made by real tools from the sample site in site/ (hand-written; its two images drawn by
# Pillow below), for real-files.test.ts: Blink's MHTML and DOM (headless Chrome, capture.mjs),
# a WARC from GNU Wget and a Windows shortcut from pylnk3 (both in Docker, which needs network
# to install them). Run on macOS from anywhere: sh plugins/web/tests/fixtures/real.sh
set -eu
cd "$(dirname "$0")"
python3 -c '
from PIL import Image, ImageDraw
sun = Image.new("RGB", (160, 90), (40, 90, 160))
ImageDraw.Draw(sun).ellipse((50, 15, 110, 75), fill=(240, 200, 60))
sun.save("site/assets/sun.png")
Image.new("RGB", (8, 8), (230, 230, 240)).save("site/assets/bg.jpg", quality=80)'
python3 -m http.server 8762 --bind 127.0.0.1 --directory site >/dev/null 2>&1 &
server=$!
trap 'kill $server' EXIT
sleep 1
node capture.mjs http://127.0.0.1:8762/index.html blink
mv blink.dom.html site/saved-by-chrome.html
docker run --rm -v "$PWD/site:/site:ro" -v "$PWD:/out" debian:bookworm-slim sh -c '
  apt-get update -qq && apt-get install -y -qq wget python3 >/dev/null
  cd /site && (python3 -m http.server 8000 >/dev/null 2>&1 &) && sleep 1 && cd /tmp
  wget -q -p --warc-file=/out/wget http://127.0.0.1:8000/index.html http://127.0.0.1:8000/other.html || true'
docker run --rm -v "$PWD:/out" python:3.12-slim sh -c '
  pip install -q pylnk3 && python3 -c "import pylnk3; pylnk3.for_file(
    r\"C:\\Users\\Public\\Documents\\report.txt\", \"/out/pylnk3.lnk\", arguments=\"/view\",
    description=\"Quarterly report\", work_dir=r\"C:\\Users\\Public\\Documents\")"'

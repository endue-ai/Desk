#!/usr/bin/env bash
# Rebuilds the PowerPoint 97-2003 fixtures: deck.pptx from python-pptx (make.py), then LibreOffice
# converts it to deck.ppt (../strip.py drops the thumbnail). Needs Docker. With a folder argument it
# writes there instead, and adds deck.pps and deck.pot for the live check.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mkdir -p "${1:-$here}" && cd "${1:-$here}" && pwd)"
extra=$([[ "$out" == "$here" ]] && echo no || echo yes)
image="${SLIDES_FIXTURE_IMAGE:-desk-slides-lo:156}"
if ! docker image inspect "$image" > /dev/null 2>&1; then
  docker build -t "$image" - << 'DOCKERFILE'
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress-nogui python3-pip python3-lxml python3-pil fonts-dejavu-core fonts-liberation \
    && pip install --break-system-packages --no-deps python-pptx XlsxWriter typing_extensions \
    && rm -rf /var/lib/apt/lists/*
DOCKERFILE
fi
docker run --rm -v "$here/..:/f:ro" -v "$out:/out" -e EXTRA="$extra" -w /tmp "$image" sh -c '
  set -e
  # No thumbnails: the .ppt would carry a 400 KB bitmap in its summary stream.
  mkdir -p /tmp/profile/user
  cat > /tmp/profile/user/registrymodifications.xcu << XCU
<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema">
<item oor:path="/org.openoffice.Office.Common/Save/Document"><prop oor:name="GenerateThumbnail" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
XCU
  lo() { soffice -env:UserInstallation=file:///tmp/profile --headless --convert-to "$@" > /dev/null 2>&1; }
  python3 /f/ppt/make.py /tmp/deck.pptx
  lo ppt --outdir /tmp /tmp/deck.pptx
  python3 /f/strip.py /tmp/deck.ppt
  cp /tmp/deck.pptx /tmp/deck.ppt /out/
  if [ "$EXTRA" = yes ]; then
    lo "pps:MS PowerPoint 97 AutoPlay" --outdir /tmp /tmp/deck.pptx
    lo "pot:MS PowerPoint 97 Vorlage" --outdir /tmp /tmp/deck.pptx
    for f in pps pot; do python3 /f/strip.py /tmp/deck.$f && cp /tmp/deck.$f /out/; done
  fi
'
ls -l "$out"

#!/bin/bash
# Regenerates the Word 97 fixtures from their sources. No personal data: every text is made up.
#   format.{doc,dot,docx}  LibreOffice (in Docker) from format.fodt, the hand-written source
#   textutil.{doc,docx}    textutil (macOS) from textutil.html
set -euo pipefail
cd "$(dirname "$0")"
textutil -convert doc textutil.html -output textutil.doc
textutil -convert docx textutil.html -output textutil.docx
image=${DOCS_LIBREOFFICE_IMAGE:-docs-libreoffice}
if ! docker image inspect "$image" > /dev/null 2>&1; then
  printf 'FROM alpine:3.22\nRUN apk add --no-cache libreoffice-writer abiword font-noto font-noto-cjk\n' |
    docker build -t "$image" -
fi
for format in doc dot docx; do
  docker run --rm -v "$PWD:/work" -w /work "$image" \
    soffice --headless --convert-to "$format" --outdir /work format.fodt > /dev/null
done
ls -l format.* textutil.*

#!/bin/bash
# Regenerates the fixtures made by real tools. No personal data: every text here is made up.
#   report.doc            textutil (macOS) from report.html
#   rich.{docx,doc,odt,rtf}  LibreOffice (in Docker) from rich.fodt, the hand-written source
#   rich.abw              AbiWord (in Docker) from rich.odt
# The other formats' fixtures are built in test code (tests/fixtures.ts, tests/hwp.ts,
# tests/ooxml-fixture.ts).
set -euo pipefail
cd "$(dirname "$0")"
textutil -convert doc report.html -output report.doc
image=${DOCS_LIBREOFFICE_IMAGE:-docs-libreoffice}
if ! docker image inspect "$image" > /dev/null 2>&1; then
  printf 'FROM alpine:3.22\nRUN apk add --no-cache libreoffice-writer abiword font-noto font-noto-cjk\n' |
    docker build -t "$image" -
fi
for format in docx doc odt rtf; do
  docker run --rm -v "$PWD:/work" -w /work "$image" \
    soffice --headless --convert-to "$format" --outdir /work rich.fodt > /dev/null
done
docker run --rm -v "$PWD:/work" -w /work "$image" abiword --to=abw rich.odt -o rich.abw 2> /dev/null
ls -l report.doc rich.*

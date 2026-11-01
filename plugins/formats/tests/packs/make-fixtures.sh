#!/usr/bin/env bash
# Builds the real-tool pack fixtures in a Linux container: mksquashfs with every compressor (gzip,
# xz, LZ4, zstd, LZO; 4 KiB blocks, fragments, a deep folder, links, a hard link and device nodes
# from pseudo definitions) and wimlib-imagex (stored, XPRESS, LZX with two images; LZMS and a solid
# ESD for the refusals). expected.json is the source tree as Python saw it. Data only: no code of
# the tools is kept. Run from anywhere: plugins/formats/tests/packs/make-fixtures.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
docker run --rm -e TZ=UTC -e SOURCE_DATE_EPOCH=1790856000 -v "$here":/work debian:bookworm-slim bash -c '
  set -euo pipefail
  apt-get update -qq >/dev/null
  apt-get install -y -qq --no-install-recommends squashfs-tools wimtools python3 >/dev/null 2>&1
  python3 /work/make-fixtures.py /work/fixtures/real
'

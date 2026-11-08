#!/usr/bin/env bash
# Encodes the DjVu fixtures with DjVuLibre's own tools. make-fixtures.mjs runs it in
# debian:bookworm-slim with the generated sources in /work and the fixtures folder in /out.
set -euo pipefail
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends djvulibre-bin minidjvu >/dev/null
cd /work

# BZZ streams: one block, and 10 KB blocks.
bzz -e text.txt /out/text.bzz
bzz -e10 text.txt /out/text-blocks.bzz
bzz -e10 bytes.bin /out/bytes.bzz

# JB2: a lossless page, a lossy one (copies and refinements), two pages sharing a dictionary.
cjb2 -dpi 150 page.pbm /out/bitonal.djvu
cjb2 -dpi 150 -lossy page.pbm /out/bitonal-lossy.djvu
cjb2 -dpi 300 big.pbm /out/big.djvu
minidjvu -d 150 -p 2 shared1.pbm shared2.pbm /out/shared.djvu
# minidjvu merges shapes a pixel apart, so its pages are checked against DjVuLibre's own masks.
for page in 1 2; do ddjvu -format=pbm -mode=mask -page=$page /out/shared.djvu shared-$page.pbm; done

# IW44: colour, grey and full-chrominance photos.
c44 -dpi 100 photo.ppm /out/photo.djvu
c44 -dpi 100 photo.pgm /out/photo-grey.djvu
c44 -dpi 100 -crcbfull photo.ppm /out/photo-full.djvu

# A bundled book: a compound page (mask, FG44, BG44), a JB2-colours page (FGbz), a photo page.
cjb2 -dpi 150 mask.pbm mask.djvu
djvuextract mask.djvu Sjbz=mask.sjbz >/dev/null
djvumake compound.djvu INFO=600,400,150 Sjbz=mask.sjbz PPM=compound.ppm
cpaldjvu -dpi 150 colours.ppm colours.djvu
cp /out/photo.djvu photo-page.djvu
djvm -c /out/book.djvu compound.djvu colours.djvu photo-page.djvu
djvused /out/book.djvu -f book.djvused -s

# The same book as an indirect document: only its index file is kept.
mkdir -p indirect
djvmcvt -i /out/book.djvu indirect index.djvu
cp indirect/index.djvu /out/indirect.djvu
cp indirect/colours.djvu /out/indirect-colours.djvu

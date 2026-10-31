#!/bin/sh
# Makes the sheets fixtures from budget.source.xml with LibreOffice, in a Debian container, so every
# fixture is a file a real spreadsheet program wrote. Run from anywhere: sh make.sh (needs Docker;
# the image is built once and kept as desk-sheets-fixtures).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
image=desk-sheets-fixtures
if ! docker image inspect "$image" > /dev/null 2>&1; then
  docker build -t "$image" - <<'DOCKERFILE'
FROM debian:bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      libreoffice-calc-nogui python3-pip python3-cryptography python3-olefile && \
    pip install --break-system-packages --no-deps msoffcrypto-tool==6.0.0 && \
    rm -rf /var/lib/apt/lists/*
DOCKERFILE
fi

docker run --rm -e HOME=/tmp -v "$here:/fixtures" "$image" sh -eu -c '
mkdir -p /work && cd /work
cp /fixtures/budget.source.xml budget.xml
convert() { soffice --headless "$@" > /dev/null 2>&1; }
convert --infilter="MS Excel 2003 XML" --convert-to fods budget.xml
for format in xlsx xls ods dif slk; do convert --convert-to "$format" budget.fods; done
# CSV as Calc writes it by default: comma, double quotes, UTF-8, the values as shown.
csv="csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true,false,false"
convert --convert-to "$csv" budget.fods
convert --convert-to "$csv,2" --outdir notes budget.fods
# The Notes sheet as a Korean Windows program writes CSV: code page 949 (EUC-KR).
iconv -f UTF-8 -t CP949 notes/budget-Notes.csv > notes-euc-kr.csv
python3 /fixtures/freeze.py
# The same workbook behind a password ("example"), as Excel encrypts it (ECMA-376 agile encryption).
msoffcrypto-tool -e -p example budget.xlsx encrypted.xlsx
cp budget.fods budget.xlsx budget.xls budget.ods budget.dif budget.slk budget.csv \
  notes-euc-kr.csv encrypted.xlsx /fixtures/
'
ls -l "$here"

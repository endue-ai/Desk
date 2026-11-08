#!/usr/bin/env bash
# The container half of make-fixtures.sh: /src holds the originals, /out gets the archives. Every
# file gets one fixed time so the archives come out the same each run (encrypted ones excepted).
set -euo pipefail
cd /src
find . -exec touch -h -d "2026-10-01 12:00:00" {} +
r7() { /r7/rar a -idq -ol "$@"; }
r6() { /r6/rar a -idq -ol -ma4 "$@"; }
tree=(text.txt data.bin empty.txt empty-folder docs link.txt unicode)
few=(data.bin empty.txt empty-folder docs link.txt unicode)

for m in 1 3 5; do r7 -m$m /out/rar5-m$m.rar "${tree[@]}"; done
r7 -m0 /out/rar5-stored.rar "${few[@]}"
r7 -m5 -s /out/rar5-solid.rar chapters text.txt data.bin tool.exe
r7 -m5 -md64m /out/rar5-dict.rar far.bin
r7 -m5 /out/rar5-filters.rar tool.exe table.dat
r7 -m5 -mce+ /out/rar5-filters.rar tool-e8.exe
r7 -m3 -htb /out/rar5-blake.rar docs
r7 -m3 -pexample /out/rar5-encrypted.rar text.txt docs
r7 -m3 -hpexample /out/rar5-locked.rar text.txt
r7 -m0 -v30k /out/rar5-split.rar data.bin

for m in 1 3 5; do r6 -m$m /out/rar4-m$m.rar "${tree[@]}"; done
r6 -m0 /out/rar4-stored.rar "${few[@]}"
r6 -m5 -s -mct- /out/rar4-solid.rar chapters text.txt data.bin
r6 -m5 -s -mct+ /out/rar4-ppmd.rar chapters text.txt
r6 -m5 -s -mct+ /out/rar4-ppmd-restart.rar ppmd/code.exe ppmd/prose.txt
r6 -m5 -s /out/rar4-mixed.rar text.txt data.bin chapters/one.txt tool.exe
r6 -m5 -md4m /out/rar4-dict.rar far4.bin
r6 -m5 /out/rar4-filters.rar image.bmp sound.wav table.dat tool.exe
r6 -m5 -mce+ /out/rar4-filters.rar tool-e8.exe
r6 -m3 -pexample /out/rar4-encrypted.rar text.txt docs
r6 -m3 -hpexample /out/rar4-locked.rar text.txt
r6 -m0 -v30k /out/rar4-split.rar data.bin

if [ -f /large/large.bin ]; then
  (cd /large && /r7/rar a -idq -m3 /out/large5.rar large.bin && /r6/rar a -idq -ma4 -m3 /out/large4.rar large.bin)
fi

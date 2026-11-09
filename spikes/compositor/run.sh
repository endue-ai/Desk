#!/usr/bin/env bash
# Run the bundled spike with a hard time limit: run.sh <seconds> <log> [--spike-... options]
set -u
limit="$1"; log="$2"; shift 2
app="$(dirname "$0")/target/bundle/desk-spike.app/Contents/MacOS/desk-spike"
"$app" "$@" > "$log" 2>&1 &
pid=$!
for _ in $(seq 1 "$((limit * 10))"); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
kill -9 "$pid" 2>/dev/null
grep -E "^(spike:|SPIKE-REPORT|\[ )" "$log"

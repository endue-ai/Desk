#!/bin/bash
# Regenerates the fixtures made by real tools (macOS): report.doc from report.html with textutil.
# The other formats' fixtures are built in test code (tests/fixtures.ts, tests/hwp.ts,
# tests/ooxml-fixture.ts). No personal data: every text here is made up.
set -euo pipefail
cd "$(dirname "$0")"
textutil -convert doc report.html -output report.doc

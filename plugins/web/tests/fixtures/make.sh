#!/bin/sh
# Makes the binary fixtures the tests read, on macOS: a Safari .webarchive and a binary .webloc,
# converted by plutil from the XML property lists next to them, and a .webarchive that textutil
# (Apple's Cocoa HTML writer) makes from textutil.html, as a file from a real tool.
# Run it from anywhere: sh plugins/web/tests/fixtures/make.sh
set -eu
cd "$(dirname "$0")"
plutil -convert binary1 -o page.webarchive page.webarchive.xml
plutil -convert binary1 -o link.webloc link.webloc.xml
textutil -convert webarchive -output textutil.webarchive textutil.html

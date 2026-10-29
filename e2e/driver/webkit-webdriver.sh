#!/usr/bin/env bash
# The native driver tauri-driver starts (`--native-driver`). tauri-driver 2.0.5+ sends
# WebKitWebDriver's stdout to /dev/null, and the app WebKitWebDriver launches inherits that stdout,
# so the app's ready line would be lost. This puts it on stderr, which tauri-driver passes through to
# wdio.conf.ts and from there to e2e/test-results/<spec>.log.
exec WebKitWebDriver "$@" 1>&2

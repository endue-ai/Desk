#!/bin/sh
# /usr/bin/endue-desk in the .deb and the AppImage (#46): the desk itself lives in
# ../lib/endue-desk beside libcef.so, CEF's resources and the shell, where CEF and the desk look
# for them. readlink -f follows a symlink to this file, so the path holds wherever it is linked from.
# A Tauri desk restarts /usr/bin/endue-desk after it installed this .deb as its update (#47), and
# lands here.
here="$(dirname "$(readlink -f "$0")")"
exec "$here/../lib/endue-desk/endue-desk" "$@"

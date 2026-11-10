#!/bin/sh
# /usr/bin/endue-desk-cef in the .deb and the AppImage (#46): the desk itself lives in
# ../lib/endue-desk-cef beside libcef.so, CEF's resources and the shell, where CEF and the desk look
# for them. readlink -f follows a symlink to this file, so the path holds wherever it is linked from.
here="$(dirname "$(readlink -f "$0")")"
exec "$here/../lib/endue-desk-cef/endue-desk-cef" "$@"

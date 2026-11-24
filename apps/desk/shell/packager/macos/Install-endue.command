#!/bin/sh
# Finder opens this file from the disk image. Accept explicit paths for managed installations.
set -eu
image=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
exec "$image/endue.app/Contents/Resources/install-endue" "$@"

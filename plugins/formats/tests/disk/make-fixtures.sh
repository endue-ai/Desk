#!/usr/bin/env bash
# Builds the disk fixtures with the real tools in a Linux container: qemu-img for the virtual disks,
# sgdisk and sfdisk for the partition tables, mkfs.fat with mtools, mkfs.exfat, mkfs.ext4 -d and
# mkntfs with ntfs-3g for the file systems. Each image is mounted read-only afterwards and walked, so
# expected.json is the kernel's (or ntfs-3g's) view of every file. The container is privileged for
# the loop and FUSE mounts. Run from anywhere: plugins/formats/tests/disk/make-fixtures.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
docker run --rm --privileged -e TZ=UTC -v "$here":/work debian:bookworm-slim bash -c '
  set -euo pipefail
  apt-get update -qq >/dev/null
  apt-get install -y -qq --no-install-recommends qemu-utils dosfstools exfatprogs e2fsprogs \
    ntfs-3g mtools gdisk fdisk python3 >/dev/null 2>&1
  python3 /work/make-fixtures.py /work/fixtures
'

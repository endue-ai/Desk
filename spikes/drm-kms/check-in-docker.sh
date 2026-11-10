#!/usr/bin/env bash
# Build (compile and link) desk-kms for x86_64-unknown-linux-gnu against Debian bookworm's
# libinput, libudev, libseat and libxkbcommon, from any Docker host. It only compiles: a
# container can open no DRM device, so nothing here runs the spike.
#   spikes/drm-kms/check-in-docker.sh [cargo features, default: udev,libseat]
# With `cef` in the features, CEF's Linux distribution is downloaded and its wrapper built;
# libcef.so's own dependencies (X11, NSS, ...) are not installed here, so the link is told to
# leave them unresolved, and their list is printed instead.
set -euo pipefail
features="${1:-udev,libseat}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
rustflags=""
case "$features" in *cef*) rustflags="-C link-arg=-Wl,--allow-shlib-undefined" ;; esac
docker run --rm \
  -v "$repo":/src:ro \
  -v desk-kms-cargo-registry:/usr/local/cargo/registry \
  -v desk-kms-target:/target \
  -e CARGO_TARGET_DIR=/target -e CARGO_INCREMENTAL=0 \
  -e CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
  -e CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS="$rustflags" \
  -e CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc -e CXX_x86_64_unknown_linux_gnu=x86_64-linux-gnu-g++ \
  -e PKG_CONFIG_ALLOW_CROSS=1 -e PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig \
  -e FEATURES="$features" \
  rust:1-slim-bookworm bash -euo pipefail -c '
    dpkg --add-architecture amd64
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends gcc-x86-64-linux-gnu g++-x86-64-linux-gnu \
      libc6-dev-amd64-cross pkg-config cmake ninja-build file binutils-x86-64-linux-gnu \
      libinput-dev:amd64 libudev-dev:amd64 libseat-dev:amd64 libxkbcommon-dev:amd64 >/dev/null
    rustup target add x86_64-unknown-linux-gnu >/dev/null
    rustc --version
    cargo build --locked --manifest-path /src/spikes/drm-kms/Cargo.toml \
      --target x86_64-unknown-linux-gnu --features "$FEATURES"
    bin=/target/x86_64-unknown-linux-gnu/debug/desk-kms
    file "$bin"
    x86_64-linux-gnu-readelf -d "$bin" | grep -E "NEEDED|RUNPATH"
    lib=/target/x86_64-unknown-linux-gnu/debug/libcef.so
    if [ -f "$lib" ] && [[ "$FEATURES" == *cef* ]]; then
      echo "libcef.so needs:"; x86_64-linux-gnu-readelf -d "$lib" | grep NEEDED
      echo "Ozone platform markers in libcef.so (headless: ozone-dump-file, wayland: WAYLAND_DISPLAY):"
      grep -a -o -E "ozone-dump-file|WAYLAND_DISPLAY|ozone-platform-hint" "$lib" | sort | uniq -c
    fi
  '

# Source in the Linux CLI build step. Use neutral paths in compiler locations and strip symbols.
unset RUSTFLAGS
export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=$PWD=/src"$'\x1f'"--remap-path-prefix=$HOME=/build-home"
export CARGO_PROFILE_RELEASE_STRIP=symbols

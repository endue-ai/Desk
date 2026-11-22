# Source before Cargo builds a packaged app. Cargo's encoded flags keep paths with spaces intact.
CARGO_ENCODED_RUSTFLAGS="$(
  separator=$'\x1f'
  flags=()
  if [ -n "${CARGO_ENCODED_RUSTFLAGS:-}" ]; then
    flags+=("$CARGO_ENCODED_RUSTFLAGS")
  elif [ -z "${CARGO_ENCODED_RUSTFLAGS+x}" ] && [ -n "${RUSTFLAGS:-}" ]; then
    read -r -a flags <<< "$RUSTFLAGS"
  fi

  remap() {
    local from="$1" to="$2" physical
    [ -n "$from" ] || return 0
    if [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]]; then
      physical="$(cygpath -aw "$from")"
    else
      [[ "$from" == /* ]] || from="$PWD/$from"
      physical="$from"
      if [ -d "$from" ]; then physical="$(cd -- "$from" && pwd -P)"; fi
    fi
    flags+=("--remap-path-prefix=$from=$to")
    if [ "$physical" != "$from" ]; then flags+=("--remap-path-prefix=$physical=$to"); fi
  }

  # Rust uses the last matching map. Prefer the checkout and its build directories over the home.
  remap "${USERPROFILE:-}" /build-home
  remap "$HOME" /build-home
  remap "$PWD" /src
  remap "${RUSTUP_HOME:-}" /rustup
  remap "${CARGO_HOME:-}" /cargo
  remap "${CARGO_TARGET_DIR:-}" /build
  IFS="$separator"
  printf '%s' "${flags[*]}"
)"
export CARGO_ENCODED_RUSTFLAGS CARGO_PROFILE_RELEASE_STRIP=symbols DESK_PACKAGED_SHELL=1

# The standalone Linux command does not link to CEF. Discard the desktop linker flags.
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS
# shellcheck source=scripts/package-build-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/package-build-env.sh"

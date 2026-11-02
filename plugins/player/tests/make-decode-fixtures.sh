#!/usr/bin/env bash
# Makes the software decoder's fixtures in tests/fixtures/decode (decode.test.ts): a fraction of a
# second each, no personal media. ffmpeg 7 or later, curl, python3 and Docker on PATH. FFmpeg encodes
# neither VC-1 nor Theora (without libtheora), so those two are cut, without re-encoding, from NASA
# films, which as works of the US government are in the public domain; Monkey's Audio and AMR come
# from their own encoders in a container. AVI, WMA and WavPack reuse make-fixtures.sh's clips.
set -euo pipefail
cd "$(dirname "$0")"
out="$PWD/fixtures/decode"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
agent="endue-desk-fixtures/1.0 (team@endue.ai)"

# WMV 9 (VC-1 Main profile, WMV3) with WMA 2: a quarter second of "JSC-500 Apollo 8: Go for TLI",
# NASA Johnson Space Center, https://archive.org/details/Jsc-500Apollo8-goForTli.wmv (public domain).
curl -fsSL -A "$agent" -r 0-4194303 -o "$work/apollo8.wmv" \
  https://archive.org/download/Jsc-500Apollo8-goForTli.wmv/Jsc-500Apollo8-goForTli.wmv
ff -i "$work/apollo8.wmv" -map 0:v -map 0:a -c copy -ss 1.835 -t 0.25 "$out/vc1.wmv"

# Theora: half a second of "Apollo 16 rover practice" (NASA, public domain), Wikimedia Commons,
# https://commons.wikimedia.org/wiki/File:Apollo_16_rover_practice.ogv
curl -fsSL -A "$agent" -o "$work/rover.ogv" \
  https://upload.wikimedia.org/wikipedia/commons/8/83/Apollo_16_rover_practice.ogv
ff -i "$work/rover.ogv" -map 0:v -c copy -t 0.5 "$out/theora.ogv"

# RealMedia: RealVideo 2.0 and RealAudio 1.0 (14.4), the Real codecs FFmpeg encodes.
ff -f lavfi -i "smptebars=size=176x144:rate=10:duration=1" \
  -f lavfi -i "sine=frequency=440:sample_rate=8000:duration=1" \
  -c:v rv20 -q:v 20 -g 5 -c:a real_144 -f rm "$out/clip.rmvb"

# A second of a 440 Hz tone for the audio encoders below.
ff -f lavfi -i "sine=frequency=440:sample_rate=8000:duration=1" -c:a pcm_s16le "$work/tone8k.wav"
ff -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=0.5" -ac 2 -c:a pcm_s16le \
  "$work/tone44k.wav"

# Monkey's Audio: the encoder of Monkey's Audio's own SDK (3-clause BSD), built in a container.
curl -fsSL -o "$work/mac-sdk.zip" https://monkeysaudio.com/files/MAC_1345_SDK.zip
echo "b12bda0eb9e31dbe01d54a970d387add3a8c1079901141021d257de17a6a9106  $work/mac-sdk.zip" | shasum -a 256 -c - >/dev/null
docker run --rm -v "$work:/w" gcc:14 bash -euo pipefail -c '
  apt-get -qq update >/dev/null && apt-get -qq install -y cmake unzip >/dev/null
  mkdir /tmp/sdk && cd /tmp/sdk && unzip -q /w/mac-sdk.zip
  cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED=OFF >/dev/null
  cmake --build build -j"$(nproc)" >/dev/null
  "$(find build -type f -name mac -perm -u+x | head -1)" /w/tone44k.wav /w/tone.ape -c2000 >/dev/null'
cp "$work/tone.ape" "$out/tone.ape"

# AMR-NB: the OpenCORE AMR encoder (Apache-2.0, Debian's libopencore-amrnb), driven by a few lines of
# C, since Debian's ffmpeg does not link it: 12.2 kbit/s frames after the "#!AMR" magic.
ff -i "$work/tone8k.wav" -f s16le -ac 1 -ar 8000 "$work/tone8k.raw"
cat > "$work/amrnb.c" <<'C'
#include <opencore-amrnb/interf_enc.h>
#include <stdio.h>
int main(int argc, char **argv) {
  FILE *in = fopen(argv[1], "rb"), *out = fopen(argv[2], "wb");
  if (!in || !out) return 1;
  void *encoder = Encoder_Interface_init(0);
  short pcm[160];
  unsigned char frame[64];
  fwrite("#!AMR\n", 1, 6, out);
  while (fread(pcm, sizeof pcm[0], 160, in) == 160)
    fwrite(frame, 1, Encoder_Interface_Encode(encoder, MR122, pcm, frame, 0), out);
  Encoder_Interface_exit(encoder);
  return fclose(out);
}
C
docker run --rm -v "$work:/w" debian:trixie-slim bash -euo pipefail -c '
  apt-get -qq update >/dev/null && apt-get -qq install -y gcc libc6-dev libopencore-amrnb-dev >/dev/null
  gcc -O2 -o /tmp/amrnb /w/amrnb.c -lopencore-amrnb && /tmp/amrnb /w/tone8k.raw /w/tone.amr'
cp "$work/tone.amr" "$out/tone.amr"

# DSD (DSF and DFF): written by dsd.py, a sigma-delta modulator of our own.
python3 -I dsd.py "$out/tone.dsf" "$out/tone.dff"
ls -l "$out"

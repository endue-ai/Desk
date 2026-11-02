#!/usr/bin/env bash
# Rebuilds endue.player's software decoder (ADR 0050): FFmpeg's decoders and demuxers, LGPL 2.1 only,
# compiled to WebAssembly with Emscripten in a pinned container, linked with the player's own glue
# (plugins/player/wasm), and copied with FFmpeg's licence and a VERSIONS file into
# plugins/player/ui/vendor/ffmpeg/. scripts/vendor-ffmpeg.test.mjs checks the copy against VERSIONS.
#
#   scripts/vendor-ffmpeg.sh            # needs Docker; the tarball is cached in $FFMPEG_CACHE
#   FFMPEG_WORK=/tmp/ff scripts/vendor-ffmpeg.sh   # keeps the build there: a glue change relinks only
#
# Everything enabled is LGPL 2.1 or later: no GPL, nonfree or version 3 option and no external
# library, and FFmpeg's configure refuses GPL parts unless it is asked for them.
set -euo pipefail

FFMPEG_VERSION=9.0.2
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
EMSDK_IMAGE="emscripten/emsdk:6.0.13@sha256:fb7864e398acfda863dfcea78b8bc8adad359fa60c6a0bbeb845931de64aa68a"

VIDEO_DECODERS="wmv1 wmv2 wmv3 wmv3image vc1 vc1image msmpeg4v1 msmpeg4v2 msmpeg4v3 mpeg4 h263 h263i
h263p flv theora vp3 vp6 vp6f vp6a vp8 rv10 rv20 rv30 rv40 mpeg1video mpeg2video mjpeg dvvideo"
AUDIO_DECODERS="wmav1 wmav2 wmapro wmalossless wmavoice ape wavpack amrnb amrwb dsd_lsbf dsd_msbf
dsd_lsbf_planar dsd_msbf_planar vorbis cook ra_144 ra_288 sipr atrac3 aac ac3 eac3 dca truehd
mlp mp1float mp2float mp3float flac alac tta speex adpcm_ms adpcm_ima_wav adpcm_ima_qt gsm gsm_ms
pcm_alaw pcm_mulaw pcm_s8 pcm_u8 pcm_s16le pcm_s16be pcm_s24le pcm_s24be pcm_s32le pcm_s32be
pcm_f32le pcm_f32be pcm_f64le pcm_f64be pcm_dvd pcm_bluray"
DEMUXERS="asf avi matroska ogg rm mov mpegps mpegts mpegvideo m4v flv mxf ape wv amr dsf iff wav
w64 aiff mp3 aac ac3 flac au caf tta"
PARSERS="aac ac3 dca flac mpeg4video mpegaudio mpegvideo vc1 h263 vorbis opus vp3 vp8 cook sipr gsm
amr mlp mjpeg dvaudio"
EXPORTS="dk_open dk_code dk_error dk_duration dk_has_video dk_has_audio dk_video_width
dk_video_height dk_audio_rate dk_audio_channels dk_video_codec dk_audio_codec dk_next dk_time
dk_frame_width dk_frame_height dk_planes dk_plane dk_linesize dk_plane_width dk_plane_height
dk_full_range dk_bt709 dk_samples dk_sample_count dk_sample_channels dk_sample_rate dk_seek
dk_skip_nonref dk_close dk_quiet"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GLUE="$ROOT/plugins/player/wasm"
VENDOR="$ROOT/plugins/player/ui/vendor/ffmpeg"
CACHE="${FFMPEG_CACHE:-${TMPDIR:-/tmp}/endue-ffmpeg}"
TARBALL="$CACHE/ffmpeg-${FFMPEG_VERSION}.tar.xz"

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
list() { local kind=$1; shift; for name in $*; do printf -- ' --enable-%s=%s' "$kind" "$name"; done; }

CONFIGURE="--target-os=none --arch=x86_32 --enable-cross-compile --cc=emcc --cxx=em++ --ar=emar \
--ranlib=emranlib --nm=emnm --disable-everything --disable-autodetect --disable-programs \
--disable-doc --disable-network --disable-pthreads --disable-w32threads --disable-os2threads \
--disable-asm --disable-inline-asm --disable-runtime-cpudetect --disable-debug --disable-stripping \
--enable-small --disable-avdevice --disable-swscale --disable-swresample --disable-avfilter \
--extra-cflags=-Oz$(list decoder $VIDEO_DECODERS $AUDIO_DECODERS)$(list demuxer $DEMUXERS)$(list parser $PARSERS)"
LINK="emcc -Oz -I. -I/glue /glue/decode.c /glue/frames.c libavformat/libavformat.a libavcodec/libavcodec.a \
libavutil/libavutil.a -sSTANDALONE_WASM --no-entry -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 \
-sSTACK_SIZE=1048576 -sEXPORTED_FUNCTIONS=$(printf '_%s,' $EXPORTS | sed 's/,$//') -o /out/ffmpeg.wasm"

forbidden='--enable-(gpl|nonfree|version3|lib)'
if [[ $CONFIGURE =~ $forbidden ]]; then
  echo "vendor-ffmpeg: the configure line must stay LGPL 2.1" >&2; exit 1
fi

mkdir -p "$CACHE"
if [ ! -f "$TARBALL" ]; then curl -fsSL "$FFMPEG_URL" -o "$TARBALL.part" && mv "$TARBALL.part" "$TARBALL"; fi
if [ "$(sha256 "$TARBALL")" != "$FFMPEG_SHA256" ]; then
  echo "vendor-ffmpeg: $TARBALL does not match SHA-256 $FFMPEG_SHA256" >&2; exit 1
fi

if [ -n "${FFMPEG_WORK:-}" ]; then
  WORK="$FFMPEG_WORK"
else
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
fi
mkdir -p "$WORK/out"
[ -d "$WORK/ffmpeg-${FFMPEG_VERSION}" ] || tar -xJf "$TARBALL" -C "$WORK"
printf '%s\n' "$CONFIGURE" > "$WORK/out/configure.wanted"
started=$(date +%s)
docker run --rm -v "$WORK/ffmpeg-${FFMPEG_VERSION}:/src" -v "$GLUE:/glue:ro" -v "$WORK/out:/out" \
  -w /src "$EMSDK_IMAGE" bash -euo pipefail -c "
    if ! cmp -s /out/configure.wanted /out/configure.done; then
      ./configure $CONFIGURE > /out/configure.log
      make clean > /dev/null
      cp /out/configure.wanted /out/configure.done
    fi
    make -j\$(nproc) > /out/make.log 2>&1 || { tail -40 /out/make.log; exit 1; }
    $LINK
    chown -R $(id -u):$(id -g) /out"
echo "vendor-ffmpeg: built in $(( $(date +%s) - started )) s" >&2

mkdir -p "$VENDOR"
rm -f "$VENDOR"/*
cp "$WORK/out/ffmpeg.wasm" "$VENDOR/ffmpeg.wasm"
chmod 644 "$VENDOR/ffmpeg.wasm"
cp "$WORK/ffmpeg-${FFMPEG_VERSION}/COPYING.LGPLv2.1" "$VENDOR/COPYING.LGPLv2.1"
{
  echo "# endue.player's software decoder: FFmpeg built to WebAssembly by scripts/vendor-ffmpeg.sh."
  echo "# FFmpeg is licensed under the LGPL 2.1 or later (COPYING.LGPLv2.1); see ADR 0050."
  echo "release $FFMPEG_URL"
  echo "release-sha256 $FFMPEG_SHA256"
  echo "image $EMSDK_IMAGE"
  echo "configure $CONFIGURE"
  echo "link $LINK"
  for file in decode.c decode.h frames.c; do echo "glue plugins/player/wasm/$file $(sha256 "$GLUE/$file")"; done
  for file in COPYING.LGPLv2.1 ffmpeg.wasm; do echo "file $file $(sha256 "$VENDOR/$file")"; done
} > "$VENDOR/VERSIONS"
ls -l "$VENDOR"

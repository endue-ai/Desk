#!/usr/bin/env bash
# Makes the player's container fixtures in tests/fixtures: one second of tones and colour bars, tiny,
# no personal media. Run it from anywhere with ffmpeg 7 or later on PATH; the bytes change between
# ffmpeg versions, the facts the tests read (duration, codecs, sizes, tags) do not.
set -euo pipefail
cd "$(dirname "$0")/fixtures"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
bars=(-f lavfi -i "smptebars=size=176x144:rate=10:duration=1")
tone=(-f lavfi -i "sine=frequency=440:sample_rate=8000:duration=1")
tone44=(-f lavfi -i "sine=frequency=440:sample_rate=44100:duration=1")
tags=(-metadata "title=Test Tone" -metadata "artist=Endue Player" -metadata "album=Fixtures")
h264=(-c:v libx264 -preset veryslow -crf 45 -pix_fmt yuv420p -g 10)
cover=(-map 0 -map 1 -c:v copy -disposition:v attached_pic)

ff -f lavfi -i "color=c=0x3366cc:size=16x16" -frames:v 1 cover.png

# Video
ff "${bars[@]}" "${tone44[@]}" "${h264[@]}" -c:a aac -b:a 24k -movflags +faststart "${tags[@]}" clip.mp4
ff "${bars[@]}" "${tone44[@]}" "${h264[@]}" -c:a aac -b:a 24k -f mov clip.mov
ff "${bars[@]}" "${tone44[@]}" -c:v libx265 -preset fast -crf 45 -pix_fmt yuv420p -x265-params log-level=none \
  -c:a ac3 -b:a 64k -metadata:s:a:0 language=kor "${tags[@]}" clip.mkv
ff "${bars[@]}" "${tone44[@]}" -c:v libvpx-vp9 -b:v 30k -deadline good -cpu-used 5 -c:a libopus -b:a 16k \
  -metadata:s:a:0 language=eng clip.webm
ff "${bars[@]}" "${tone44[@]}" -c:v mpeg4 -vtag XVID -q:v 31 -c:a libmp3lame -b:a 32k "${tags[@]}" clip.avi
ff "${bars[@]}" "${tone44[@]}" -c:v wmv2 -b:v 40k -c:a wmav2 -b:a 32k "${tags[@]}" clip.wmv
ff "${bars[@]}" "${tone44[@]}" "${h264[@]}" -c:a aac -b:a 24k clip.flv
ff "${bars[@]}" "${tone44[@]}" "${h264[@]}" -c:a aac -b:a 24k -f mpegts clip.mpegts
ff "${bars[@]}" "${tone44[@]}" "${h264[@]}" -c:a ac3 -b:a 64k -f mpegts -mpegts_m2ts_mode 1 clip.m2ts
ff "${bars[@]}" "${tone44[@]}" -c:v mpeg2video -q:v 31 -c:a mp2 -b:a 64k -f vob clip.vob
ff "${bars[@]}" "${tone44[@]}" -c:v rv10 -q:v 31 -c:a ac3 -b:a 64k clip.rm

# Audio
ff "${tone44[@]}" -i cover.png "${cover[@]}" -c:a libmp3lame -q:a 9 -id3v2_version 3 "${tags[@]}" \
  -metadata "track=3" -metadata "date=2026" tone-v23.mp3
ff "${tone44[@]}" -i cover.png "${cover[@]}" -c:a libmp3lame -b:a 32k -id3v2_version 4 -write_id3v1 1 \
  "${tags[@]}" tone-v24.mp3
ff "${tone44[@]}" -i cover.png "${cover[@]}" -c:a aac -b:a 24k "${tags[@]}" tone.m4a
ff "${tone[@]}" -i cover.png "${cover[@]}" -c:a flac "${tags[@]}" tone.flac
picture=$(python3 -I -c '
import base64, struct, sys
png = open("cover.png", "rb").read()
mime, desc = b"image/png", b"Cover"
block = struct.pack(">I", 3) + struct.pack(">I", len(mime)) + mime + struct.pack(">I", len(desc)) + desc
block += struct.pack(">IIII", 16, 16, 24, 0) + struct.pack(">I", len(png)) + png
sys.stdout.write(base64.b64encode(block).decode())')
ff "${tone[@]}" -c:a vorbis -strict -2 -ac 2 "${tags[@]}" -metadata "METADATA_BLOCK_PICTURE=$picture" tone.ogg
ff "${tone[@]}" -c:a libopus -b:a 12k "${tags[@]}" tone.opus
ff "${tone[@]}" -c:a pcm_s16le "${tags[@]}" -metadata "genre=Test" tone.wav
ff "${tone[@]}" -c:a pcm_s16be -write_id3v2 1 "${tags[@]}" tone.aiff
ff "${tone[@]}" -c:a alac tone.caf
ff "${tone[@]}" -c:a wavpack "${tags[@]}" tone.wv
ff "${tone[@]}" -c:a wmav2 -b:a 32k "${tags[@]}" tone.wma
ff "${tone[@]}" -c:a aac -b:a 16k -f adts tone.aac
ff "${tone[@]}" -c:a pcm_mulaw -f au tone.au
ff "${tone[@]}" -c:a pcm_alaw -f au tone-alaw.au
ff "${tone[@]}" -c:a pcm_s16be -f au tone-pcm.au
rm cover.png
ls -l

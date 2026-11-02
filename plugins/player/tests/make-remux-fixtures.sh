#!/usr/bin/env bash
# Makes the remux fixtures in tests/fixtures/remux: three seconds of a moving test pattern and a tone,
# a key frame every second, tiny frames, no personal media; and beside each file a JSON of what its
# source holds (ffprobe: every packet's times, size, key flag, CRC-32 and position, each stream's
# configuration) that remux.test.ts compares the fragmented MP4 with. Needs ffmpeg 7 or later with
# libx264, libx265, libvpx and libopus; the bytes change between versions, the facts stay true.
set -euo pipefail
cd "$(dirname "$0")/fixtures/remux"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
pattern=(-f lavfi -i "testsrc2=size=96x64:rate=10:duration=3")
tone=(-f lavfi -i "sine=frequency=440:sample_rate=44100:duration=3")
tone48=(-f lavfi -i "sine=frequency=440:sample_rate=48000:duration=3")
gop=(-g 10 -keyint_min 10 -sc_threshold 0)
h264=(-c:v libx264 -preset veryslow -crf 40 -pix_fmt yuv420p "${gop[@]}" -bf 2 -x264-params log-level=none)
hevc=(-c:v libx265 -preset fast -crf 40 -pix_fmt yuv420p -x265-params "keyint=10:min-keyint=10:scenecut=0:bframes=2:log-level=none")

ff "${pattern[@]}" "${tone[@]}" "${h264[@]}" -c:a aac -b:a 24k h264-aac.mkv
ff "${pattern[@]}" "${tone[@]}" "${hevc[@]}" -c:a ac3 -b:a 64k hevc-ac3.mkv
ff "${pattern[@]}" "${tone48[@]}" -c:v libvpx-vp9 "${gop[@]}" -b:v 40k -deadline good -cpu-used 5 -c:a libopus -b:a 16k vp9-opus.webm
ff "${pattern[@]}" "${tone[@]}" "${h264[@]}" -c:a aac -b:a 24k -flvflags add_keyframe_index h264-aac.flv
ff "${pattern[@]}" "${tone[@]}" "${h264[@]}" -c:a libmp3lame -b:a 32k h264-mp3.avi
ff "${tone48[@]}" -c:a libopus -b:a 16k opus.ogg
ff "${tone[@]}" -c:a flac flac.oga
# MXF takes 25 frames a second and 48 kHz PCM: 1.2 s, a key frame every 0.4 s.
ff -f lavfi -i "testsrc2=size=96x64:rate=25:duration=1.2" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=1.2" \
  -c:v libx264 -preset veryslow -crf 40 -pix_fmt yuv420p -g 10 -keyint_min 10 -sc_threshold 0 -bf 2 -x264-params log-level=none \
  -c:a pcm_s16le -f mxf h264-pcm.mxf
ff -f lavfi -i "testsrc2=size=64x48:rate=25:duration=0.4" -c:v mpeg2video -g 5 -q:v 20 -an -f mxf mpeg2.mxf
# AVCHD's shape: H.264 and AC-3 in a transport stream with timecodes (.m2ts).
ff "${pattern[@]}" "${tone48[@]}" "${h264[@]}" -c:a ac3 -b:a 64k -f mpegts -mpegts_m2ts_mode 1 h264-ac3.m2ts

for f in *.mkv *.webm *.flv *.avi *.ogg *.oga *.mxf *.m2ts; do
  ffprobe -v error -show_streams -show_data -show_packets -show_data_hash CRC32 -of json "$f" |
    python3 -I -c '
import json, sys
d = json.load(sys.stdin)
num = lambda v: None if v in (None, "N/A") else float(v)
streams = [{"index": s["index"], "type": s["codec_type"], "codec": s["codec_name"],
            "mime": s.get("mime_codec_string", ""), "rate": int(s.get("sample_rate", 0) or 0),
            "channels": s.get("channels", 0), "width": s.get("width", 0), "height": s.get("height", 0),
            "extradata": "".join(l[10:50].replace(" ", "") for l in s.get("extradata", "").splitlines())}
           for s in d["streams"]]
packets = [[p["stream_index"], num(p.get("pts_time")), num(p.get("dts_time")), num(p.get("duration_time")),
            int(p["size"]), "K" in p["flags"], p.get("data_hash", "")[6:], int(p.get("pos", -1))]
           for p in d["packets"]]
json.dump({"streams": streams, "packets": packets}, sys.stdout, separators=(",", ":"))' > "$f.facts"
done
# The display order of the AVI and MXF video, which store no presentation times: frames by packet position.
for f in h264-mp3.avi h264-pcm.mxf h264-ac3.m2ts; do
  ffprobe -v error -select_streams v -show_frames -show_entries frame=pkt_pos -of json "$f" |
    python3 -I -c 'import json, sys; print(" ".join(f["pkt_pos"] for f in json.load(sys.stdin)["frames"]))' > "$f.order"
done
ls -l

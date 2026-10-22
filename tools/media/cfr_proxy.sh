#!/bin/bash
# Make a constant-frame-rate H.264 proxy (plus stereo AAC) of SRC at an integer frame rate.
# Always make this proxy before any analysis: sources can have a variable frame rate or a header
# that misreports it.
#
# Usage: cfr_proxy.sh [--native | --width N] SRC OUT.mp4
#   --native    keep the source resolution, with no scaling (default). Use this for flash analysis:
#               resizing frames changes the result. Yuv420p needs even dimensions, so an odd width
#               or height loses one row or column of pixels; nothing is resampled.
#   --width N   scale to N pixels wide (N even). Only for contact sheets.
# Environment: FFMPEG and FFPROBE override the tool paths.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

usage() {
  sed -n '2,/^set -/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

WIDTH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --native) WIDTH="" ;;
    --width)
      WIDTH="${2:?--width needs a value}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "unknown option $1" ;;
    *) break ;;
  esac
  shift
done
[ $# -eq 2 ] || {
  usage >&2
  exit 2
}
SRC="$1"
OUT="$2"
case "$WIDTH" in
  "") ;;
  *[!0-9]*) die "--width must be a number" ;;
  *) [ $((WIDTH % 2)) -eq 0 ] || die "--width must be even" ;;
esac
[ -f "$SRC" ] || die "no such file: $SRC"
require_ffmpeg

read -r FPS MEASURED < <(source_fps "$SRC")
if [ -n "$WIDTH" ]; then
  VF="scale=${WIDTH}:-2:flags=lanczos,format=yuv420p"
  MODE="width=$WIDTH"
else
  VF="crop=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"
  MODE="native"
fi
log "src=$(basename "$SRC") measured_fps=$MEASURED cfr=$FPS $MODE"

mkdir -p "$(dirname "$OUT")"
"$FFMPEG" -v error -y -nostdin -i "$SRC" -map 0:v:0 -map '0:a:0?' -vf "$VF" \
  -fps_mode cfr -r "$FPS" -c:v libx264 -preset medium -crf 16 -g $((2 * FPS)) \
  -c:a aac -b:a 192k -ac 2 -movflags +faststart "$OUT"
"$FFPROBE" -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,avg_frame_rate,nb_frames \
  -show_entries format=duration -of compact "$OUT"

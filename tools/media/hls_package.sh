#!/bin/bash
# Package a title as HLS with fMP4 segments: one video rendition and two audio renditions, "main"
# and "comfort". Segments are 1 s long and every segment starts on a keyframe (1 s GOPs), so the
# player can switch between the audio renditions without a gap.
#
# Usage: hls_package.sh --video SRC --audio MAIN --comfort COMFORT --out DIR [--fps N] [--height H]
#   --video SRC      file whose first video stream is used (any frame rate; it is made constant)
#   --audio MAIN     file whose first audio stream is the main rendition
#   --comfort FILE   file whose first audio stream is the comfort rendition (same length as MAIN)
#   --out DIR        output directory; master.m3u8 plus video/, main/ and comfort/ are written
#   --fps N          constant output frame rate (default: measured from SRC, snapped to an integer)
#   --height H       shrink video taller than H pixels (default 720); 0 keeps every size
# Environment: FFMPEG and FFPROBE override the tool paths.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

usage() {
  print_usage "${BASH_SOURCE[0]}"
}

VIDEO="" AUDIO="" COMFORT="" OUT="" FPS="" HEIGHT=720
while [ $# -gt 0 ]; do
  case "$1" in
    --video | --audio | --comfort | --out | --fps | --height)
      [ $# -ge 2 ] || die "$1 needs a value"
      case "$1" in
        --video) VIDEO="$2" ;;
        --audio) AUDIO="$2" ;;
        --comfort) COMFORT="$2" ;;
        --out) OUT="$2" ;;
        --fps) FPS="$2" ;;
        --height) HEIGHT="$2" ;;
      esac
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -n "$VIDEO" ] && [ -n "$AUDIO" ] && [ -n "$COMFORT" ] && [ -n "$OUT" ] || {
  usage >&2
  exit 2
}
for f in "$VIDEO" "$AUDIO" "$COMFORT"; do
  [ -f "$f" ] || die "no such file: $f"
done
case "$HEIGHT" in
  "" | *[!0-9]*) die "--height must be a number" ;;
esac
case "$FPS" in
  *[!0-9]*) die "--fps must be an integer" ;;
esac
require_ffmpeg

if [ -z "$FPS" ]; then
  read -r FPS MEASURED < <(source_fps "$VIDEO")
  log "video=$(basename "$VIDEO") measured_fps=$MEASURED cfr=$FPS"
fi

# Yuv420p needs even sizes, so an odd width or height loses one row or column of pixels.
VF="crop=trunc(iw/2)*2:trunc(ih/2)*2"
if [ "$HEIGHT" -gt 0 ]; then
  VF="$VF,scale=-2:min($HEIGHT\\,ih):flags=lanczos"
fi
VF="$VF,format=yuv420p"

# No B-frames: with them the muxer delays picture and sound by two frames (83 ms at 24 fps) on the
# media timeline, which then no longer matches the proxy that detector timestamps come from. What
# remains is the AAC priming delay, a constant 21.3 ms.
rm -rf "${OUT:?}/video" "$OUT/main" "$OUT/comfort" "$OUT/master.m3u8"
mkdir -p "$OUT"
"$FFMPEG" -hide_banner -loglevel warning -y -nostdin \
  -i "$VIDEO" -i "$AUDIO" -i "$COMFORT" \
  -map 0:v:0 -map 1:a:0 -map 2:a:0 \
  -vf "$VF" -fps_mode cfr -r "$FPS" \
  -c:v libx264 -preset medium -crf 18 -profile:v main -level 4.0 -bf 0 \
  -g "$FPS" -keyint_min "$FPS" -sc_threshold 0 -force_key_frames 'expr:gte(t,n_forced*1)' \
  -c:a aac -b:a 128k -ac 2 -ar 48000 \
  -f hls -hls_time 1 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_flags independent_segments -master_pl_name master.m3u8 \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$OUT/%v/seg_%05d.m4s" \
  -var_stream_map "v:0,agroup:aud,name:video a:0,agroup:aud,language:en,name:main,default:yes a:1,agroup:aud,language:en,name:comfort" \
  "$OUT/%v/index.m3u8"

# ffmpeg writes NAME="audio_1" and so on; the rendition names are the directory names.
sed -E '/^#EXT-X-MEDIA:TYPE=AUDIO/ s|NAME="[^"]*"(.*URI="([^/"]+)/index\.m3u8")|NAME="\2"\1|' \
  "$OUT/master.m3u8" > "$OUT/master.m3u8.tmp"
mv "$OUT/master.m3u8.tmp" "$OUT/master.m3u8"
SEGMENTS=$(grep -c '^seg_' "$OUT/video/index.m3u8" || true)
[ "$SEGMENTS" -gt 0 ] || die "no video segments were written"
log "wrote $OUT/master.m3u8 ($SEGMENTS video segments)"

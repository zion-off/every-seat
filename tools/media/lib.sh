# shellcheck shell=bash
# Shared helpers for the media scripts. Source this file; it runs nothing by itself.

FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"

die() {
  echo "error: $*" >&2
  exit 1
}

log() {
  echo "$*" >&2
}

require_ffmpeg() {
  command -v "$FFMPEG" > /dev/null || die "ffmpeg not found (set FFMPEG to its path)"
  command -v "$FFPROBE" > /dev/null || die "ffprobe not found (set FFPROBE to its path)"
}

# print_usage FILE: print the leading comment block of FILE (after the shebang) as help text.
print_usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$1"
}

# source_fps SRC: print "<integer fps> <measured fps>" for SRC; the integer is one of
# 24 25 30 48 50 60. The container header can lie (a file can claim 48 fps and be 24), so the rate
# comes from the number of video packets divided by the video duration. Integer rates matter
# because the flash detector rounds the rate to an integer, and a 23.976 fps proxy would drift
# against it.
source_fps() {
  local src="$1" packets dur
  packets=$("$FFPROBE" -v error -select_streams v:0 -count_packets \
    -show_entries stream=nb_read_packets -of csv=p=0 "$src" | head -1 | tr -d ',')
  dur=$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=duration \
    -of csv=p=0 "$src" 2> /dev/null | head -1 | tr -d ',')
  if [ -z "$dur" ] || [ "$dur" = "N/A" ]; then
    dur=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$src" | head -1)
  fi
  [ -n "$packets" ] && [ -n "$dur" ] || die "cannot read the video stream of $src"
  awk -v n="$packets" -v d="$dur" 'BEGIN {
    f = n / d; best = 24; bd = 1e9
    split("24 25 30 48 50 60", s, " ")
    for (i = 1; i <= 6; i++) {
      e = f - s[i]; if (e < 0) e = -e
      if (e < bd) { bd = e; best = s[i] }
    }
    printf "%d %.3f\n", best, f
  }'
}

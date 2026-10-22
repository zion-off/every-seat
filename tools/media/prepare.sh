#!/bin/bash
# Download the demo films from their official sources and build local HLS (one video rendition plus
# "main" and "comfort" audio) for each, plus the generated timecode test stream. Nothing is
# published: everything is written under the build directory, which git ignores.
#
# Usage: prepare.sh [--force] [FILM...]
#   FILM     elephants_dream, tears_of_steel or test_pattern (default: all three)
#   --force  rebuild even when the output is up to date
#
# For each film this
#   1. downloads the source into BUILD/downloads and checks its sha256,
#   2. extracts a normalised 48 kHz stereo main track into BUILD/work/FILM,
#   3. renders the comfort track from generated/FILM.recipe.json, else fixtures/FILM.recipe.json
#      (with neither, the default recipe applies: a limiter on the whole track),
#   4. packages BUILD/media/FILM/master.m3u8.
# Serve the result with serve_media.py.
#
# Environment: BUILD_DIR (default: build at the repository root), PYTHON (needs 3.12 or newer),
# FFMPEG and FFPROBE.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="${BUILD_DIR:-$ROOT/build}"
DOWNLOADS="$BUILD/downloads"
WORK="$BUILD/work"
MEDIA="$BUILD/media"
ALL_FILMS="elephants_dream tears_of_steel test_pattern"

usage() {
  print_usage "${BASH_SOURCE[0]}"
}

# film_source FILM: set URL, FILE and SHA256 for a downloadable film.
film_source() {
  case "$1" in
    elephants_dream)
      URL="https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov"
      SHA256="6fc295e0e92835316ec95929ccfc664b05ed2434f673e6f5e684f98f7558a547"
      ;;
    tears_of_steel)
      URL="https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov"
      SHA256="efa9062d9cdb7a338e40ad530dfdf234806743f29ae6a1a136b97ece4e588e8f"
      ;;
    *) die "unknown film $1 (known: $ALL_FILMS)" ;;
  esac
  FILE="$DOWNLOADS/$(basename "$URL")"
}

sha256_of() {
  if command -v sha256sum > /dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

resolve_python() {
  local candidate
  for candidate in "${PYTHON:-}" "$ROOT/pipeline/.venv/bin/python" python3.12 python3; do
    if [ -z "$candidate" ] || ! command -v "$candidate" > /dev/null; then
      continue
    fi
    if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 12))' 2> /dev/null; then
      PY="$candidate"
      return
    fi
  done
  die "Python 3.12 or newer not found (set PYTHON to its path)"
}

download() {
  film_source "$1"
  mkdir -p "$DOWNLOADS"
  if [ ! -f "$FILE" ]; then
    log "downloading $URL"
    curl -fL --retry 3 --retry-delay 5 -C - -o "$FILE.part" "$URL"
    mv "$FILE.part" "$FILE"
  fi
  [ "$(sha256_of "$FILE")" = "$SHA256" ] ||
    die "$FILE does not match the expected sha256 (delete it to download again)"
  log "source ok: $(basename "$FILE")"
}

# recipe_for FILM: print the recipe path to use, or nothing.
recipe_for() {
  local dir
  for dir in generated fixtures; do
    if [ -f "$ROOT/$dir/$1.recipe.json" ]; then
      echo "$ROOT/$dir/$1.recipe.json"
      return
    fi
  done
}

needs_build() {
  local master="$MEDIA/$1/master.m3u8" recipe
  [ "$FORCE" -eq 1 ] && return 0
  [ -f "$master" ] || return 0
  recipe="$(recipe_for "$1")"
  [ -n "$recipe" ] && [ "$recipe" -nt "$master" ] && return 0
  return 1
}

build_film() {
  local film="$1" src work recipe duration
  if ! needs_build "$film"; then
    log "$film: up to date (use --force to rebuild)"
    return
  fi
  download "$film"
  src="$FILE"
  work="$WORK/$film"
  mkdir -p "$work"

  # The audio stops where the video does, so the renditions have the same length.
  duration=$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=duration \
    -of csv=p=0 "$src" | head -1 | tr -d ',')
  [ -n "$duration" ] || die "cannot read the video duration of $src"
  "$FFMPEG" -hide_banner -loglevel error -y -nostdin -i "$src" -map 0:a:0 -vn -t "$duration" \
    -af "aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo" \
    -c:a pcm_s16le "$work/main.wav"

  recipe="$(recipe_for "$film")"
  if [ -z "$recipe" ]; then
    log "$film: no recipe found; using the default (limiter only)"
    recipe="$work/default.recipe.json"
    echo '{}' > "$recipe"
  fi
  "$PY" "$HERE/comfort_render.py" --recipe "$recipe" --input "$work/main.wav" \
    --output "$work/comfort.wav"

  "$HERE/hls_package.sh" --video "$src" --audio "$work/main.wav" --comfort "$work/comfort.wav" \
    --out "$MEDIA/$film"
}

build_test_pattern() {
  if [ "$FORCE" -eq 0 ] && [ -f "$MEDIA/test_pattern/master.m3u8" ]; then
    log "test_pattern: up to date (use --force to rebuild)"
    return
  fi
  "$PY" "$HERE/test_pattern.py" --out "$MEDIA/test_pattern"
}

FORCE=0
FILMS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "unknown option $1" ;;
    *) FILMS="$FILMS $1" ;;
  esac
  shift
done
FILMS="${FILMS:-$ALL_FILMS}"

for film in $FILMS; do
  case " $ALL_FILMS " in
    *" $film "*) ;;
    *) die "unknown film $film (known: $ALL_FILMS)" ;;
  esac
done

require_ffmpeg
command -v curl > /dev/null || die "curl not found"
resolve_python

for film in $FILMS; do
  log "== $film"
  if [ "$film" = test_pattern ]; then
    build_test_pattern
  else
    build_film "$film"
  fi
done
log "done: serve the result with tools/media/serve_media.py"

#!/usr/bin/env bash
# Builds the app (Release, aarch64) and installs it on the running Vega Virtual Device.
#
# Usage: scripts/deploy.sh [--no-install]
#
# Needs Java 21 and Node 20.x on PATH, and the Vega SDK environment loaded (`vega` on PATH).
# To load them from a file instead, set EVERYSEAT_ENV to a shell file that exports them.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [ -n "${EVERYSEAT_ENV:-}" ]; then
  # shellcheck disable=SC1090
  . "$EVERYSEAT_ENV"
fi

die() {
  echo "deploy: $*" >&2
  exit 1
}

command -v vega > /dev/null || die "vega not found on PATH (load the Vega SDK environment)"
java -version 2>&1 | grep -q '"21\.' || die "Java 21 is required"
node -v | grep -q '^v20\.' || die "Node 20.x is required"

[ -d node_modules ] || npm install

log="${TMPDIR:-/tmp}/everyseat-build.log"
start=$(date +%s)
CI=true npm run build:release > "$log" 2>&1 || {
  grep -i error "$log" | head -20
  die "build failed (see $log)"
}
echo "build: $(($(date +%s) - start))s"
rm -f buildinfo.json

[ "${1:-}" = "--no-install" ] && exit 0

vpkg=$(ls build/aarch64-release/*_aarch64.vpkg 2> /dev/null | head -1)
[ -n "$vpkg" ] || die "no aarch64 package found under build/aarch64-release"
vega run-app "$vpkg"

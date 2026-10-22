#!/bin/sh
# Fetch a proxy from a presigned URL, analyze it and upload the results as one archive.
#
# Usage: iris-task GET_URL PUT_URL [NAME]
#
# The task needs no storage permissions: both URLs are presigned by the caller. The archive holds
# the whole results directory (<NAME>/result.json, <NAME>/framedata*.csv, run.log), so the caller
# can unpack it and read it exactly like a local run. The exit status is the analyzer's.
set -u

get_url=$1
put_url=$2
name=${3:-proxy.mp4}
: "${IRIS_OUT:=/out}"

work=$(mktemp -d)
mkdir -p "$IRIS_OUT"

curl -fsS --retry 3 --retry-all-errors -o "$work/$name" "$get_url" || {
  echo "iris-task: could not download the proxy" >&2
  exit 2
}

/usr/local/bin/iris-run "$work/$name" >"$work/run.log" 2>&1
status=$?
cp "$work/run.log" "$IRIS_OUT/run.log"
tail -n 40 "$work/run.log"

tar -C "$IRIS_OUT" -czf "$work/out.tgz" . || exit 3
curl -fsS --retry 3 --retry-all-errors -T "$work/out.tgz" "$put_url" || {
  echo "iris-task: could not upload the results" >&2
  exit 4
}
exit "$status"

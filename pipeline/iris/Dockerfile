# Flash analyzer: EA IRIS (official C++ release 1.1.0, Linux x86-64 example app). The release is
# x86-64 only, so run the image as linux/amd64 (emulated on Apple silicon, native on Fargate x86).
#
# Build:  docker build --platform linux/amd64 -t iris-cpp:1.1.0 pipeline/iris
# Run:    docker run --rm --platform linux/amd64 --network none \
#           -v /path/to/media:/media:ro -v /path/to/results:/out iris-cpp:1.1.0 /media/proxy.mp4
# Output: /out/<video file name>/{framedata*.csv,result.json,frameData.json}. The exit code is 0 even
#         when the verdict is a failure, so read result.json ("OverallResult": Pass |
#         PassWithWarning | Fail).
#
# Notes:
#  * The binary is statically linked against OpenCV and FFmpeg and needs only glibc and libstdc++.
#  * IrisApp reads ./appsettings.json and writes logs/ in its working directory, so the entrypoint
#    runs in $IRIS_OUT.
#  * IRIS rounds the frame rate to an integer and trusts the container header: feed it a constant
#    frame rate proxy at native resolution. Frame resizing is disabled in the default settings
#    because a 50% resize turned a six-transition warning into a failure.
#  * IRIS rotates and appends framedata*.csv, so never reuse a results directory.
FROM ubuntu:24.04

ARG IRIS_VERSION=1.1.0
ARG IRIS_SHA256=440eb0cb814a03a4eff7c8c4f499492b669a33cf2ba4f23843b479365eeedaeb

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL -o /tmp/iris.tgz \
      "https://github.com/electronicarts/IRIS/releases/download/${IRIS_VERSION}/iris-${IRIS_VERSION}-ubuntu-example-app.tar.gz" \
 && echo "${IRIS_SHA256}  /tmp/iris.tgz" | sha256sum -c - \
 && mkdir -p /opt/iris && tar -xzf /tmp/iris.tgz -C /opt/iris && rm /tmp/iris.tgz \
 && sed -i '1a\  "ResultsPath": "./",' /opt/iris/appsettings.json \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && printf '%s\n' '#!/bin/sh' 'set -eu' \
      ': "${IRIS_OUT:=/out}"' 'mkdir -p "$IRIS_OUT" && cd "$IRIS_OUT"' \
      'cp /opt/iris/appsettings.json ./appsettings.json' \
      'exec /opt/iris/IrisApp -j 1 -v "$@"' > /usr/local/bin/iris-run \
 && chmod 755 /usr/local/bin/iris-run /opt/iris/IrisApp \
 && useradd --system --uid 10001 iris && mkdir -p /out && chown iris /out

USER iris
ENV IRIS_OUT=/out
ENTRYPOINT ["/usr/local/bin/iris-run"]

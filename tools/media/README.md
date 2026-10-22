# Media tooling

Scripts that turn films into the local streams the Fire TV app plays, and into the constant-frame-rate proxies the analysis uses. Everything is written under `build/` (git ignores it); no media is ever committed. Requires `ffmpeg` and `ffprobe` (8.x tested, no `drawtext` filter needed), `curl`, and Python 3.12 or newer.

## Build and serve

```sh
tools/media/prepare.sh                      # all three titles: downloads, comfort audio, HLS, cue list
tools/media/prepare.sh tears_of_steel       # one title
pipeline/.venv/bin/python tools/media/serve_media.py --port 8080
```

The emulator reaches the Mac's localhost as `10.0.2.2`, so a stream is at `http://10.0.2.2:8080/<title>/master.m3u8`.

| Title | Source | Output |
|---|---|---|
| `elephants_dream` | official download, sha256 checked | `build/media/elephants_dream/` (720x404, 24 fps) |
| `tears_of_steel` | official download, sha256 checked | `build/media/tears_of_steel/` (1280x534, 24 fps) |
| `test_pattern` | generated, 120 s at 30 fps | `build/media/test_pattern/` (1280x720) |

Sources are downloaded to `build/downloads/`, intermediates (the normalised main track and the comfort render) go to `build/work/<title>/`. A title is skipped when its output exists and is newer than its recipe; `--force` rebuilds.

Each output is an HLS master playlist with one H.264 video rendition and two AAC audio renditions in one group, both `LANGUAGE="en"`: `main` (default) and `comfort`. Segments are fMP4, 1 s long, and each starts on a keyframe (1 s GOPs, no B-frames), so the player can switch audio renditions at any segment boundary. Main and comfort segments have identical durations. The title's cue list is copied next to it as `cues.sensevtt` (from `generated/<title>.sensevtt`, else `fixtures/<title>.sensevtt`).

## Comfort recipes

`comfort_render.py` renders the comfort track from a recipe: a gain-ride around each loud moment plus a look-ahead limiter on the whole track.

```json
{"gain_db": -18, "pre_s": 0.4, "ramp_s": 0.3, "release_s": 1.0, "limiter": 0.25,
 "windows": [{"onset": 463.375, "end": 466.5}]}
```

For each window the gain starts falling at `onset - pre_s`, reaches `gain_db` after `ramp_s`, holds until `end`, then releases over `release_s`. Every key except `windows` is optional. `prepare.sh` reads `generated/<title>.recipe.json` if it exists, else `fixtures/<title>.recipe.json`; with neither, it applies the default recipe (the limiter only).

The limiter caps the peaks of the whole track, not just the windows, so the comfort track is quieter overall. For `tears_of_steel` the integrated loudness drops from -12.0 to -20.2 LUFS.

## Scripts

| Script | Purpose |
|---|---|
| `prepare.sh` | Download, build comfort audio and package every title |
| `cfr_proxy.sh` | Constant-frame-rate proxy for analysis. `--native` (default) keeps the source resolution; `--width N` scales, for contact sheets only |
| `hls_package.sh` | Package video plus main and comfort audio as HLS |
| `comfort_render.py` | Render the comfort track from a recipe (`--print-filter` shows the ffmpeg filter) |
| `test_pattern.py` | Generate the timecode test stream (440 Hz main, 880 Hz comfort) |
| `serve_media.py` | Plain-HTTP server for `build/media`, bound to 127.0.0.1 |
| `lib.sh` | Shared shell helpers |

Run any script with `--help` for its options.

## Notes

- The frame rate is measured from the video packets and snapped to an integer (24, 25, 30, 48, 50 or 60). Detector timestamps are only valid against a proxy at that rate.
- Make the analysis proxy at native resolution. The odd-sized source (`elephants_dream` is 720x405) loses one row, nothing is resampled.
- The HLS timeline runs 21.3 ms late against the source: the AAC encoder's priming delay (the first video frame is at 0.021 s). With default encoder settings it would be 83 ms late at 24 fps, because of B-frame reordering, which is why packaging uses none.
- The comfort render steps the gain every 256 samples. With ffmpeg's default frame size (4096 samples, 85 ms) the ramp would move in steps of about 5 dB.

## Lint

```sh
shellcheck -x -P SCRIPTDIR tools/media/*.sh
pipeline/.venv/bin/ruff check --config pipeline/pyproject.toml tools/media
pipeline/.venv/bin/ruff format --check --config pipeline/pyproject.toml tools/media
```

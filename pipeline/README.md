# Every Seat analysis pipeline

Pre-analyzes a film for flashing, sudden loud moments and scares, and writes the cue file the TV
app reads.

## Setup

```sh
python3.12 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

Needs `ffmpeg` and `ffprobe` on `PATH` (or `FFMPEG` / `FFPROBE` set), and Docker for the flash
analyzer, which ships as an x86 image:

```sh
docker build --platform linux/amd64 -t iris-cpp:1.1.0 iris
```

Set `EVERYSEAT_IRIS_IMAGE` to use a different image name.

## Detectors

`everyseat candidates` runs the deterministic detectors and prints what each found:

```sh
everyseat candidates film.mov --start 420 --duration 90 --out candidates.json
```

- **Proxy:** a constant-frame-rate, native-resolution copy at an integer rate (measured from the
  source, snapped to 24/25/30/48/50/60). Every detector reads it, so all times lie on one frame
  grid. `--start` must fall on that grid.
- **Flash runs:** the IRIS analyzer in a container, run on the proxy without resizing. Reports a
  verdict (`PASS`, `PASS_WITH_WARNING`, `FAIL`) and the flagged stretches.
- **Loud onsets:** 50 ms RMS windows after a 40 Hz high-pass; an onset is a rise of at least 15 dB
  within 200 ms from a quieter baseline. An EBU R128 summary is included.
- **Shot cuts:** ffmpeg's scene score on a 320 px copy (`--scene`, default 0.12).

Times in the JSON are seconds on the film's clock (excerpt start included) and on the frame grid.
Work files go to `build/work/<name>` unless `--work-dir` is given. `--no-iris` skips the flash
analysis and reports its verdict as `NOT_RUN`.

## Analysis

`everyseat analyze` runs the detectors, then a Strands agent on Amazon Nova Pro assesses the
candidates and writes the cue file:

```sh
AWS_PROFILE=personal AWS_REGION=us-east-1 \
  everyseat analyze film.mov --start 420 --duration 90 --title my-film --out-dir generated
```

- **Division of work:** detectors set every time and anchor; the model decides which candidates
  get a cue, how intense it is, and writes a short preview. `--model nova-2-lite` selects the
  other supported model.
- **Tools:** `inspect` returns a contact sheet and a loudness strip for a window (film-time
  seconds), `submit_cue`, `skip_candidate`, `drop_cue` and `validate`. A scare or a flash warning
  can only be submitted for a window that was inspected, and a loud cue needs a jump of at least
  15 dB to a peak above -20 dBFS.
- **Checks:** every candidate needs a decision, flash failures get intensity 4 or 5, and the cue
  file must pass the SenseVTT validator, with heads-up cards that never overlap an earlier
  moment. Loud or scare cues less than 2 s apart (flash cues: closer than their margins) are
  merged.
- **Outputs:** `<name>.sensevtt`, `<name>.recipe.json` (the comfort render settings, built from
  the loud cues) and `<name>.run.json` (model, token usage and estimated cost, inspections,
  skipped candidates, open problems).
- **Cost:** $0.03 to $0.10 for a 90 s excerpt with Nova Pro. Images are paid for once: after the
  model has seen a tool image, later calls carry a text note instead.

## Lint

```sh
.venv/bin/ruff check . && .venv/bin/ruff format --check .
```

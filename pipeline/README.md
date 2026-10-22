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

## Audio description

`everyseat describe` finds the dialogue-free stretches of a film, has Nova Pro write a short
description of the picture for each, voices it with Polly, and writes `ad` cues that point at the
audio clips:

```sh
AWS_PROFILE=personal AWS_REGION=us-east-1 \
  everyseat describe film.mkv --subtitles film_en.srt --title my-film \
  --cast "Name=who they are" --clips-dir build/ad
```

- **Windows:** the gaps of at least `--min-gap` (10 s) between subtitle lines, trimmed by 0.5 s at
  each end and cut into equal windows of at most `--max-window` (30 s), all on the frame grid. The
  quiet stretch before the first line and after the last counts too.
- **What the writer sees:** a contact sheet with one frame per shot in the window (labelled in
  plain seconds), the dialogue just before and after, the earlier descriptions and the `--cast`
  notes, so names stay consistent. It writes to a budget of about 2.5 words a second, in the
  present tense, only what is visible and essential, without interpretation or spoilers, and may
  decline a window where nothing essential is on screen.
- **Fitting:** Polly neural renders 16 kHz mono PCM, so the clip length is exactly bytes divided by
  32000. A clip longer than its window goes back to the writer to be shortened (up to 3 times);
  the last resort is SSML prosody at 110%. A window that still does not fit stops the run.
- **Outputs:** one `<title>-ad-<n>.wav` per window in `<clips-dir>/<title>/`, the cue file
  (`generated/<title>.sensevtt`; each cue starts at its window start and carries
  `audio_ref {uri, duration_s}`, a one-line `preview` and the full text in `evidence`) and
  `<title>.run.json` beside it with every attempt, token usage and the estimated cost. Clip
  addresses are relative (`ad/<title>/<id>.wav`) so the companion can serve them.
- **`--dry-run`:** placeholder text and silent clips of the length a voice would take, written next
  to the clips as `<title>.dry-run.sensevtt`. Nothing touches AWS (no session is created, so no
  credentials are read), which makes it the way to check the whole flow offline.
- **Cost:** about 33 Nova Pro calls for Sintel (one contact sheet each) plus rewrites, a few cents;
  Polly neural is $16 per million characters.

## Evaluation

`everyseat eval` scores the cue files from `analyze` against labelled events (timing error, events
found, extra cues, cost) and compares models. The label format, the run script and the committed
results are in `eval/`.

## Cloud

`infra/` deploys the pipeline to AWS: a film uploaded to a bucket starts a job in an AgentCore
Runtime, the flash analyzer runs as a one-off Fargate task, and the cue file and a `status.json`
land in a results bucket. `infra/README.md` has the deploy, verify and teardown steps and the
billable resources. The runtime container is built from `agent.Dockerfile`.

Two switches select the cloud behaviour; the images set them and local runs leave them unset:

- `EVERYSEAT_IRIS_BACKEND=fargate` runs the flash analyzer as a Fargate task instead of a local
  container (cluster, task definition, subnets, security groups and a staging bucket come from
  `EVERYSEAT_IRIS_*` variables).
- `EVERYSEAT_AWS_SESSION=role` makes Bedrock calls with the credentials of the attached role
  instead of a named profile.

## Lint

```sh
.venv/bin/ruff check . && .venv/bin/ruff format --check .
```

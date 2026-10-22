# Evaluation

Scores the cue files `everyseat analyze` writes against labelled events, and compares models on
timing error, events found, extra cues, cost and speed.

```sh
pipeline/eval/run_models.sh                     # every model, RUNS=3 runs per excerpt
everyseat eval --out pipeline/eval/RESULTS.md   # score runs/ against labels/
```

`run_models.sh` needs the source films in `FILMS_DIR` (default `build/downloads`), Docker for the
flash analyzer, and AWS credentials in the `personal` profile. It makes single Bedrock model calls
only; the committed runs cost about $0.34 in total. `MODELS` and `RUNS` override the models and
the number of runs.

## Layout

- `labels/<name>.json`: the labelled events of one film excerpt.
- `runs/<model>/<run>/<name>.{sensevtt,recipe.json,run.json}`: what `everyseat analyze --name
  <name>` wrote. A run whose log says it failed counts as a failed run with no cues.
- `RESULTS.md`: the table `everyseat eval` writes.

## Label file

```json
{
 "version": 1,
 "name": "tears_of_steel_excerpt",
 "film": "tears-of-steel",
 "excerpt": {"start_s": 420, "duration_s": 90},
 "complete": false,
 "tolerance_s": {"loud": 0.5},
 "events": [
  {"type": "loud", "start_s": 463.2, "intensity": 5, "source": "hand", "note": "..."}
 ]
}
```

- `name` is the file name without `.json` and the `--name` the runs were written with. `excerpt`
  must equal the `--start` and `--duration` of those runs; `eval` refuses a mismatch.
- `events[].type` is `flash`, `loud` or `scare`. `start_s` is film time in seconds: when the
  viewer first needs the cue (for a flash, when the flashing starts). `end_s` and `intensity`
  (1 to 5) are optional; with `intensity`, the table reports the mean absolute difference.
- `events[].source` is `hand` for a person's label. Anything else (`waveform`, `flash analyzer`)
  is an instrument reading and is not counted as hand-labelled.
- `tolerance_s` overrides the match window per type (defaults: flash 1 s, loud 0.5 s, scare
  0.5 s). A cue finds an event when the type is equal and the starts are within the tolerance;
  each cue and each event is used once, nearest first.
- `complete: true` says every event of the excerpt is listed. Only then are unmatched cues wrong,
  so precision is reported only for complete files. Otherwise unmatched cues are counted as extra.

## Adding labels

Watch the excerpt, write one event per moment that needs a cue, set `"source": "hand"`, and set
`"complete": true` once nothing else in the excerpt needs one. Another film or excerpt needs its
own label file, and a line in `run_models.sh` to run it. Then run the two commands above.

Hand-written sample data for local development (cue files, test-stream definitions).

## SenseVTT cue files

A `.sensevtt` file is WebVTT whose cues carry one line of JSON. A `NOTE sensevtt-header` block comes first, followed by one line of JSON with the title, analyzer, source hash, integer frame rate and flash-analysis verdict. Each cue has an optional identifier, a timing line, and one line of JSON. The timing line is the event itself; ramp and lead margins (`pre_s`, `post_s`, `lead_s`) live only in the JSON. Times are frame-snapped to the header's frame rate.

| File | Contents |
|---|---|
| `elephants_dream.sensevtt` | One `flash` cue (6:17.5–6:20.0, `anchor: iris`) |
| `tears_of_steel.sensevtt` | A `loud` and a `scare` cue sharing one event (7:43.375–7:46.5, `anchor: onset`), with the measured detail in `evidence` |
| `test_pattern.sensevtt` | One cue of each type (`flash`, `loud`, `scare`, `ad`) for the generated 120 s timecode test stream, at round times |
| `tears_of_steel.recipe.json` | Comfort-audio recipe for the loud cue (gain-ride window 463.375–466.5 plus a limiter); `tools/media/prepare.sh` renders the comfort track from it |

Check files with the validator (the SenseVTT library's, run through the pipeline's `everyseat-validate`):

```sh
pipeline/.venv/bin/everyseat-validate fixtures/*.sensevtt
```

Relay message streams (one JSON object per line) can be checked with `everyseat-validate --relay FILE`, where `-` reads from stdin. The relay and lens JSON Schemas are in `pipeline/everyseat/contracts/schemas/`, and the matching TypeScript types are in `companion/src/contracts.d.ts`. The cue file schemas ship with the SenseVTT library.

## Audio description inputs

| File | Contents |
|---|---|
| `describe_script.json` | Scripted answers for a dry run of `everyseat describe` on the Sintel film, per window, each item citing a contact-sheet tile: a sentence on a black opening tile, tiles out of order, a tile off the sheet, merged and dropped items, each of the writer's rejection paths (repeats, camera words, too long, too short, nothing to add, no acceptable answer) and the shorten loop |
| `sintel.plot.txt` | A short, spoiler-light synopsis of Sintel, passed with `--plot` so the descriptions recognise the characters and places and keep their names consistent |
| `sintel.ad-overrides.json` | An empty list of human corrections for the Sintel descriptions, passed with `--overrides`: add `{"near_s": 368.5, "text": "..."}` to replace the nearest item or `{"near_s": 368.5, "drop": true}` to remove it |

```sh
pipeline/.venv/bin/everyseat describe film.mkv --subtitles film.srt --dry-run --script fixtures/describe_script.json
```

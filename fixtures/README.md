Hand-written sample data for local development (cue files, test-stream definitions).

## SenseVTT cue files

A `.sensevtt` file is WebVTT whose cues carry one line of JSON. A `NOTE everyseat-header` block comes first, followed by one line of JSON with the title, analyzer, source hash, integer frame rate and flash-analysis verdict. Each cue has an optional identifier, a timing line, and one line of JSON. The timing line is the event itself; ramp and lead margins (`pre_s`, `post_s`, `lead_s`) live only in the JSON. Times are frame-snapped to the header's frame rate.

| File | Contents |
|---|---|
| `elephants_dream.sensevtt` | One `flash` cue (6:17.5–6:20.0, `anchor: iris`) |
| `tears_of_steel.sensevtt` | A `loud` and a `scare` cue sharing one event (7:43.375–7:46.5, `anchor: onset`), with the measured detail in `evidence` |
| `test_pattern.sensevtt` | One cue of each type (`flash`, `loud`, `scare`, `ad`) for the generated 120 s timecode test stream, at round times |

Check files with the validator:

```sh
pipeline/.venv/bin/everyseat-validate fixtures/*.sensevtt
```

Relay message streams (one JSON object per line) can be checked with `everyseat-validate --relay FILE`, where `-` reads from stdin. The JSON Schemas are in `pipeline/everyseat/contracts/schemas/`, and the matching TypeScript types are in `companion/src/contracts.d.ts`.

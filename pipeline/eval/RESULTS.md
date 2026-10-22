# Evaluation results

3 labelled events in 2 excerpts (0 hand-labelled). A cue finds an event when it has the same type and starts within the tolerance (flash 1 s, loud 0.5 s, scare 0.5 s); each cue and event is used once. Start error is the cue start minus the labelled start, in seconds. Precision needs every event of an excerpt to be labelled, so it is only computed for label files marked complete; other cues are counted as extra, not as wrong.

No event is hand-labelled yet: the events come from instrument readings and a reference cue file, so this table checks the harness and the timing, not how well the cues match what a viewer would want.

## Models

| Model | Excerpt runs | Events found | Start error (s) | Intensity error | Precision | Extra cues per run | Cost per run (USD) | Input / output tokens per run | Model calls per run |
|---|---|---|---|---|---|---|---|---|---|
| nova-2-lite | 6 | 6/9 (67%) | mean -0.017, median abs 0.025, max abs 0.042 | mean abs 0.5 (n=6) | n/a (labels not complete) | 3.2 | 0.0234 | 68,894 / 1,088 | 13.8 |
| nova-pro | 6 | 8/9 (89%) | mean -0.011, median abs 0.008, max abs 0.042 | mean abs 0.5 (n=8) | n/a (labels not complete) | 4.3 | 0.0339 | 36,608 / 1,439 | 5.0 |

## Events

| Excerpt | Event | Source | nova-2-lite found | nova-pro found |
|---|---|---|---|---|
| elephants_dream_excerpt | flash 377.5–380 s | flash analyzer | 3/3 (-0.042, -0.042, -0.042 s) | 3/3 (-0.042, -0.042, -0.042 s) |
| tears_of_steel_excerpt | loud 463.2 s | waveform | 3/3 (+0.008, +0.008, +0.008 s) | 3/3 (+0.008, +0.008, +0.008 s) |
| tears_of_steel_excerpt | scare 463.2 s | reference cue file | 0/3 | 2/3 (+0.008, +0.008 s) |

## Runs

| Excerpt | Model | Run | Cues (flash / loud / scare) | Events found | Extra cues | Cost (USD) | Time (s) |
|---|---|---|---|---|---|---|---|
| elephants_dream_excerpt | nova-2-lite | 1 | 1 / 3 / 0 | 1/1 | 3 | 0.0339 | 28.9 |
| elephants_dream_excerpt | nova-2-lite | 2 | 1 / 5 / 0 | 1/1 | 5 | 0.0436 | 44.5 |
| elephants_dream_excerpt | nova-2-lite | 3 | 1 / 4 / 0 | 1/1 | 4 | 0.0419 | 69.7 |
| elephants_dream_excerpt | nova-pro | 1 | 3 / 4 / 1 | 1/1 | 7 | 0.0350 | 32.3 |
| elephants_dream_excerpt | nova-pro | 2 | 3 / 5 / 0 | 1/1 | 7 | 0.0390 | 23.9 |
| elephants_dream_excerpt | nova-pro | 3 | 2 / 5 / 0 | 1/1 | 6 | 0.0679 | 31.5 |
| tears_of_steel_excerpt | nova-2-lite | 1 | 1 / 2 / 0 | 1/2 | 2 | 0.0058 | 8 |
| tears_of_steel_excerpt | nova-2-lite | 2 | 1 / 2 / 0 | 1/2 | 2 | 0.0059 | 14.2 |
| tears_of_steel_excerpt | nova-2-lite | 3 | 2 / 2 / 0 | 1/2 | 3 | 0.0092 | 11.6 |
| tears_of_steel_excerpt | nova-pro | 1 | 1 / 2 / 1 | 2/2 | 2 | 0.0214 | 12.9 |
| tears_of_steel_excerpt | nova-pro | 2 | 2 / 2 / 1 | 2/2 | 3 | 0.0226 | 19.5 |
| tears_of_steel_excerpt | nova-pro | 3 | 0 / 2 / 0 | 1/2 | 1 | 0.0175 | 12 |

Total model spend for these runs: about $0.34.

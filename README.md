# Every Seat

Same movie. Every seat.

Every Seat is comfort for everyone on the couch. It is a Fire TV (Vega OS) app that pre-analyzes a
film and then, for each person watching, can:

- **soften flashes** by dimming the picture through flashing sequences,
- **cap sudden loud sounds** with a comfort audio track that holds peaks down,
- **give a heads-up before scares**, and
- **describe the picture** as audio description that plays on your phone, in step with the TV, so
  only the people who want it hear it.

The household is set up by remote or by voice: each person has their own settings, and the TV plays
the film for the combined couch. Every Seat offers comfort, not safety, and it is not a medical
device.

## How it works

```
                    +----------------------+          +--------------------------+
   remote / voice   |   TV app (Vega OS)   |   lens   |  companion (Node 22)     |
  ----------------> |  React Native + Shaka| <------> |  MCP server, relay,      |
                    |  SenseVTT engine     |  clock   |  voice page (Nova 2 Lite)|
                    +----------------------+          +------------+-------------+
                              ^   reads cue file                    |  clock + clips
                              |   + HLS (main/comfort)              v
                    +---------+-------------+           +--------------------------+
                    |  media server (HLS)   |           |  phone page: audio       |
                    +-----------------------+           |  description, in sync    |
                                                        +--------------------------+

  Analysis pipeline (AWS, optional)

  S3 --> EventBridge --> Lambda --> AgentCore Runtime (Strands agent + Nova Pro)
                                          |                    |
                                          |                    +--> Polly (voiced descriptions)
                                          +--> Fargate (EA IRIS flash analysis)
                                          v
                                    S3: .sensevtt cue file + status
```

1. The pipeline runs deterministic detectors (flash analysis with IRIS, loudness onsets, shot cuts)
   and a Strands agent on Amazon Nova Pro decides which candidates become cues, how intense each is
   and what the heads-up says. Detectors set every time; the model never invents one.
2. The result is a `.sensevtt` file: WebVTT with one line of JSON per cue, read by the app with the
   [SenseVTT](https://github.com/zion-off/sensevtt) library.
3. The TV app plays the film from HLS with two audio renditions (`main` and `comfort`), dims the
   picture before each flash, switches to the comfort track for loud moments, and shows heads-ups.
4. The companion carries the combined settings of the people on the couch to the TV and the TV's
   playback clock to phones. Its voice page turns a spoken sentence into changes with Amazon Nova 2
   Lite.

### AWS services and models

| Service | Used for |
| --- | --- |
| Amazon Bedrock, `us.amazon.nova-pro-v1:0` | The analysis agent that assesses candidates and writes cues and descriptions |
| Amazon Bedrock, `us.amazon.nova-2-lite-v1:0` | The voice companion (`/converse`) |
| Amazon Bedrock AgentCore Runtime, Strands Agents | Runs the analysis agent |
| S3, EventBridge, Lambda | A film upload starts a job; results land in S3 |
| ECS Fargate | The IRIS flash analyzer, one x86 task per run |
| Amazon Polly (neural) | Voices the audio descriptions |
| DynamoDB (optional) | Household settings, instead of a local JSON file |

Region: `us-east-1`.

## Run it locally (no AWS needed)

The demo runs entirely on one Mac. The films, comfort audio, cue files and descriptions are built
from the committed recipes and files; nothing needs a cloud account. (The voice page is the one
piece that calls Bedrock, and it is optional.)

### Prerequisites

- macOS on Apple Silicon
- Vega SDK and a Vega Virtual Device (VVD)
- Java 21
- Node 20.12 for the app build, Node 22 for the companion
- Python 3.12
- ffmpeg and ffprobe, curl, git

### 1. Build the media

```sh
tools/media/prepare.sh
```

This downloads the Blender films from their official sources (checking sha256), and builds HLS
streams with a `main` and a `comfort` audio rendition under `build/media/`. It works from the
committed recipes in `fixtures/` and `generated/`. Pass a film name (`elephants_dream`,
`tears_of_steel`, `sintel`, `test_pattern`) to build just one. See [tools/media](tools/media/README.md).

### 2. Start the media server

```sh
python3.12 tools/media/serve_media.py --port 8080
```

### 3. Build and install the app

With the Vega environment loaded (Java 21, Node 20.12, `vega` on `PATH`) and the VVD running:

```sh
cd app
npm ci
npm run typecheck
scripts/deploy.sh        # Release build, then installs and launches on the running VVD
```

Or skip the build: install the prebuilt `.vpkg` from the GitHub Releases page (see Releases) with
`vega run-app everyseat-app_aarch64.vpkg`. Details are in [app/README.md](app/README.md).

### 4. Start the companion

```sh
cd companion
npm ci
npm run web:install
npm run web:build                  # the voice page
EVERYSEAT_HOST=0.0.0.0 EVERYSEAT_DEMO_HOUSEHOLD=1 npm start
```

`EVERYSEAT_DEMO_HOUSEHOLD=1` starts the demo household (Leo, Mom, Grandpa and Dad) with different
settings each. The startup log prints the phone address. The voice page at
`http://127.0.0.1:8787/` needs AWS credentials for Bedrock (`AWS_PROFILE=... npm start`); everything
else works without them. All settings are in [companion/README.md](companion/README.md).

### 5. Open the phone page

On a phone on the same Wi-Fi, open the `phone page:` address from the companion's log, for example
`http://192.168.1.20:8787/phone/`. Tap **Start** once (that turns on audio), set Auto-Lock to Never
so the screen stays on, and turn the volume up. Then play a film on the TV: the page follows it and
speaks the audio description in step. The audio description clips for Sintel are in
`generated/ad/`; `tools/media/export_ad.py` makes more from `everyseat describe` output.

## Deploy the analysis pipeline (optional)

The cue files in `generated/` and `fixtures/` are already analyzed. To analyze your own film in AWS,
or locally with Docker, see [pipeline/README.md](pipeline/README.md) and
[pipeline/infra/README.md](pipeline/infra/README.md).

## Measured results

- **Flashes:** on Elephants Dream the IRIS verdict goes from FAIL to PASS once the flagged stretch
  is softened, and the luminance swing falls from 0.33 to 0.071.
- **Loud sounds:** the comfort track cuts the Tears of Steel crash by about 18 dB.
- **Latency:** a change to the couch shows on the TV in about 0.1 to 0.35 s.
- **Cloud analysis:** a 90 s excerpt is analyzed in the cloud in 2 min 43 s for about $0.03.
- **Models:** Nova Pro finds 8 of 9 labelled events and Nova 2 Lite finds 6 of 9
  ([pipeline/eval/RESULTS.md](pipeline/eval/RESULTS.md)).

## SenseVTT

The cue file format and the playback engine live in a separate library, **SenseVTT**:
[github.com/zion-off/sensevtt](https://github.com/zion-off/sensevtt). The TV app is built on the
npm package `sensevtt` (cue parsing, media clock, dim and volume-duck scheduling, the Vega video
adapter) and the pipeline reads and writes cue files with the Python package.

## Repository layout

| Path | Contents |
| --- | --- |
| `app/` | Fire TV app (Vega OS, React Native 0.72) |
| `pipeline/` | Analysis pipeline: detectors, Nova agent, audio description, contracts, `infra/` (CDK and AgentCore) |
| `companion/` | MCP server, relay, voice page and phone audio-description page (Node 22) |
| `tools/media/` | Film download, HLS and comfort audio build, media server, clip export |
| `fixtures/` | Hand-written sample data: cue files, recipes, demo household |
| `generated/` | Pipeline output: cue files, recipes, run logs and audio description clips (`ad/`) |

## Credits and licenses

- The demo films are by the Blender Foundation, licensed
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/): *Elephants Dream*, *Tears of Steel*
  and *Sintel*, "Blender Foundation | studio.blender.org". They are downloaded from the official
  sources and are not part of this repository. This project changes them: it re-encodes them to
  HLS, adds a comfort audio track with gain reduction on loud moments, and (on the TV) dims flashing
  moments.
- [IRIS](https://github.com/electronicarts/IRIS), the flash analyzer from Electronic Arts, is
  BSD-3-Clause.
- Shaka Player is Apache-2.0; see [app/LICENSE-THIRD-PARTY](app/LICENSE-THIRD-PARTY).
- This repository is MIT; see [LICENSE](LICENSE).

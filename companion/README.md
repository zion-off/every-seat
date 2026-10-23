# Companion

The companion is a small Node server that sits next to the TV app. It does five jobs:

- **MCP server** at `/mcp` (Streamable HTTP, protocol 2025-11-25). Voice assistants and other MCP hosts use it to ask whether a film is comfortable for the people on the couch and to change what the TV does tonight.
- **WebSocket relay** at `/relay`. It carries the combined comfort lens from the companion to the TV, and the playback clock from the TV to phones.
- **Preference store.** Each household's people and comfort settings live in a local JSON file, or optionally in DynamoDB. A household starts empty; the TV's household editor and `remember_preference` fill it.
- **Voice page.** A voice-assistant style web page at `/`, backed by `/converse`, which turns a spoken or typed sentence into tool calls with Amazon Nova 2 Lite. See [Voice page](#voice-page).
- **Phone page.** A page at `/phone/` that plays a film's audio description from the phone, in step with the TV. See [Phone page](#phone-page).

It needs Node 22 (`nvm use` reads `.nvmrc`).

```sh
npm install
npm run web:install   # the voice page is a separate package in web/
npm run web:build     # builds web/dist, which the server serves at /
AWS_PROFILE=personal npm start   # http://127.0.0.1:8787, card sandbox on :8788
npm run lint          # eslint and strict type-checks of the server and the page
```

`GET /healthz` returns the number of known titles and the relay's connection counts.

## Settings

Every setting has a default that works on a laptop. Set them as environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `EVERYSEAT_PORT` | `8787` | HTTP and WebSocket port. |
| `EVERYSEAT_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` to let a TV or phone on the network connect. |
| `EVERYSEAT_API_KEY` | unset | When set, `/mcp`, `/converse` and `/relay` require it as `Authorization: Bearer <key>`, `X-API-Key: <key>`, or (relay only) `?key=<key>`. A bad key gets a bare `401` with no `WWW-Authenticate` header. |
| `EVERYSEAT_SANDBOX_PORT` | `8788` | Port of the second origin that hosts comfort cards. Must differ from `EVERYSEAT_PORT`. |
| `EVERYSEAT_WEB_DIR` | `web/dist` | Built page to serve at `/`. Skipped when the directory doesn't exist. |
| `EVERYSEAT_AD_DIR` | `../build/ad` | Directory whose `<title>/` folders hold the audio description clips served under `/ad/`. |
| `EVERYSEAT_CONVERSE_MODEL` | `us.amazon.nova-2-lite-v1:0` | Bedrock model for `/converse`. Only Amazon Nova model ids are accepted. |
| `AWS_PROFILE`, `AWS_REGION` | unset, `us-east-1` | AWS credentials and region for `/converse`. Without a credential source `/converse` answers `503`. |
| `EVERYSEAT_HOUSEHOLD` | `demo` | Household the MCP tools act on. |
| `EVERYSEAT_CUES_DIR` | `../fixtures` and `../generated` | Directories (separated by `:`) scanned recursively for `.sensevtt` files. Later directories override earlier ones. |
| `EVERYSEAT_TITLES_FILE` | `data/titles.json` | Display name and duration per title id. A title missing from it gets its id as a name and the last cue's end plus 30 s as its duration. |
| `EVERYSEAT_STORE_FILE` | `node_modules/.cache/everyseat/preferences.json` | Where the JSON store writes. |
| `EVERYSEAT_DYNAMODB_TABLE` | unset | Use DynamoDB instead of the JSON file. |
| `EVERYSEAT_DYNAMODB_ENDPOINT` | unset | Point the DynamoDB client at DynamoDB Local. |
| `EVERYSEAT_ALLOWED_ORIGINS` | none | Extra browser origins (comma-separated) allowed to call the server. |
| `EVERYSEAT_HEARTBEAT_MS` | `20000` | Relay heartbeat interval. Idle connections are dropped after three missed beats. |
| `EVERYSEAT_REPLAY_LENS` | on | Send the latest household and lens to a TV when it connects. Set to `0` to turn it off. |
| `EVERYSEAT_DEMO_HOUSEHOLD` | off | Set to `1` to start an empty, never-edited household with the demo people from `../fixtures/demo-household.json` (Leo, Mom, Grandpa and Dad). Without it a household starts empty and people are added on the TV or with `remember_preference`. |

Browsers are accepted from `localhost`, `127.0.0.1` and `[::1]` on any port. When the server is bound to a non-loopback address, private-network and `.local` origins are accepted too. Requests with no `Origin` header (apps, scripts) are always accepted by the origin check.

## MCP tools

The server is stateless: every request gets its own server and transport and a JSON reply, so there is no session to resume. `GET` and `DELETE` on `/mcp` return `405`. CORS exposes `Mcp-Session-Id`.

| Tool | Purpose |
| --- | --- |
| `check_title_comfort` | `{ title, viewers? }`. Lists the flashes, sudden loud moments and scares in a title, and how each would be handled for the viewers (default: tonight's couch). The result has `structuredContent` and carries `_meta.ui.resourceUri`, which points at an inlined card (`ui://everyseat/title-comfort-<hash>.html`) that draws an intensity timeline. |
| `set_tonight_lens` | `{ people?, settings? }`. Sets who is on the couch and, optionally, patches their settings for tonight. Saves tonight's lens and sends it to connected TVs. |
| `remember_preference` | `{ person, settings }`. Saves a person's comfort settings, adding the person to the household if new, and updates the TV. |

Comfort settings are `flashes` (`soften` or `off`), `loud` (`cap` or `off`), `scares` (`headsup` or `off`) and `ad` (`on` or `off`). The combined lens takes the most protective value of each across the people on the couch.

## Voice page

Open `http://127.0.0.1:8787/` after `npm run web:build`. It is a dark, landscape page labelled "Simulated Alexa+ add-on": a transcript on the left and, on the right, the comfort card for a film or a panel showing the couch and settings the TV just received.

- **Talking.** Hold the "Hold to talk" button and speak (browser speech recognition, so use Chrome or Edge), or type in the box. Replies are spoken with the browser's speech synthesis; "Voice on" mutes them.
- **The card** is the MCP Apps card returned by `check_title_comfort`. The page renders it with `@mcp-ui/client` inside an iframe served from the sandbox origin (`http://<host>:8788/sandbox.html`), a different origin from the page, so the card can't read the page or call the server except through the page.
- **Key.** If `EVERYSEAT_API_KEY` is set, open the page as `/?key=<key>`. The key is kept in memory and removed from the address bar.
- **Development.** `npm --prefix web run dev` serves the page on `http://localhost:5173` and forwards `/mcp`, `/converse` and `/api` to the companion (`EVERYSEAT_COMPANION_URL` changes the target).

### `POST /converse`

```json
{ "message": "Is Tears of Steel okay for Sam tonight?", "history": [{ "role": "user", "text": "…" }, { "role": "assistant", "text": "…" }] }
```

`message` is up to 1000 characters and `history` up to 20 earlier turns. The server gives Nova 2 Lite the three MCP tools and tonight's context, runs the tool calls it picks in process, and returns:

```json
{ "reply": "…", "toolCalls": [{ "name": "…", "arguments": {}, "result": {} }], "usage": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "modelCalls": 1 }, "model": "…", "latencyMs": 0 }
```

When every tool call succeeds the reply is the tools' own spoken summaries, so a request takes one model call (about 3.5 s). If a tool reports an error, the model gets one more turn to explain or recover (up to three calls). `GET /api/config` returns the household, the sandbox port and whether a key is required.

## Phone page

`/phone/` follows the film on the TV and plays its audio description through the phone's speaker or headphones, so the people who want it hear it and everyone else on the couch does not. The description cues come from `everyseat describe` (see the pipeline README); each one names a voiced clip, and the companion serves the clips under `/ad/`.

1. Start the companion so the phone can reach it: `EVERYSEAT_HOST=0.0.0.0 npm start`. The startup log lists the addresses, for example `phone page: http://192.168.1.20:8787/phone/`. On macOS `ipconfig getifaddr en0` gives the same address, and the first start asks whether `node` may accept incoming connections: choose Allow.
2. Open that address on a phone on the same Wi-Fi. Pages from a private network address and `.local` names are accepted; with `EVERYSEAT_API_KEY` set, add `?key=<key>`. `?household=<id>` joins another household.
3. Tap **Start**. The tap is what lets the browser play sound, and it keeps the screen on while the page is open. Turn the ringer on and the volume up; on an iPhone a silent switch can mute web audio.
4. Play the film on the TV. The page shows where the TV is, the next description and, while one is playing, its text labelled as AI-generated.

The TV stamps each `clock` message with the relay's time, and the page measures its own offset to the relay with `sync?` probes, so the clocks of the phone, the TV and the companion never need to agree. Descriptions are scheduled ahead on the audio clock, follow pauses and seeks, and are left out at any speed other than 1. **Sound timing** moves them in 10 ms steps (±500 ms) to match the phone's output delay, which Safari does not report; **Timing details** lists the measured offset, round trip and output delay. The page tells the companion how each clip landed, and the companion logs one `phone:` line per clip.

Routes: `GET /phone/` (the page), `GET /api/ad/:title` (the clips of a title: id, start, duration, text, url), `GET /ad/...` (the audio files) and `POST /api/ad/report` (the timing report). The last three need the key when one is set.

## Relay protocol

Messages are JSON objects, one per line (`\n`-terminated), so one message can span several WebSocket frames and several messages can share one. A line over 1 MB closes the connection.

1. The client connects to `/relay` and sends `{"t":"hello","role":"tv"|"phone"|"companion","household":"<id>"}` within 10 s.
2. `companion` → `tv`: `lens` (people on the couch and the combined settings).
3. `tv` ↔ `companion`: `household` (`{"t":"household","people":[{name,settings}],"updatedAt":<ms>}`, at most 7 people). Last writer wins by `updatedAt`: the relay keeps the latest, hands it to every other TV and companion client, saves a TV's household in the preference store, and answers an older one with the latest. A TV sends its household when it connects; one that connects to a relay holding a household gets that first, then the current lens. The MCP tool `remember_preference` pushes the household to the TVs.
4. `tv` → `phone`: `clock` (media time, wall clock in the relay's time, rate, title), on every play, pause, seek and stall and every 2 s.
5. `tv` or `phone` → relay: `{"t":"sync?","c":<ms>}`; the relay answers `{"t":"sync!","c":<ms>,"s":<ms>}` with its own time. The sender keeps the probe with the shortest round trip to learn its offset from the relay's clock.
6. `ping` is answered with `pong` at any time. The relay also sends a ping every heartbeat interval.

Messages route only within the sender's household.

## DynamoDB

Install the optional AWS SDK packages (`npm install` does this by default) and set `EVERYSEAT_DYNAMODB_TABLE`. The table must already exist, with partition key `household` (string) and sort key `item` (string). Items are `person#<lowercase name>` (`name`, `settings`), `meta` (`updatedAt`) and `tonight` (`lens`). Credentials come from the usual AWS provider chain. A `meta` item holds when the household last changed.

To try it without an AWS account, run DynamoDB Local and point the client at it:

```sh
docker run --rm -p 127.0.0.1:8799:8000 amazon/dynamodb-local -jar DynamoDBLocal.jar -inMemory
EVERYSEAT_DYNAMODB_TABLE=everyseat EVERYSEAT_DYNAMODB_ENDPOINT=http://127.0.0.1:8799 npm start
```

# Companion

The companion is a small Node server that sits next to the TV app. It does three jobs:

- **MCP server** at `/mcp` (Streamable HTTP, protocol 2025-11-25). Voice assistants and other MCP hosts use it to ask whether a film is comfortable for the people on the couch and to change what the TV does tonight.
- **WebSocket relay** at `/relay`. It carries the combined comfort lens from the companion to the TV, and the playback clock from the TV to phones.
- **Preference store.** Each household's saved comfort settings live in a local JSON file, or optionally in DynamoDB.

It needs Node 22 (`nvm use` reads `.nvmrc`).

```sh
npm install
npm start          # http://127.0.0.1:8787
npm run lint       # eslint and a strict type-check of the JSDoc types
```

`GET /healthz` returns the number of known titles and the relay's connection counts.

## Settings

Every setting has a default that works on a laptop. Set them as environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `EVERYSEAT_PORT` | `8787` | HTTP and WebSocket port. |
| `EVERYSEAT_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` to let a TV or phone on the network connect. |
| `EVERYSEAT_API_KEY` | unset | When set, `/mcp` and `/relay` require it as `Authorization: Bearer <key>`, `X-API-Key: <key>`, or (relay only) `?key=<key>`. A bad key gets a bare `401` with no `WWW-Authenticate` header. |
| `EVERYSEAT_HOUSEHOLD` | `demo` | Household the MCP tools act on. |
| `EVERYSEAT_CUES_DIR` | `../fixtures` and `../generated` | Directories (separated by `:`) scanned recursively for `.sensevtt` files. Later directories override earlier ones. |
| `EVERYSEAT_TITLES_FILE` | `data/titles.json` | Display name and duration per title id. A title missing from it gets its id as a name and the last cue's end plus 30 s as its duration. |
| `EVERYSEAT_STORE_FILE` | `node_modules/.cache/everyseat/preferences.json` | Where the JSON store writes. |
| `EVERYSEAT_DYNAMODB_TABLE` | unset | Use DynamoDB instead of the JSON file. |
| `EVERYSEAT_DYNAMODB_ENDPOINT` | unset | Point the DynamoDB client at DynamoDB Local. |
| `EVERYSEAT_ALLOWED_ORIGINS` | none | Extra browser origins (comma-separated) allowed to call the server. |
| `EVERYSEAT_HEARTBEAT_MS` | `20000` | Relay heartbeat interval. Idle connections are dropped after three missed beats. |
| `EVERYSEAT_REPLAY_LENS` | off | Set to `1` to send the last lens to a TV when it connects. |

Browsers are accepted from `localhost`, `127.0.0.1` and `[::1]` on any port. When the server is bound to a non-loopback address, private-network and `.local` origins are accepted too. Requests with no `Origin` header (apps, scripts) are always accepted by the origin check.

## MCP tools

The server is stateless: every request gets its own server and transport and a JSON reply, so there is no session to resume. `GET` and `DELETE` on `/mcp` return `405`. CORS exposes `Mcp-Session-Id`.

| Tool | Purpose |
| --- | --- |
| `check_title_comfort` | `{ title, viewers? }`. Lists the flashes, sudden loud moments and scares in a title, and how each would be handled for the viewers (default: tonight's couch). The result has `structuredContent` and carries `_meta.ui.resourceUri`, which points at an inlined card (`ui://everyseat/title-comfort-<hash>.html`) that draws an intensity timeline. |
| `set_tonight_lens` | `{ people?, settings? }`. Sets who is on the couch and, optionally, patches their settings for tonight. Saves tonight's lens and sends it to connected TVs. |
| `remember_preference` | `{ person, settings }`. Saves a person's comfort settings. |

Comfort settings are `flashes` (`soften` or `off`), `loud` (`cap` or `off`), `scares` (`headsup` or `off`) and `ad` (`on` or `off`). The combined lens takes the most protective value of each across the people on the couch.

## Relay protocol

Messages are JSON objects, one per line (`\n`-terminated), so one message can span several WebSocket frames and several messages can share one. A line over 1 MB closes the connection.

1. The client connects to `/relay` and sends `{"t":"hello","role":"tv"|"phone"|"companion","household":"<id>"}` within 10 s.
2. `companion` → `tv`: `lens` (people on the couch and the combined settings).
3. `tv` → `phone`: `clock` (media time, wall clock, rate, title).
4. `phone` → relay: `{"t":"sync?","c":<ms>}`; the relay answers `{"t":"sync!","c":<ms>,"s":<ms>}`.
5. `ping` is answered with `pong` at any time. The relay also sends a ping every heartbeat interval.

Messages route only within the sender's household.

## DynamoDB

Install the optional AWS SDK packages (`npm install` does this by default) and set `EVERYSEAT_DYNAMODB_TABLE`. The table must already exist, with partition key `household` (string) and sort key `item` (string). Items are `person#<lowercase name>` (`name`, `settings`) and `tonight` (`lens`). Credentials come from the usual AWS provider chain. The people in `data/household.json` are the starting point; saved items win.

To try it without an AWS account, run DynamoDB Local and point the client at it:

```sh
docker run --rm -p 127.0.0.1:8799:8000 amazon/dynamodb-local -jar DynamoDBLocal.jar -inMemory
EVERYSEAT_DYNAMODB_TABLE=everyseat EVERYSEAT_DYNAMODB_ENDPOINT=http://127.0.0.1:8799 npm start
```

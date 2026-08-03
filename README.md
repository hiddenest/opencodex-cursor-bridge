# OpenCodex Cursor Bridge

[![npm version](https://img.shields.io/npm/v/ocx-cursor.svg)](https://www.npmjs.com/package/ocx-cursor)
[![CI](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml)

Use active [OpenCodex](https://github.com/lidge-jun/opencodex) models in Cursor through its custom OpenAI endpoint. The package runs a local gateway and keeps Cursor's custom model list in sync.

## Requirements

- macOS with Cursor installed at `/Applications/Cursor.app`
- Node.js 22.5 or newer
- OpenCodex installed, signed in, and running
- An HTTPS hostname that forwards to `http://127.0.0.1:10101`

Launch Cursor and sign in once before setup. Cursor creates the Safe Storage key that the installer uses to encrypt the gateway API key.

## Set up an HTTPS endpoint

Cursor's custom OpenAI endpoint must use HTTPS. Point a tunnel or reverse proxy at the local gateway on port `10101`.

This Cloudflare Tunnel config maps `cursor-api.example.com` to the gateway:

```yaml
# ~/.cloudflared/config.yml
tunnel: YOUR_TUNNEL_ID
credentials-file: /Users/YOU/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: cursor-api.example.com
    service: http://127.0.0.1:10101
  - service: http_status:404
```

Create the DNS route and run the tunnel:

```bash
cloudflared tunnel route dns YOUR_TUNNEL_NAME cursor-api.example.com
cloudflared tunnel run YOUR_TUNNEL_NAME
```

The package does not install or manage the tunnel.

## Install

Quit Cursor, confirm that OpenCodex is running, then run:

```bash
npx ocx-cursor init \
  --base-url https://cursor-api.example.com/v1
```

`init` performs these actions:

1. Generates a gateway API key in `~/.opencodex/cursor-bridge/secret`.
2. Stores the key in Cursor with macOS Safe Storage encryption.
3. Registers the HTTPS URL as Cursor's OpenAI base URL.
4. Installs the `com.opencodex.cursor-bridge` LaunchAgent.
5. Adds active OpenCodex models to Cursor under `opencodex/*`.

The installer links `ocx-cursor` into `~/.local/bin`. Add that directory to `PATH` if your shell does not include it:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Open Cursor after `init` finishes. Models with known reasoning controls show an effort value in the picker. Use `Shift+Command+/` to cycle it.

## Commands

| Command | Purpose |
| --- | --- |
| `ocx-cursor init --base-url URL` | Configure Cursor, install the service, and sync models. Cursor must be closed. |
| `ocx-cursor install` | Reinstall or restart the LaunchAgent without changing Cursor's API settings. |
| `ocx-cursor sync` | Refresh the active model catalog. The service queues the update while Cursor runs. |
| `ocx-cursor status` | Show service health, model count, and pending sync state. |
| `ocx-cursor uninstall` | Remove the LaunchAgent, command link, and bridge home directory. |

`uninstall` leaves Cursor's custom endpoint and model records in its state database.

## Model mapping

The bridge maps source model IDs to Cursor aliases:

```text
anthropic/claude-sonnet-5  -> opencodex/claude-sonnet-5
gpt-5.6-sol                -> opencodex/gpt-5.6-sol
```

The catalog includes models returned by OpenCodex's active `/v1/models` endpoint. It excludes the OpenCodex `cursor/*` provider to avoid duplicating Cursor's own models.

Cursor removes custom effort metadata from its database during startup. The LaunchAgent writes that metadata back after Cursor exits, once all Cursor Helper processes have stopped.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OCX_CURSOR_BASE_URL` | Stored Cursor URL | HTTPS endpoint used by `init` when `--base-url` is absent. |
| `OCX_CURSOR_HOME` | `~/.opencodex/cursor-bridge` | Service state, API key, catalog, and logs. |
| `OCX_CURSOR_HOST` | `127.0.0.1` | Local gateway bind address. |
| `OCX_CURSOR_PORT` | `10101` | Local gateway port. |
| `OCX_BIN` | `~/.local/bin/ocx` | OpenCodex CLI path. |

The gateway accepts these routes:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses` and `/v1/responses/compact`
- `POST /v1/messages`

The gateway requires its generated bearer token on each `/v1/*` request. It binds to loopback unless you change `OCX_CURSOR_HOST`.

## Development

```bash
npm test
npm run check
npm pack --dry-run
```

The code uses `node:sqlite`, so development requires Node.js 22.5 or newer.

## Compatibility

The package writes Cursor's local state database and uses Cursor's Safe Storage format. Cursor does not document either interface. A Cursor update can change them.

The current release supports macOS. It does not configure Windows Credential Manager, Linux keyrings, or system services outside launchd.

## License

MIT

# OpenCodex Cursor Bridge

[![npm version](https://img.shields.io/npm/v/ocx-cursor.svg)](https://www.npmjs.com/package/ocx-cursor)
[![CI](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml)

Use your active [OpenCodex](https://github.com/lidge-jun/opencodex) models in Cursor through an authenticated HTTPS endpoint on your Mac.

> [!WARNING]
> The installer edits two private workbench files inside `Cursor.app`. This invalidates Cursor's vendor signature. Cursor may report a corrupt installation. The bridge saves the original files under `~/.opencodex/cursor-bridge/cursor-app-backups`. Reinstall Cursor to restore a signed app.

## Requirements

- macOS with Cursor installed at `/Applications/Cursor.app`
- Node.js 22.5 or newer
- OpenCodex with at least one active model
- An HTTPS hostname that forwards to `http://127.0.0.1:10101`

Use [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) for the HTTPS hostname, or choose another reverse proxy that preserves the `Authorization` header.

## Upgrading from 0.5.x

Version 0.5.x enabled Cursor's local-agent mode and edited ten app files. Version 1.0.0 edits two workbench files and leaves local-agent mode disabled.

Reinstall Cursor before upgrading so macOS replaces the old app files. Quit the new Cursor installation, then follow the setup below. Your Cursor settings remain under `~/Library/Application Support/Cursor`.

## Getting started

Install OpenCodex and start its login service:

```bash
npm install --global @bitkyc08/opencodex
ocx init
ocx service install
ocx service status
```

OpenCodex listens on `http://127.0.0.1:10100`. Check its active models:

```bash
ocx models --json
```

Install `cloudflared`, sign in, and create a named tunnel:

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create ocx-cursor
cloudflared tunnel list
```

Create `~/.cloudflared/config.yml`. Replace the UUID, username, and hostname:

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /Users/YOUR_USERNAME/.cloudflared/YOUR_TUNNEL_UUID.json

ingress:
  - hostname: cursor-api.example.com
    service: http://127.0.0.1:10101
  - service: http_status:404
```

Create the DNS record and check the ingress rule:

```bash
cloudflared tunnel route dns ocx-cursor cursor-api.example.com
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://cursor-api.example.com
```

Start the tunnel at login with Cloudflare's [macOS service command](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/macos/):

```bash
cloudflared service install
```

This command reads `~/.cloudflared/config.yml`. `sudo cloudflared service install` starts the tunnel at boot and reads `/etc/cloudflared/config.yml` instead.

Launch Cursor once and sign in, then quit it. Install the bridge:

```bash
npx ocx-cursor init --base-url https://cursor-api.example.com/v1
~/.local/bin/ocx-cursor status
```

Open Cursor after `status` reports a running service and a healthy gateway.

## How requests move

```text
Cursor
  -> https://cursor-api.example.com/v1
  -> Cloudflare Tunnel
  -> OpenCodex Cursor Bridge on 127.0.0.1:10101
  -> OpenCodex on 127.0.0.1:10100
  -> your provider
```

The bridge generates a bearer token during `init`, stores it in Cursor with macOS Safe Storage, and checks it on each `/v1/*` request. The gateway binds to `127.0.0.1` unless you set `OCX_CURSOR_HOST`.

The package does not create, edit, or remove your Cloudflare Tunnel.

## Models and Cursor metadata

The bridge reads the active OpenCodex catalog and adds stable aliases to Cursor:

```text
anthropic/claude-sonnet-5 -> opencodex/claude-sonnet-5
gpt-5.6-sol               -> opencodex/gpt-5.6-sol
```

Cursor displays provider prefixes where model names overlap. Examples include `Cursor Kimi K3` and `OpenCode Go Kimi K3`. Claude and GPT names stay short.

Reasoning models receive an effort selector. Models that advertise OpenCodex's `priority` service tier receive a Fast toggle. The gateway maps those choices to `reasoning_effort` and `service_tier: priority`.

The installer patches these files:

```text
/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.js
```

The patch keeps the model metadata that Cursor would discard. It leaves Cursor's local-agent mode disabled and does not edit either local-agent runtime.

The login service refreshes the catalog every 15 seconds. It waits for Cursor to quit before writing the state database or reapplying a patch after a Cursor update.

## Commands

| Command | Action |
| --- | --- |
| `ocx-cursor init --base-url URL` | Install the service, test the HTTPS endpoint, configure Cursor, and sync models. |
| `ocx-cursor install` | Reinstall the service and check the two metadata patches. |
| `ocx-cursor update` | Install the current npm release and restart the service. |
| `ocx-cursor sync` | Read the active OpenCodex catalog and update Cursor. |
| `ocx-cursor status` | Print service, gateway, catalog, and pending-sync status. |
| `ocx-cursor uninstall` | Remove the service, command link, and bridge state. |

`uninstall` leaves Cursor's endpoint setting and patched workbench files in place. Reinstall Cursor if you want a signed app without the metadata patch.

## Configuration

| Variable | Default |
| --- | --- |
| `OCX_CURSOR_BASE_URL` | Cursor's stored endpoint |
| `OCX_CURSOR_HOME` | `~/.opencodex/cursor-bridge` |
| `OCX_CURSOR_HOST` | `127.0.0.1` |
| `OCX_CURSOR_PORT` | `10101` |
| `OCX_BIN` | `~/.local/bin/ocx` |

The gateway exposes `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/responses/compact`, and `POST /v1/messages`.

The bridge reads `~/.opencodex/service-api-token` when OpenCodex uses service authentication.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Cursor returns 401 | Quit Cursor and rerun `npx ocx-cursor init --base-url https://YOUR_HOST/v1`. |
| The hostname returns 502 | Run `ocx-cursor status`, then check that the tunnel points to port `10101`. |
| Cloudflare returns 1016 | Run `cloudflared tunnel info ocx-cursor` and check the service. |
| Models or controls are missing | Quit Cursor and run `ocx-cursor sync`. |
| A Cursor update removed the patch | Quit Cursor and run `ocx-cursor install`. |

Read the service logs:

```bash
tail -n 100 ~/.opencodex/cursor-bridge/service.log
tail -n 100 ~/.opencodex/cursor-bridge/service.error.log
```

The patcher stops if a Cursor update removes its known catalog hook. It records the file and error without replacing that file.

## Development

```bash
npm test
npm run check
npm pack --dry-run
```

The project uses the MIT license.

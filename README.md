# OpenCodex Cursor Bridge

[![npm version](https://img.shields.io/npm/v/ocx-cursor.svg)](https://www.npmjs.com/package/ocx-cursor)
[![CI](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml)

Use your active [OpenCodex](https://github.com/lidge-jun/opencodex) models in Cursor through a local OpenAI-compatible gateway.

> [!WARNING]
> This package edits private JavaScript files inside `Cursor.app`. The changes invalidate Cursor's vendor signature, so Cursor may report that the installation is corrupt. The installer saves original files under `~/.opencodex/cursor-bridge/cursor-app-backups`. Reinstall Cursor to restore a signed app.

## Quick start

You need macOS, Node.js 22.5 or newer, and Cursor at `/Applications/Cursor.app`.

Install and configure OpenCodex:

```bash
npm install --global @bitkyc08/opencodex
ocx init
ocx service install
ocx service status
```

Check the configured models:

```bash
ocx models --json
```

Launch Cursor and sign in once, then quit it. Run the bridge installer:

```bash
npx ocx-cursor init
~/.local/bin/ocx-cursor status
```

`init` registers `http://127.0.0.1:10101/v1` in Cursor. You do not need a domain or tunnel. Open Cursor after the status command reports `Service: running` and `Gateway: healthy`.

Add the installed command to your shell path if needed:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## What init changes

| Area | Change |
| --- | --- |
| Cursor settings | Stores the gateway key with macOS Safe Storage and sets the local base URL. |
| Cursor model state | Adds active models under `opencodex/*` with names, effort choices, and Fast metadata. |
| `Cursor.app` | Enables local-agent mode in eight bundles and patches two local-agent runtimes. |
| Login service | Installs `com.opencodex.cursor-bridge`, refreshes models, and reapplies patches after Cursor updates. |

Requests stay on loopback until OpenCodex sends them to your configured provider:

```text
Cursor -> 127.0.0.1:10101 -> OpenCodex on 127.0.0.1:10100 -> provider
```

The gateway requires its generated bearer token on every `/v1/*` request. It binds to `127.0.0.1` unless you change `OCX_CURSOR_HOST`.

## Model behavior

The bridge reads OpenCodex's active `/v1/models` response and creates stable Cursor aliases:

```text
anthropic/claude-sonnet-5 -> opencodex/claude-sonnet-5
gpt-5.6-sol               -> opencodex/gpt-5.6-sol
```

Cursor shows readable names such as `GPT 5.6 Sol`. Reasoning models receive an effort selector. Models with OpenCodex's `priority` service tier receive a Fast toggle.

Cursor can send `strict: true` with function schemas that fail strict validation. The gateway changes the flag to `false` before forwarding those requests. It leaves tool names, descriptions, and arguments intact.

## Commands and configuration

| Command | Purpose |
| --- | --- |
| `ocx-cursor init` | Install the service, configure Cursor, patch the app, and sync models. Cursor must be closed. |
| `ocx-cursor install` | Reinstall the service and check app patches. Running Cursor defers app changes until exit. |
| `ocx-cursor update` | Install the newest npm release and run `install`. |
| `ocx-cursor sync` | Refresh the active model list. |
| `ocx-cursor status` | Show service health and pending model sync. |
| `ocx-cursor uninstall` | Remove the service, command link, and bridge state. |

`uninstall` does not restore Cursor settings or patched app files. Reinstall Cursor if you want a clean vendor build.

| Variable | Default |
| --- | --- |
| `OCX_CURSOR_BASE_URL` | `http://127.0.0.1:10101/v1` |
| `OCX_CURSOR_HOME` | `~/.opencodex/cursor-bridge` |
| `OCX_CURSOR_HOST` | `127.0.0.1` |
| `OCX_CURSOR_PORT` | `10101` |
| `OCX_BIN` | `~/.local/bin/ocx` |

The bridge reads an OpenCodex service token from `~/.opencodex/service-api-token` when that file exists.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Cursor returns 401 | Quit Cursor and rerun `npx ocx-cursor init`. |
| Models or effort choices are missing | Quit Cursor, run `ocx-cursor sync`, then check `ocx-cursor status`. |
| A Cursor update removed the patches | Quit Cursor and run `ocx-cursor install`. |
| The gateway is unavailable | Run `ocx-cursor status` and inspect the logs below. |
| The bridge cannot find `ocx` | Run `ln -sf "$(command -v ocx)" ~/.local/bin/ocx`. |

```bash
tail -n 100 ~/.opencodex/cursor-bridge/service.log
tail -n 100 ~/.opencodex/cursor-bridge/service.error.log
```

The patcher stops when a Cursor update no longer matches its known code structure. It reports the file and mismatch in `service.error.log` without replacing that file.

## Development

```bash
npm test
npm run check
npm pack --dry-run
```

The project uses the MIT license.

# OpenCodex Cursor Bridge

[![npm version](https://img.shields.io/npm/v/ocx-cursor.svg)](https://www.npmjs.com/package/ocx-cursor)
[![CI](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml)

Use active [OpenCodex](https://github.com/lidge-jun/opencodex) models in Cursor through its custom OpenAI endpoint. The package runs a loopback-only gateway, registers it in Cursor, and keeps Cursor's custom model list in sync.

## Requirements

- macOS with Cursor installed at `/Applications/Cursor.app`
- Node.js 22.5 or newer
- OpenCodex installed and configured

Launch Cursor and sign in once before setup. Cursor creates the Safe Storage key that the installer uses to encrypt the gateway API key.

## Setup

### 1. Install OpenCodex

[OpenCodex](https://github.com/lidge-jun/opencodex) requires Node.js 18 or newer and bundles its own Bun runtime. This bridge requires Node.js 22.5 or newer, so install Node.js 22 or later before continuing.

Install OpenCodex without `sudo` from a user-owned Node.js installation:

```bash
npm install --global @bitkyc08/opencodex
ocx init
```

The bridge service looks for `ocx` at `~/.local/bin/ocx` and `/opt/homebrew/bin/ocx`. If `command -v ocx` prints another path, link it into `~/.local/bin`:

```bash
mkdir -p ~/.local/bin
if [[ "$(command -v ocx)" != "$HOME/.local/bin/ocx" ]]; then
  ln -sf "$(command -v ocx)" ~/.local/bin/ocx
fi
```

`ocx init` opens the interactive provider setup. You can also configure providers through the dashboard or terminal:

```bash
ocx gui
ocx login <provider>
```

Install OpenCodex as a login service, then verify it:

```bash
ocx service install
ocx service status
curl http://127.0.0.1:10100/v1/models
```

If you configured OpenCodex with a service API token, include it in the request:

```bash
curl \
  --header "Authorization: Bearer $(cat ~/.opencodex/service-api-token)" \
  http://127.0.0.1:10100/v1/models
```

See the [OpenCodex documentation](https://lidge-jun.github.io/opencodex/) for provider-specific setup.

### 2. Install the Cursor bridge

Quit Cursor completely, confirm that OpenCodex is running, then initialize the bridge:

```bash
npx ocx-cursor init
```

No tunnel or public domain is required. `init` uses `http://127.0.0.1:10101/v1` and performs these actions:

1. Generates a gateway API key in `~/.opencodex/cursor-bridge/secret`.
2. Installs the `com.opencodex.cursor-bridge` LaunchAgent.
3. Tests the local gateway and OpenCodex model endpoint.
4. Stores the key in Cursor with macOS Safe Storage encryption.
5. Registers the local gateway as Cursor's OpenAI base URL.
6. Adds active OpenCodex models to Cursor under `opencodex/*`.
7. Enables Cursor's local-agent mode and installs the model metadata patches described below.

`init` patches ten JavaScript files inside `Cursor.app`:

- Eight Cursor bundles get the local-mode build flag.
- The Desktop and Glass workbench bundles retain OpenCodex display names, effort choices, and Fast metadata when Cursor refreshes its server catalog.
- Both local-agent runtimes display names such as `GPT 5.6 Sol` while keeping `opencodex/gpt-5.6-sol` as the request ID.

Original files are copied to `~/.opencodex/cursor-bridge/cursor-app-backups` before they are changed. The LaunchAgent watches the same files and reapplies the patches after a Cursor update, once Cursor has quit.

> [!WARNING]
> Patching `Cursor.app` invalidates its vendor code signature. Cursor may show “Your Cursor installation appears to be corrupt.” This is expected for this integration. Reinstall Cursor to restore an unmodified, vendor-signed app.

The installer links `ocx-cursor` into `~/.local/bin`. Add that directory to `PATH` if needed:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Check the service before opening Cursor:

```bash
ocx-cursor status
curl http://127.0.0.1:10101/healthz
```

The status output should show `Service: running` and `Gateway: healthy`. Open Cursor after both checks pass.

To use an explicit HTTPS reverse proxy instead, pass its URL directly. This is optional and not used by the default setup:

```bash
npx ocx-cursor init --base-url https://cursor-api.example.com/v1
```

### Fast mode

OpenAI models whose OpenCodex catalog advertises the `priority` service tier show a Fast toggle in Cursor. Fast is off by default. When enabled, the bridge sends `service_tier: "priority"` to OpenCodex, which increases generation speed and consumes more usage.

Fast requires an OpenCodex version that preserves `service_tier` on its Chat Completions compatibility endpoint. Models without the `priority` tier, including Anthropic subscription models, do not receive the toggle.

## How requests are routed

```text
Cursor
  -> OpenCodex Cursor Bridge on http://127.0.0.1:10101/v1
  -> OpenCodex on http://127.0.0.1:10100
  -> configured provider
```

The gateway API key is generated during `init` and stored in Cursor with macOS Safe Storage encryption. The bridge requires this bearer token on every `/v1/*` request and binds to `127.0.0.1` by default.

## Commands

| Command | Purpose |
| --- | --- |
| `ocx-cursor init [--base-url URL]` | Install the service, test the endpoint, configure Cursor, and sync models. Cursor must be closed. |
| `ocx-cursor install` | Reinstall the LaunchAgent and verify app patches, or queue them until Cursor quits. |
| `ocx-cursor update` | Download the latest release from npm, reinstall the service, verify patches, and sync models. |
| `ocx-cursor sync` | Refresh the active model catalog. The service queues the update while Cursor runs. |
| `ocx-cursor launch` | Experimentally launch Cursor with live effort and Fast metadata injection. Keep the command running. |
| `ocx-cursor status` | Show service health, model count, and pending sync state. |
| `ocx-cursor uninstall` | Remove the LaunchAgent, command link, and bridge home directory. |

`uninstall` leaves Cursor's custom endpoint, model records, and app patches in place. Reinstall Cursor if you want to restore its original signed files.

`update` preserves the existing gateway API key and Cursor endpoint. If Cursor is running, app patches and model sync are queued until it quits. The command updates only this companion package; update OpenCodex separately with your package manager.

## Model mapping

The bridge maps source model IDs to Cursor aliases:

```text
anthropic/claude-sonnet-5  -> opencodex/claude-sonnet-5
gpt-5.6-sol                -> opencodex/gpt-5.6-sol
```

The catalog includes every model returned by OpenCodex's active `/v1/models` endpoint, including models from the `cursor/*` provider. Cursor-backed aliases use the `opencodex/cursor/*` prefix so they remain distinct from Cursor's built-in entries.

Cursor removes custom effort metadata from its database during startup. The companion LaunchAgent patches the Desktop and Glass catalog storage steps so `opencodex/*` display names, effort, and Fast metadata survive server refreshes. It monitors the installed bundles and local-agent runtimes, then reapplies their patches when Cursor replaces the app during an update.

`init`, `install`, and `update` also patch Cursor's local model runtimes so provider refreshes keep human-readable names such as `GPT 5.6 Sol` while requests continue using stable `opencodex/*` model IDs.

Cursor sends some built-in function tools with `strict: true` even when their JSON schema is not valid for strict mode. The gateway changes that flag to `false` for OpenCodex requests, preventing errors such as `additionalProperties is required to be supplied and to be false` without changing tool arguments.

### Experimental live model metadata

`ocx-cursor launch` starts Cursor with a random loopback-only debugging port and keeps `opencodex/*` effort and Fast metadata in the live model catalog:

```bash
ocx-cursor launch
```

Keep the command running for the lifetime of Cursor. This does not modify `Cursor.app`, but it depends on Cursor's private workbench code and supports only known Cursor builds.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OCX_CURSOR_BASE_URL` | `http://127.0.0.1:10101/v1` | Endpoint used by `init` when `--base-url` is absent. |
| `OCX_CURSOR_HOME` | `~/.opencodex/cursor-bridge` | Service state, API key, catalog, and logs. |
| `OCX_CURSOR_HOST` | `127.0.0.1` | Local gateway bind address. |
| `OCX_CURSOR_PORT` | `10101` | Local gateway port. Also changes the default Cursor endpoint. |
| `OCX_BIN` | `~/.local/bin/ocx` | OpenCodex CLI path. |

The gateway accepts these routes:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses` and `/v1/responses/compact`
- `POST /v1/messages`

## Troubleshooting

### Cursor returns 401

Quit Cursor and run `init` again. It preserves the bridge key, tests the local endpoint, and writes the matching encrypted value back to Cursor:

```bash
npx ocx-cursor init
```

### The local gateway is unavailable

Check the service and logs, then reinstall it if needed:

```bash
ocx-cursor status
tail -n 100 ~/.opencodex/cursor-bridge/service.error.log
tail -n 100 ~/.opencodex/cursor-bridge/service.log
ocx-cursor install
```

### Models or effort options are missing

Quit Cursor and run:

```bash
ocx-cursor sync
ocx-cursor status
```

If the status shows a pending sync, wait until every Cursor Helper process has exited. The service applies the queued catalog automatically.

### Patches are missing after a Cursor update

Quit every Cursor window and wait for its Helper processes to stop. The LaunchAgent detects replaced app files and reapplies local mode, metadata, and display-name patches. Check the result with:

```bash
ocx-cursor install
tail -n 100 ~/.opencodex/cursor-bridge/service.log
```

The patcher stops without modifying a file when a Cursor release no longer matches its known code structure. Check `service.error.log` in that case.

### OpenCodex models cannot be loaded

Check OpenCodex first:

```bash
ocx status
ocx models --json
curl http://127.0.0.1:10100/v1/models
```

If `ocx models --json` works in your shell but fails in the bridge, check that `ocx` is available at `~/.local/bin/ocx` or `/opt/homebrew/bin/ocx`. The macOS LaunchAgent does not load your interactive shell profile.

## Development

```bash
npm test
npm run check
npm pack --dry-run
```

The code uses `node:sqlite`, so development requires Node.js 22.5 or newer.

## Compatibility

The package writes Cursor's local state database, uses Cursor's Safe Storage format, and modifies private code inside `Cursor.app`. Cursor does not document these interfaces. A Cursor update can change them.

The current release supports macOS. It does not configure Windows Credential Manager, Linux keyrings, or system services outside launchd.

## License

MIT

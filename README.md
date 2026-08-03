# OpenCodex Cursor Bridge

[![npm version](https://img.shields.io/npm/v/ocx-cursor.svg)](https://www.npmjs.com/package/ocx-cursor)
[![CI](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/hiddenest/opencodex-cursor-bridge/actions/workflows/ci.yml)

Use active [OpenCodex](https://github.com/lidge-jun/opencodex) models in Cursor through its custom OpenAI endpoint. The package runs a local gateway, registers the endpoint in Cursor, and keeps Cursor's custom model list in sync.

## Requirements

- macOS with Cursor installed at `/Applications/Cursor.app`
- Node.js 22.5 or newer
- A domain using Cloudflare DNS, or another HTTPS reverse proxy

Launch Cursor and sign in once before setup. Cursor creates the Safe Storage key that the installer uses to encrypt the gateway API key.

## Setup

The commands below use `cursor-api.example.com`. Replace it with a hostname under your own Cloudflare-managed domain.

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

`ocx init` opens the interactive provider setup. You can also open the dashboard and add or sign in to a provider there:

```bash
ocx gui
```

OAuth-backed providers can also be connected from the terminal:

```bash
ocx login <provider>
```

Install OpenCodex as a login service, then check it:

```bash
ocx service install
ocx service status
```

OpenCodex listens on `http://127.0.0.1:10100` by default. Confirm that its model endpoint responds:

```bash
curl http://127.0.0.1:10100/v1/models
```

If you configured OpenCodex with a service API token, include that token:

```bash
curl \
  --header "Authorization: Bearer $(cat ~/.opencodex/service-api-token)" \
  http://127.0.0.1:10100/v1/models
```

See the [OpenCodex documentation](https://lidge-jun.github.io/opencodex/) for provider-specific login and model configuration.

### 2. Create a Cloudflare Tunnel

Cursor requires an HTTPS custom OpenAI endpoint. A [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) can publish the bridge on HTTPS without opening an inbound port on your router.

Add your domain to Cloudflare and point its nameservers to Cloudflare. Then install `cloudflared` on the Mac that runs OpenCodex and Cursor:

```bash
brew install cloudflared
cloudflared tunnel login
```

The login command opens Cloudflare in your browser and writes `~/.cloudflared/cert.pem`. Create a [locally-managed named tunnel](https://developers.cloudflare.com/tunnel/advanced/local-management/create-local-tunnel/):

```bash
cloudflared tunnel create ocx-cursor
cloudflared tunnel list
```

Copy the tunnel UUID printed by the command. It also creates a credentials file named `<TUNNEL_UUID>.json` under `~/.cloudflared`.

Create `~/.cloudflared/config.yml`. Replace the UUID, macOS username, and hostname in this example:

```yaml
# ~/.cloudflared/config.yml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /Users/YOUR_MACOS_USERNAME/.cloudflared/YOUR_TUNNEL_UUID.json

ingress:
  - hostname: cursor-api.example.com
    service: http://127.0.0.1:10101
  - service: http_status:404
```

Create the DNS CNAME for the public hostname. The command adds the record to Cloudflare, so you do not need to create it separately in the dashboard:

```bash
cloudflared tunnel route dns ocx-cursor cursor-api.example.com
```

Validate the configuration and start the tunnel in the foreground:

```bash
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://cursor-api.example.com
cloudflared tunnel run ocx-cursor
```

The public hostname returns `502 Bad Gateway` until the bridge is installed in the next step. Keep this terminal open while testing.

For login-time startup on macOS, stop the foreground process and install the `cloudflared` launch agent:

```bash
cloudflared service install
```

Use `sudo cloudflared service install` only if you want a system launch daemon that starts at boot. That mode reads its configuration from `/etc/cloudflared`, not your home directory. See Cloudflare's [macOS service guide](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/macos/) for the required file locations.

This package does not create, modify, or remove the Cloudflare Tunnel.

### 3. Install the Cursor bridge

Quit Cursor completely, confirm that OpenCodex is running, then initialize the bridge:

```bash
npx ocx-cursor init
```

Enter the Cloudflare Tunnel hostname when prompted. The `https://` prefix and `/v1` suffix are optional:

```text
Cloudflare Tunnel URL (for example, https://cursor-api.example.com): https://cursor-api.example.com
```

The installer starts the local bridge and tests two routes through Cloudflare before it changes Cursor:

- `GET /healthz` confirms that the hostname reaches this bridge.
- Authenticated `GET /v1/models` confirms that request headers reach the bridge and OpenCodex responds.

If either check fails, `init` stops before writing Cursor's API settings. The local bridge stays running so you can fix the tunnel and rerun the command.

For scripts and unattended setup, pass the URL directly:

```bash
npx ocx-cursor init \
  --base-url https://cursor-api.example.com/v1
```

`init` performs these actions:

1. Generates a gateway API key in `~/.opencodex/cursor-bridge/secret`.
2. Installs the `com.opencodex.cursor-bridge` LaunchAgent.
3. Tests the Cloudflare Tunnel and OpenCodex model endpoint.
4. Stores the key in Cursor with macOS Safe Storage encryption.
5. Registers the HTTPS URL as Cursor's OpenAI base URL.
6. Adds active OpenCodex models to Cursor under `opencodex/*`.

The installer links `ocx-cursor` into `~/.local/bin`. Add that directory to `PATH` if your shell does not include it:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Check the local gateway and public hostname before opening Cursor:

```bash
ocx-cursor status
curl https://cursor-api.example.com/healthz
```

The status output should show `Service: running` and `Gateway: healthy`. The public health endpoint should return JSON with `"status":"ok"`.

Open Cursor after both checks pass. Models with known reasoning controls show an effort value in the picker. Use `Shift+Command+/` to cycle it.

### Fast mode

OpenAI models whose OpenCodex catalog advertises the `priority` service tier show a Fast toggle in Cursor. Fast is off by default. When enabled, the bridge sends `service_tier: "priority"` to OpenCodex, which increases generation speed and consumes more usage.

Fast requires an OpenCodex version that preserves `service_tier` on its Chat Completions compatibility endpoint. Models without the `priority` tier, including Anthropic subscription models, do not receive the toggle.

## How requests are routed

```text
Cursor
  -> https://cursor-api.example.com/v1
  -> Cloudflare Tunnel
  -> OpenCodex Cursor Bridge on 127.0.0.1:10101
  -> OpenCodex on 127.0.0.1:10100
  -> configured provider
```

The gateway API key is generated during `init` and stored in Cursor with macOS Safe Storage encryption. The bridge requires this bearer token on every `/v1/*` request. Keep the bridge bound to `127.0.0.1`; `cloudflared` can reach it without exposing port `10101` to the local network.

## Commands

| Command | Purpose |
| --- | --- |
| `ocx-cursor init [--base-url URL]` | Install the service, prompt for and test the tunnel, configure Cursor, and sync models. Cursor must be closed. |
| `ocx-cursor install` | Reinstall or restart the LaunchAgent without changing Cursor's API settings. |
| `ocx-cursor update` | Download the latest `ocx-cursor` release from npm, reinstall the service, and sync models. |
| `ocx-cursor sync` | Refresh the active model catalog. The service queues the update while Cursor runs. |
| `ocx-cursor launch` | Experimentally launch Cursor with live effort and Fast metadata injection. Keep the command running. |
| `ocx-cursor status` | Show service health, model count, and pending sync state. |
| `ocx-cursor uninstall` | Remove the LaunchAgent, command link, and bridge home directory. |

`uninstall` leaves Cursor's custom endpoint and model records in its state database.

`update` preserves the existing gateway API key and Cursor endpoint. It updates only this companion package; update OpenCodex separately with your package manager.

## Model mapping

The bridge maps source model IDs to Cursor aliases:

```text
anthropic/claude-sonnet-5  -> opencodex/claude-sonnet-5
gpt-5.6-sol                -> opencodex/gpt-5.6-sol
```

The catalog includes models returned by OpenCodex's active `/v1/models` endpoint. It excludes the OpenCodex `cursor/*` provider to avoid duplicating Cursor's own models.

Cursor removes custom effort metadata from its database during startup. The LaunchAgent writes that metadata back after Cursor exits, once all Cursor Helper processes have stopped.

### Experimental live model metadata

`ocx-cursor launch` starts Cursor with a random loopback-only debugging port and keeps `opencodex/*` effort and Fast metadata in the live model catalog:

```bash
ocx-cursor launch
```

Keep the command running for the lifetime of Cursor. This does not modify `Cursor.app`, but it depends on Cursor's private workbench code and currently supports Cursor 3.14.7. The command stops with a compatibility error when it cannot find the expected catalog hook.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OCX_CURSOR_BASE_URL` | Stored Cursor URL | Prompt default, or endpoint for non-interactive `init`, when `--base-url` is absent. |
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

## Troubleshooting

### The public hostname returns 502

The tunnel is running, but it cannot reach the local bridge. Check the bridge and its logs:

```bash
ocx-cursor status
tail -n 100 ~/.opencodex/cursor-bridge/service.error.log
tail -n 100 ~/.opencodex/cursor-bridge/service.log
```

Confirm that the tunnel ingress points to `http://127.0.0.1:10101`, then restart the bridge if needed:

```bash
ocx-cursor install
```

### Cloudflare returns error 1016

The DNS record exists, but no tunnel connector is online. Check the named tunnel and start it:

```bash
cloudflared tunnel info ocx-cursor
cloudflared tunnel run ocx-cursor
```

If you installed the login service, inspect it with:

```bash
launchctl print "gui/$(id -u)/com.cloudflare.cloudflared"
```

### Cursor returns 401

Run `init` again while Cursor is closed. It preserves the bridge key, retests the tunnel, and writes the matching encrypted value back to Cursor:

```bash
npx ocx-cursor init
```

### Models or effort options are missing

Cursor must be closed before its local model database can be changed. Quit Cursor and run:

```bash
ocx-cursor sync
ocx-cursor status
```

If the status shows a pending sync, wait until every Cursor Helper process has exited. The service applies the queued catalog automatically.

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

The package writes Cursor's local state database and uses Cursor's Safe Storage format. Cursor does not document either interface. A Cursor update can change them.

The current release supports macOS. It does not configure Windows Credential Manager, Linux keyrings, or system services outside launchd.

## License

MIT

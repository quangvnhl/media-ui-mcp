# media-mcp

MCP server + Chrome extension that lets an AI agent drive **Google Flow** (`flow.google.com`) inside the user's own signed-in Chrome session: list projects, generate images, poll results, download files to disk.

> TL;DR (VI): server MCP cục bộ ↔ extension Chrome ↔ tab Flow đang đăng nhập. Agent đọc `docs/AGENT.md` để dùng, `docs/TOOLS.md` để tra tham số, `docs/TROUBLESHOOTING.md` khi lỗi.

## Why this architecture

- **No passwords, no cookies exported.** The extension acts inside the tab that the human already signed into, so Google's session, reCAPTCHA and account context stay intact.
- **Local-only transport.** The server binds `127.0.0.1` and talks to the extension over WebSocket with a shared token. Nothing leaves the machine.
- **Two automation lanes.** DOM/UI automation (default, fully automatic via trusted CDP input) and captured-request replay (`strategy: "api"`, used when a replay plan exists).
- **Jobs, not fire-and-forget.** Generation is asynchronous; the server tracks a job and discovers new media ids by diffing the project before/after.

## Requirements

- Node.js >= 20.11 (Windows, macOS or Linux)
- Google Chrome >= 116, signed in at `flow.google.com`
- An MCP client (opencode, Claude Desktop, or any stdio MCP host)

## Install (human, one time)

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `packages/extension/dist/extension`.
2. Pin the extension, open `https://flow.google.com` and sign in.
3. Click the extension icon → **Pair**. It discovers the local server on ports 8765-8774 and stores the token.
4. Register the MCP server with your client:

```bash
npm run register              # prints the JSON snippet
npm run register -- --write-opencode   # writes ./opencode.json
```

- opencode: the snippet goes under `mcp` in `opencode.json`, then restart opencode.
- Claude Desktop: merge the printed `mcpServers` block into `claude_desktop_config.json`, then restart the app.

The server is launched by the MCP client, not by hand. Manual runs (`npm start`) are for debugging only; logs go to stderr because stdout is the MCP wire.

## Verify the install

Ask the agent (or run in a client) `flow_status`. A healthy setup returns:

```json
{
  "connectionState": "connected",
  "paired": true,
  "extension": {
    "pageReady": true,
    "hooksInstalled": true,
    "accountIndex": 1,
    "capabilities": { "trustedClicks": true, "domSubmit": true }
  }
}
```

If `extension` is `null`, the extension has not paired or the server port changed — reopen the popup and press **Reconnect**.

## Repository layout

```
packages/
  shared/      protocol types, zod parameter schemas, error codes, UI patterns
  server/      stdio MCP server, loopback HTTP/WS bridge, job store
  extension/   MV3 extension: background worker, content scripts (MAIN + ISOLATED), popup, offscreen
scripts/
  register-mcp.mjs   prints/writes MCP client config
  smoke.mjs          end-to-end smoke test against a live Flow tab
docs/
  AGENT.md           how an AI agent should use the tools (start here)
  TOOLS.md           per-tool input/output reference
  TROUBLESHOOTING.md failure matrix and diagnostics
```

## Development

```bash
npm run typecheck          # tsc --noEmit across the workspace
npm test                   # server unit tests
npm run build              # server bundle + extension bundle
npm run build:extension    # extension only
npm run smoke              # live end-to-end check (needs a paired Flow tab)
```

Reload loop:

| Change | Action |
| --- | --- |
| `packages/extension/**` | `npm run build:extension`, reload the extension at `chrome://extensions`, then F5 the Flow tab |
| `packages/extension/manifest.json` | same as above; Chrome applies new permissions only on full reload |
| `packages/server/**` or `packages/shared/**` | `npm run build`, then restart the MCP client (opencode/Claude Desktop) |

## Local state

| Path | Purpose |
| --- | --- |
| `~/.media-mcp/token` | shared bridge secret (auto-generated, mode 0600) |
| `~/.media-mcp/port` | port chosen by the server |
| `~/.media-mcp/settings.json` | download subfolder, pinned account, spend flag |
| `~/.media-mcp/jobs.json` | generation job history (last 200) |
| `~/.media-mcp/discovery-capture.json` | last `flow_discovery_export` payload |

Override the directory with `MEDIA_MCP_HOME`. Port with `--port` or `MEDIA_MCP_PORT`.

## Known limits

- `referenceImages` (image-to-image) is not implemented: returns `E_UNSUPPORTED`.
- `count > 1` submits once; call `flow_image_generate` again for more images.
- Project rename after creation is best-effort; Flow may keep its own prefix in the title.
- The `strategy` field reports the lane actually used. `"dom"` means trusted CDP typing into the composer — it is fully automatic, not a manual fallback.
- Video generation is out of scope (v1 is images + projects + download).

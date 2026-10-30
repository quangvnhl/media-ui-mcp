# media-ui-mcp

MCP server + Chrome extension that lets an AI agent drive **Google Flow** (`flow.google.com`) inside the user's own signed-in Chrome session: list projects, generate images, poll results, download files to disk.

> In short: local MCP server ↔ Chrome extension ↔ signed-in Flow tab. Agents should read `docs/AGENT.md` for usage, `docs/TOOLS.md` for tool parameters, and `docs/TROUBLESHOOTING.md` for diagnostics.

## Current version: 0.2.2

The server package and Chrome extension are both version **0.2.2**. This describes the current repository build; publishing to npm is a separate step. The npm package contains the server, not the Chrome extension. Build and load the extension from this repository.

### Available features

| Feature | What works in this version | Tools |
| --- | --- | --- |
| Connection status | Check pairing, extension version, active Flow tab, account, page readiness and trusted-input capability | `flow_status` |
| Multiple Google accounts | List accounts seen in open Flow tabs and pin the intended account by index or email | `flow_accounts_list`, `flow_account_select` |
| Named project listing | Read IDs, URLs and actual card titles, including custom names such as `Demo Project` and default date-based names; exclude thumbnail descriptions and edit icons | `flow_projects_list` |
| Dynamic project lists | Wait for titles, scroll for up to 12 seconds, deduplicate by ID and retain cards already seen during virtualization | `flow_projects_list` |
| Project navigation and creation | Open an existing project by ID, or explicitly create a project; renaming a newly created project is best-effort | `flow_project_open`, `flow_project_create` |
| Model and aspect options | Report detected/configured image models and aspect ratios; request settings through Flow's UI and return warnings when settings cannot be applied | `flow_models_list`, `flow_image_generate` |
| Text-to-image | Submit a prompt through trusted Chrome DevTools Protocol input using the signed-in Flow session; supports model, aspect ratio and count parameters | `flow_image_generate` |
| Asynchronous jobs | Return a job ID, track progress, identify new media and expose recent jobs; job history persists locally | `flow_job_status` |
| Existing project media | List currently rendered media IDs and download URLs | `flow_media_list` |
| Downloads | Download through Chrome, return the absolute local path, MIME type and byte count; optionally move a file to an explicitly requested destination | `flow_media_download` |
| Settings | Read or update the download subfolder, default account and spend flag | `flow_config` |
| Diagnostics | Check page selectors, project-title detection, hooks and trusted-input permission; export captured data for local debugging | `flow_selftest`, `flow_discovery_export` |
| Shared MCP access | Multiple local clients connect to one daemon through authenticated Streamable HTTP or a stdio forwarding shim | `/mcp`, `--stdio` |

Live verification covers custom/default project-title extraction, exclusion of edit-icon text, and generating and downloading a square avatar in an existing project. This does not establish that every model, batch size or client configuration has been tested live. All examples below are synthetic, not captured session output.

### Current limitations

- Project-list completeness is not guaranteed. `hasMore: null` means unknown; `true` means more cards were collected than the requested `limit`. Pagination cursors return `E_UNSUPPORTED`. A missing project must not trigger automatic creation of a replacement.
- Missing titles return `name: null` with warnings. Different projects may share a name; use `projectId` to distinguish them.
- Model/aspect/count selection is best-effort. The model list includes configured fallback names, so it is not a guarantee of account entitlement. Read submission warnings.
- `count` accepts 1–4, but the current trusted-input implementation selects xN and also dispatches Enter N times. Exact batch behavior is not verified. For an exact requested number, use sequential `count: 1` jobs and check each result.
- Reference-image input (`referenceImages`), image editing and video generation are not implemented. Media listing covers rendered items, not a complete project archive.
- Captured-request replay (`strategy: "api"`) requires a replay plan and is not ready out of the box for Flow's `batchexecute` traffic. Use `auto`/`dom` for normal operation.
- All clients share the same worker session, pinned account and jobs. Coordinate account changes and project navigation across clients; avoid simultaneous generation workflows.
- Flow must remain signed in and its markup may change. Account quotas, rate limits and safety checks still apply. Do not enable `allowSpend` without the human's explicit instruction.

## Why this architecture

- **No passwords, no cookies exported.** The extension acts inside the tab that the human already signed into, so Google's session, reCAPTCHA and account context stay intact.
- **Loopback-only bridge.** The server binds `127.0.0.1` and talks to the extension over WebSocket with a shared token. Flow itself still sends prompts and media requests to Google; the agent client may also use its own cloud provider.
- **Trusted UI automation.** Generation uses CDP input through the extension's static `debugger` permission. No separate browser-automation extension is required by this project. API replay is an experimental lane, not a setup requirement.
- **Jobs, not fire-and-forget.** Generation is asynchronous; the server tracks a job and discovers new media ids by diffing the project before/after.

## Requirements

- Node.js >= 20.11 (Windows, macOS or Linux)
- For development and the TypeScript test runner, use Node.js >= 22.18; a current supported LTS is recommended.
- Google Chrome >= 116, signed in at `flow.google.com`
- A local MCP client supporting stdio or Streamable HTTP; see [client setup](docs/CLIENTS.md) for OpenCode, Claude Desktop, Claude Code, Cursor, VS Code/Copilot, Codex, Gemini CLI, Cline and Roo Code

## Install (human, one time)

Clone this repository and run these commands from its root:

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `packages/extension/dist/extension`.
2. Pin the extension, open `https://flow.google.com` and sign in.
3. Start one console with `npm start` from this repository. After version 0.2.2 is published, you can instead run `npx -y media-ui-mcp@0.2.2`. Keep it open. The daemon uses only **127.0.0.1:61899**.
4. Click the extension icon → **Pair**. It connects only to port **61899** and stores the token.
5. Register the MCP connection with your client:

```bash
npm run register              # prints the JSON snippet
npm run register -- --write-opencode   # writes ./opencode.json
```

- OpenCode: the snippet goes under `mcp` in `opencode.json`, then reconnect/restart the client.
- Claude Desktop: merge the printed `mcpServers` block into `claude_desktop_config.json`, then restart the app.
- Other clients: follow the [copyable client configurations](docs/CLIENTS.md). To use this checkout before npm publication, configure `node` with the absolute server entry path and `--stdio`.

Every agent connects to the same running daemon. Stdio clients run `npx -y media-ui-mcp --stdio` (a forwarding shim, not another daemon). HTTP clients use `http://127.0.0.1:61899/mcp` with `Authorization: Bearer <token>` from `~/.media-mcp/token`. Keep secrets out of chat and logs. A second daemon detects the existing instance and exits without choosing another port. Logs go to stderr.

## Configure your agent client

| Client | Setup |
| --- | --- |
| OpenCode | [`opencode.json`, local stdio or authenticated HTTP](docs/CLIENTS.md#opencode) |
| Claude Desktop | [`claude_desktop_config.json`, stdio](docs/CLIENTS.md#claude-desktop) |
| Claude Code | [`claude mcp add`, stdio](docs/CLIENTS.md#claude-code) |
| Cursor | [Project or user `mcp.json`, stdio](docs/CLIENTS.md#cursor) |
| VS Code / GitHub Copilot | [`.vscode/mcp.json` or portable MCP configuration](docs/CLIENTS.md#vs-code--github-copilot) |
| Codex CLI / IDE | [`~/.codex/config.toml`, stdio or HTTP](docs/CLIENTS.md#codex-cli--ide) |
| Gemini CLI | [`~/.gemini/settings.json`, stdio](docs/CLIENTS.md#gemini-cli) |
| Cline / Roo Code | [MCP server settings, stdio](docs/CLIENTS.md#cline--roo-code) |

These are setup examples, not a claim of live testing in every client. The client process must run on the same machine/network context as the daemon. A hosted agent, container, WSL environment or SSH session has its own loopback address; it cannot automatically reach the Chrome host at `127.0.0.1`. Do not expose the bridge publicly to work around this.

## Verify the install

Ask the agent (or run in a client) `flow_status`. A healthy setup returns:

```json
{
  "connectionState": "connected",
  "paired": true,
  "extension": {
    "pageReady": true,
    "hooksInstalled": true,
    "accountIndex": 0,
    "capabilities": { "trustedClicks": true, "domSubmit": true }
  }
}
```

If `extension` is `null`, check that the daemon console is open, then reopen the extension popup and press **Pair** or **Reconnect**.

`pageReady: false` is expected on the project-list page. Open a project before generating. If `trustedClicks` is false, reload the extension and refresh Flow before retrying generation.

## Agent workflow: create an avatar in an existing project

Give any configured client a request such as:

> Use the Flow MCP tools to create one square 3D avatar in the existing project Demo Project, then download it and report its saved path. Check the account and resolve Demo Project to a project ID first. Do not create another project with the same name.

The agent should follow this sequence (replace placeholders with values returned by tools):

```text
flow_status {}
flow_projects_list { "limit": 100 }
flow_project_open { "projectId": "<matched-project-id>" }
flow_models_list { "kind": "image" }
flow_image_generate {
  "projectId": "<matched-project-id>",
  "projectName": "Demo Project",
  "prompt": "A friendly polished 3D avatar, round glasses, teal hoodie, centered head and shoulders, blue-violet background, no text",
  "aspectRatio": "1:1",
  "count": 1
}
flow_job_status { "jobId": "<returned-job-id>" }
flow_media_download {
  "mediaId": "<new-media-id-from-completed-job>",
  "projectId": "<matched-project-id>",
  "projectName": "Demo Project",
  "filename": "example-image.jpg"
}
```

Poll the job every 3–5 seconds until `completed`, `failed` or `timeout`. Download each returned new media ID; never substitute an ID from `baselineMediaIds`. By default Chrome saves under its Downloads directory, typically `Downloads/Flow/<project>/`. Report the actual returned `path` and MIME type: a requested filename extension does not force the output format.

If multiple projects have the same name, ask which ID/URL to use. If no exact match appears and completeness is unknown, ask for the project URL instead of guessing. See the [agent guide](docs/AGENT.md) for error handling and the [tool reference](docs/TOOLS.md) for complete schemas.

## Repository layout

```
packages/
  shared/      protocol types, zod parameter schemas, error codes, UI patterns
  server/      HTTP MCP daemon, stdio forwarding shim, loopback WS bridge, job store
  extension/   MV3 extension: background worker, content scripts (MAIN + ISOLATED), popup, offscreen
scripts/
  register-mcp.mjs   prints/writes MCP client config
  smoke.mjs          end-to-end smoke test against a live Flow tab
docs/
  CLIENTS.md         copyable configuration for agent clients and connection troubleshooting
  AGENT.md           how an AI agent should use the tools (start here)
  TOOLS.md           per-tool input/output reference
  TROUBLESHOOTING.md failure matrix and diagnostics
```

## Development

```bash
npm run typecheck          # tsc --noEmit across the workspace
npm run check:privacy      # detect personal paths, emails, opaque IDs and credential-like values
npm test                   # unit, DOM fixture and mocked integration tests
npm run build              # server bundle + extension bundle
npm run build:extension    # extension only
npm run smoke              # generates and downloads a real image; run only when requested
```

Reload loop:

| Change | Action |
| --- | --- |
| `packages/extension/**` | `npm run build:extension`, reload the extension at `chrome://extensions`, then F5 the Flow tab |
| `packages/extension/manifest.json` | same as above; Chrome applies new permissions only on full reload |
| `packages/server/**` or `packages/shared/**` | `npm run build`, restart the shared daemon console, reconnect MCP clients |

## Local state

| Path | Purpose |
| --- | --- |
| `~/.media-mcp/token` | shared bridge secret (auto-generated, mode 0600) |
| `~/.media-mcp/settings.json` | download subfolder, pinned account, spend flag |
| `~/.media-mcp/jobs.json` | generation job history (last 200) |
| `~/.media-mcp/discovery-capture.json` | last `flow_discovery_export` payload |

Override the directory with `MEDIA_MCP_HOME`; daemon and stdio clients must use the same directory. Production always uses port **61899**. `--embed` and port overrides exist only for isolated tests.

## Further reading

- [Client setup and troubleshooting](docs/CLIENTS.md)
- [Agent workflow and recovery rules](docs/AGENT.md)
- [Tool input/output reference](docs/TOOLS.md)
- [Flow integration troubleshooting](docs/TROUBLESHOOTING.md)

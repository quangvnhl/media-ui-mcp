# Agent client setup (0.2.2)

Connect your client to the **one running media-ui-mcp daemon**. The client launches a stdio forwarding process or connects directly over Streamable HTTP. It must not launch another daemon for each agent session.

## Before configuring a client

1. Build the repository with `npm install` and `npm run build`.
2. Load `packages/extension/dist/extension` at `chrome://extensions`.
3. Run `npm start` from the repository root in a separate console and leave it running.
4. Sign in to Flow in Chrome and pair the extension. The daemon listens on `127.0.0.1:61899`.
5. Choose one configuration below, reconnect the client, then ask it to call `flow_status`.

The examples use `npx -y media-ui-mcp@0.2.2 --stdio`. **They require version 0.2.2 to be available on npm.** To use the checkout before publication, or avoid npm downloads at client startup, replace the launcher with:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/media-ui-mcp/packages/server/dist/index.js", "--stdio"]
}
```

Replace the example path with your own absolute checkout path. On Windows, forward slashes are accepted in Node paths; escape backslashes when writing them in JSON. No path in this guide identifies a real machine. `node` must be on the client's PATH; otherwise use its absolute executable path. In OpenCode, combine the command and arguments into its `command` array. In Codex, put them in the corresponding TOML fields.

For npm-based launchers on Windows, if `npx` cannot be spawned, replace:

```json
{
  "command": "npx",
  "args": ["-y", "media-ui-mcp@0.2.2", "--stdio"]
}
```

with:

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "media-ui-mcp@0.2.2", "--stdio"]
}
```

Merge configuration entries into existing files; keep other MCP servers intact. Configure either stdio or HTTP for this daemon, not both under duplicate server names.

## OpenCode

Add to project `opencode.json` or your user configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "flow": {
      "type": "local",
      "command": ["npx", "-y", "media-ui-mcp@0.2.2", "--stdio"],
      "enabled": true,
      "timeout": 180000
    }
  }
}
```

For this checkout, `npm run register` prints a local absolute-path configuration; treat that output as private. `npm run register -- --write-opencode` writes a portable relative-path project entry without embedding your home directory. Inspect any locally generated configuration before sharing it.

For direct HTTP instead, set `MEDIA_MCP_TOKEN` in the environment inherited by OpenCode to the trimmed contents of the daemon's token file, then use:

```json
{
  "mcp": {
    "flow": {
      "type": "remote",
      "url": "http://127.0.0.1:61899/mcp",
      "oauth": false,
      "headers": { "Authorization": "Bearer {env:MEDIA_MCP_TOKEN}" },
      "enabled": true,
      "timeout": 180000
    }
  }
}
```

Check with `opencode mcp list` and a `flow_status` call. The daemon uses a local token, not an OAuth login.

## Claude Desktop

Open **Settings → Developer → Edit Config** and merge into `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flow": {
      "command": "npx",
      "args": ["-y", "media-ui-mcp@0.2.2", "--stdio"]
    }
  }
}
```

Fully restart the app after saving. Use the Windows `cmd /c` launcher above if needed. Keep the daemon console running; closing a conversation should only close its forwarding process. Verify that the `flow_*` tools are visible and call `flow_status`.

## Claude Code

Register for your user account:

```sh
claude mcp add --transport stdio --scope user flow -- npx -y media-ui-mcp@0.2.2 --stdio
```

On Windows when direct `npx` launch fails:

```powershell
claude mcp add --transport stdio --scope user flow -- cmd /c npx -y media-ui-mcp@0.2.2 --stdio
```

Use `--scope project` instead of `--scope user` for project `.mcp.json` configuration. Inspect `claude mcp list`, or use `/mcp` inside Claude Code, then call `flow_status`.

## Cursor

Merge the following into project `.cursor/mcp.json` or user `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "flow": {
      "command": "npx",
      "args": ["-y", "media-ui-mcp@0.2.2", "--stdio"]
    }
  }
}
```

Enable the entry in Cursor's MCP settings and reconnect/reload if necessary. In an agent session, explicitly request `flow_status` using the Flow MCP tools. This setup is for local Cursor sessions; a cloud agent does not automatically share the Chrome machine's loopback network.

## VS Code / GitHub Copilot

For the VS Code Local harness configuration, add `.vscode/mcp.json`:

```json
{
  "servers": {
    "flow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "media-ui-mcp@0.2.2", "--stdio"]
    }
  }
}
```

Run **MCP: List Servers** to start/restart the entry, enable its tools in the agent chat and request `flow_status`. **MCP: Add Server → Command (stdio)** can also register the launcher.

Newer Copilot harness configurations can use portable `mcpServers` entries in workspace-root `.mcp.json` or user `~/.copilot/mcp-config.json`. For that format use the same `mcpServers` JSON shown for Claude Desktop, rather than the VS Code-specific `servers` wrapper. Choose the configuration destination offered for your active harness; the two formats are not interchangeable.

The extension and daemon must run in the network context used by the MCP launcher. A Remote SSH, container or WSL workspace may start the launcher somewhere that cannot reach the desktop daemon.

## Codex CLI / IDE

Register a stdio entry:

```sh
codex mcp add flow -- npx -y media-ui-mcp@0.2.2 --stdio
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.flow]
command = "npx"
args = ["-y", "media-ui-mcp@0.2.2", "--stdio"]
startup_timeout_sec = 60
tool_timeout_sec = 180
```

On Windows, use `command = "cmd"` and `args = ["/c", "npx", "-y", "media-ui-mcp@0.2.2", "--stdio"]` if necessary.

For direct HTTP instead, load the trimmed token file contents into `MEDIA_MCP_TOKEN` in the environment inherited by Codex:

```toml
[mcp_servers.flow]
url = "http://127.0.0.1:61899/mcp"
bearer_token_env_var = "MEDIA_MCP_TOKEN"
tool_timeout_sec = 180
```

Use only one `[mcp_servers.flow]` block. Check `codex mcp list` or `/mcp` in the local CLI, then request `flow_status`. This does not configure a cloud-hosted Codex environment to access your local Chrome.

## Gemini CLI

Merge into user `~/.gemini/settings.json` or project `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "flow": {
      "command": "npx",
      "args": ["-y", "media-ui-mcp@0.2.2", "--stdio"],
      "timeout": 180000
    }
  }
}
```

Restart/reconnect the CLI and inspect `/mcp`. Ask it to call `flow_status`. Use the Windows launcher or absolute Node entry when necessary.

## Cline / Roo Code

Open the extension's **MCP Servers** settings and edit its MCP server configuration. Merge:

```json
{
  "mcpServers": {
    "flow": {
      "command": "npx",
      "args": ["-y", "media-ui-mcp@0.2.2", "--stdio"]
    }
  }
}
```

Enable/reconnect `flow`, then explicitly request `flow_status` from an agent task. Configuration file locations vary between the two extensions and installation profiles, so use their settings UI to open the correct file. Do not enable automatic approval of every tool just to establish the connection.

## Other MCP hosts and SDK agents

Use either transport:

| Transport | Connection |
| --- | --- |
| Stdio | Launch `node /absolute/path/to/packages/server/dist/index.js --stdio`, or the published `npx` launcher above; the shim reads the local token itself |
| Streamable HTTP | URL `http://127.0.0.1:61899/mcp`; send `Authorization: Bearer <trimmed local token>` on requests |

There is no separate legacy `/sse` endpoint or OAuth sign-in. For HTTP use a native local client that can send the authorization header without a browser `Origin` header: the daemon rejects requests carrying `Origin`. Browser-hosted/cloud-only clients are not supported by these instructions.

With an MCP SDK, initialize the connection, list tools and invoke their advertised schemas. Results contain JSON serialized in `content[].text`; check `isError` and the returned `error.code`. Generation returns a job ID rather than waiting for the image. Do not confuse this application-level job mechanism with the MCP Tasks extension.

## Instructions to give any agent

Paste this into the client's task or instruction context. If the client can read this repository, also point it at [AGENT.md](AGENT.md) and [TOOLS.md](TOOLS.md).

```text
Use the configured Flow MCP server for Flow tasks.
Call flow_status first. If disconnected, ask the human to pair/reconnect.
Verify the intended Google account; do not switch accounts silently.
Resolve project names with flow_projects_list and use returned project IDs.
Match exact normalized names first. Ask when duplicate names are ambiguous.
An incomplete list does not prove a project is absent; ask for its URL.
Create a project only when explicitly requested.
Before generation, open the target project and verify trustedClicks=true.
Use flow_models_list for options. Inspect setting/submission warnings.
Use count=1 for exact one-image jobs. Submit workflows sequentially.
Poll flow_job_status every 3–5 seconds until a terminal status.
Download new media IDs from completed jobs with flow_media_download.
Report the actual saved path; do not claim success at submission time.
Do not enable allowSpend or change download destinations without permission.
Never print pairing tokens or discovery-capture request bodies.
```

## Connection troubleshooting

| Symptom | Check |
| --- | --- |
| Package version not found on npm | Use the built checkout's absolute Node entry until 0.2.2 is published |
| `npx` / `node` not found | Check the GUI client's PATH; use `cmd /c npx` on Windows or absolute executable paths |
| Connection refused | Start the one daemon console; check that the launcher runs on the Chrome machine, not in a container/remote host |
| HTTP 401 | Check the trimmed token and `MEDIA_MCP_HOME`; ensure no browser Origin header is sent; this is not OAuth |
| Tools connect but `extension` is null | Pair/reconnect the extension to the running daemon |
| `pageReady: false` on home | Expected; open the target project before generating |
| `trustedClicks: false` | Reload the extension at `chrome://extensions`, then F5 Flow |
| Wrong account/project | Check the shared account pin and returned project ID; coordinate with other clients |
| Old names or old behavior | Rebuild, reload the extension and F5; restart the daemon and reconnect clients after server changes |
| Tool times out during navigation/download | Where supported, allow at least 180 seconds per tool call; poll generation separately rather than waiting in one call |

The default state directory is `~/.media-mcp`. If you set `MEDIA_MCP_HOME`, give the daemon and every stdio launcher the same absolute value. Most JSON clients use an `env` object, OpenCode uses `environment`, and Codex supports an `[mcp_servers.flow.env]` table. Do not put the pairing token itself in shared configuration files.

Client formats evolve. References: [OpenCode](https://opencode.ai/docs/mcp-servers/), [Claude Code](https://code.claude.com/docs/en/mcp), [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [Codex](https://developers.openai.com/codex/mcp/). Setup examples here have not all been tested live in their respective clients.

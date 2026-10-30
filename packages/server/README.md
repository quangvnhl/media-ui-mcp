# media-ui-mcp

Shared local MCP daemon for Google Flow, using your signed-in Chrome session through the Flow MCP Bridge extension.

## Start once

```sh
npx media-ui-mcp
```

Keep this console open. Every agent and the Chrome extension use **127.0.0.1:61899**. A second invocation detects the running daemon without choosing another port.

Build and load the extension from the [repository](https://github.com/quangvnhl/media-ui-mcp), open its popup and click Pair.

## Agent connections

For stdio clients, configure command `npx` with arguments `["-y", "media-ui-mcp", "--stdio"]`. This is a proxy to the running daemon, not another server. On Windows use `cmd /c npx -y media-ui-mcp --stdio` if your client cannot launch npx directly.

For HTTP MCP clients, connect to `http://127.0.0.1:61899/mcp` with header `Authorization: Bearer <token>`. Read the token locally from `~/.media-mcp/token`; never share it. All sessions share the extension connection and job store.

Use the same `MEDIA_MCP_HOME` for daemon and stdio clients if overriding the default `~/.media-mcp`. Stop the daemon with Ctrl+C. Logs go to stderr.

## Current features (0.2.2)

- Read project IDs, URLs and actual custom/default titles from Flow cards, excluding thumbnail descriptions and edit icons. Wait for titles and collect cards with bounded scrolling.
- List and select Google accounts seen in Flow tabs; open or explicitly create projects.
- Submit text-to-image prompts through trusted Chrome input, request model/aspect/count settings, track asynchronous jobs and list rendered project media.
- Download media through Chrome and return the actual saved path, byte count and MIME type.
- Share one daemon and job store across local stdio and Streamable HTTP clients; inspect status, settings and self-test diagnostics.

Project-list completeness and exact batches above `count: 1` are not guaranteed. Model settings are best-effort; read warnings. Reference-image input, image editing and video generation are not implemented. API replay requires a captured plan and is not ready out of the box.

See [current features and limitations](https://github.com/quangvnhl/media-ui-mcp#current-version-022), [client setup](https://github.com/quangvnhl/media-ui-mcp/blob/main/docs/CLIENTS.md) for OpenCode, Claude, Cursor, VS Code, Codex and other hosts, and the [agent guide](https://github.com/quangvnhl/media-ui-mcp/blob/main/docs/AGENT.md) for the generation/poll/download workflow. The npm package contains the server; the extension must be built and loaded from the repository.

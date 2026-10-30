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

Images, projects, accounts, downloads, model selection, aspect ratio and image count are exposed as MCP tools. See the repository documentation for installation and tool parameters.

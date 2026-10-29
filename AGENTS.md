# AGENTS.md

Operating rules for coding agents (and humans) working in this repository.

## What this is

`media-mcp` is a monorepo of three workspaces:

| Workspace | Role |
| --- | --- |
| `packages/shared` | protocol types, zod tool schemas, error codes, UI regex patterns |
| `packages/server` | stdio MCP server + loopback HTTP/WS bridge + job store |
| `packages/extension` | MV3 extension (background, content scripts, popup, offscreen) |

User-facing docs: `README.md`. Agent-facing docs: `docs/AGENT.md`, `docs/TOOLS.md`, `docs/TROUBLESHOOTING.md`.

## Before you say "done"

```bash
npm run typecheck
npm test
npm run build
```

`npm run smoke` additionally requires a paired Chrome tab on `flow.google.com`; it generates a real image and downloads it. Do not run it without being asked.

## Editing rules

- No comments in source files unless the human asks for them.
- `packages/shared/src` imports use explicit `.ts` extensions (`allowImportingTsExtensions` is on). Keep it that way.
- Import zod schemas via `@media-mcp/shared/schemas`; the bare `@media-mcp/shared` entry must not pull zod into content scripts.
- The MCP server must log to **stderr only**. Anything written to stdout corrupts the MCP protocol.
- Runtime paths derive from `MEDIA_MCP_HOME` (default `~/.media-mcp`). Never hardcode a home directory.
- When adding a tool: schema in `packages/shared/src/schemas.ts`, registration + docs in `packages/server/src/tools.ts`, guide entries in `docs/AGENT.md` and `docs/TOOLS.md`.
- When adding a content-script method: return data only, throw with `code: "E_*"` for failures, and update `flow_selftest` if it affects detection.

## Reload loop (important)

| Changed | Required action |
| --- | --- |
| `packages/extension/src/**` | `npm run build:extension`, reload at `chrome://extensions`, F5 the Flow tab |
| `packages/extension/manifest.json` | same as above; Chrome only applies permissions on full reload |
| `packages/server/src/**`, `packages/shared/src/**` | `npm run build`, restart the MCP client (opencode or Claude Desktop) |

The server bundle is loaded once per MCP client session: tool changes are invisible until restart.

## Flow-specific constraints

- Flow ignores untrusted events. Submission must go through CDP (`Input.insertText`, `Input.dispatchKeyEvent`) using the static `debugger` permission. `chrome.permissions.request` for `debugger` does not work — never re-introduce it as `optional_permissions`.
- The generate button is `button[type="submit"][aria-label="Bắt đầu tạo"]` with an `arrow_forward` icon; prefer `aria-label`/icon matching over text matching.
- Generation traffic is a `batchexecute` RPC with a form-encoded `f.req` body, so generic JSON-template capture will not see it. Keep `state.rpc` raw capture when touching the network hooks.
- Media ids appear either as `/asb/<id>` or `flow-content.google/image/<uuid>`. Both must remain downloadable.

## Security

- Never commit `~/.media-mcp/token`, `~/.media-mcp/discovery-capture.json`, or `discovery-capture.json` copies.
- Do not print captured `at` tokens, cookies, or full request bodies into chat or logs.
- Do not enable `allowSpend` or change a human's download directory without explicit instruction.
- Do not add remote endpoints. The bridge is loopback-only by design (`127.0.0.1`, token-checked WS handshake).

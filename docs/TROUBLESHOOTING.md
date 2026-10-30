# Troubleshooting

## Diagnostic ladder

Run these in order; stop at the first that fails.

1. `flow_status` — is the extension paired, is a tab ready, is `trustedClicks` true?
2. `flow_selftest` — do the DOM selectors and capture hooks still match Flow's markup?
3. `flow_media_list { projectId }` — does the page actually contain media?
4. `flow_discovery_export` — what did the page send on the wire?

## Symptom → cause → fix

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `extension: null`, `connectionState: "disconnected"` | extension unpaired, server restarted on a new port, or Chrome restarted | open the popup → **Pair** (first time) or **Reconnect** |
| `flow_status` times out but `connectionState` is `connected` | stale socket: extension service worker was suspended | popup → Reconnect; if it persists, reload the extension |
| `pageReady: false` | worker tab is on the Flow home or a non-project page | `flow_project_open { projectId }` |
| `E_NO_TAB` | no tab for the pinned account | `flow_account_select` then `flow_project_open` |
| `E_NOT_LOGGED_IN` | Google session expired in that tab | human signs in at `flow.google.com` |
| `E_ACCOUNT_MISMATCH` | pinned `/u/N/` differs from the signed-in account | ask the human, then `flow_account_select { index }` |
| `E_UI_DRIFT` on generate | Flow changed the composer/button markup | `flow_selftest`, report the failing check ids |
| project name is a thumbnail description | old extension reads image alt text | rebuild and reload the extension, F5 Flow; names must come from `.project-title-label` inside `.projects-grid-item` |
| `E_UI_DRIFT` on projects list | project links exist but expected cards cannot be parsed | verify `.projects-grid-item`, `a.project-thumbnail-container[href]`, `.project-title-label`; inspect `project-list-names` in `flow_selftest` on the list page |
| project missing or `name: null` | bounded scrolling did not reach it or its title is still loading | read `warnings` and `hasMore`, retry after loading or use the known project URL; do not create a duplicate automatically |
| generate returns warnings but no image appears | `trustedClicks: false` | reload the extension (`chrome://extensions`), confirm `debugger` in `status.extension.manifest.permissions` |
| job stuck in `submitted` > 30 s | prompt never submitted (composer not focused, or throttled) | check warnings, re-submit once with a shorter prompt, then check `flow_media_list` |
| `E_TIMEOUT` | no new media within 10 min | `flow_media_list { projectId, refresh: true }`; re-submit if absent |
| `E_DOWNLOAD_FAILED` | signed CDN URL expired or tab navigated away | `flow_media_list` again for a fresh URL, then download |
| `E_RATE_LIMITED` / `E_QUOTA` | per-model daily limit or anti-abuse throttle | stop; wait; tell the human |
| `E_SAFETY_BLOCKED` | prompt rejected by policy | rephrase once, then stop |

## The `debugger` permission

Generation types into the composer and presses Enter using the Chrome DevTools Protocol so the events are trusted. That requires the static `debugger` permission.

- `chrome.permissions.request({ permissions: ["debugger"] })` **always fails** with `Only permissions specified in the manifest may be requested`, even when `optional_permissions` contains it. Do not try to grant it at runtime.
- `manifest.json` therefore lists `debugger` under `permissions`. Chrome shows the "Debugger" warning at load time; this is expected for a local dev extension.
- A manifest change is only applied after **reloading the extension**. After that, F5 the Flow tab so content scripts re-inject.
- Verify with `flow_status`: `extension.manifest.permissions` must contain `"debugger"` and `capabilities.trustedClicks` must be `true`.

## Why synthetic clicks are ignored

Flow gates submission on trusted events. `element.click()` and `dispatchEvent(new MouseEvent(...))` produce `isTrusted: false`; the app ignores them silently — **no network request at all**. That is why an unconfirmed submit leaves `rpc`/`templates` empty in `flow_discovery_export`.

Correct order when `trustedClicks` is true:

1. content script focuses and clears the composer,
2. CDP `Input.insertText` types the prompt,
3. CDP `Input.dispatchKeyEvent` sends Enter,
4. the extension waits for the job's media to appear.

If you see `strategy: "dom"` with the warning `Submitted with trusted CDP input`, the automated lane worked.

## API replay is not wired

Flow's generation call is a Google `batchexecute` RPC:

```
POST https://flow.google.com/u/<account-index>/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=<rpc-id>&…
body: f.req=<url-encoded nested JSON>&at=<csrf token>&…
```

Consequences:

- The JSON-template capture path does not match it (form-encoded body, no `prompt` key at top level), so `templates` stays empty and `apiReplay` stays `false`.
- Download/UI lanes do not depend on it; only `strategy: "api"` does.
- `flow_discovery_export` keeps up to 6 raw `rpc` bodies to make calibrating a replay possible later. Replaying needs the `at` token, `f.sid`, and often a fresh reCAPTCHA token, so treat `strategy: "api"` as unavailable until a plan exists.

## Reload matrix

| What changed | Action |
| --- | --- |
| content script / background / popup | `npm run build:extension` → reload extension → F5 Flow tab |
| `manifest.json` (incl. permissions) | same, and Chrome may disable the extension until you accept the new warning |
| server / shared types | `npm run build` → restart the MCP client |
| `~/.media-mcp/token` deleted | both sides regenerate on next start; re-pair the extension |

## Ports and state

- One shared daemon listens only on `127.0.0.1:61899`. Start it once in a console with `npx media-ui-mcp` (after publication) or `npm start`. All agents use `/mcp` with the local Bearer token or the `--stdio` shim. The extension pairs only on 61899; there is no port scan or port-file discovery. If another application occupies the port, startup fails rather than moving ports.
- `1008` WebSocket close = token mismatch. Delete `~/.media-mcp/token`, restart the server, re-pair.
- `~/.media-mcp/jobs.json` survives restarts; jobs that were running are marked `failed` with `E_DISCONNECTED`.
- Set `MEDIA_MCP_DEBUG=1` for verbose server logs (stderr only; stdout is the MCP protocol).

## Windows specifics

- `chrome.downloads` only accepts paths relative to the Downloads folder; that is why `destDir` is handled by the server (it moves the file after the browser download).
- Cross-volume moves fall back to copy + delete.
- Filenames are sanitized; duplicates become `name-1.ext`, `name-2.ext`.

## Known limits

- `referenceImages` → `E_UNSUPPORTED`.
- `count > 1` sets xN and dispatches Enter N times in the current trusted-input implementation; exact batch behavior is unverified. Prefer sequential `count: 1` jobs for exact counts.
- `flow_media_list` cannot report per-image prompt/model/date; Flow does not expose them in the DOM.
- Project rename is best-effort; Flow may re-prefix the title.
- `flow_projects_list` accepts `cursor` but Flow currently returns a single page.
- Video generation is out of scope.

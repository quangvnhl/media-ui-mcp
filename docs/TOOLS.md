# Tool reference

All examples are synthetic. IDs, timestamps, account indices, byte counts and filenames below are illustrative, not captured session data. Paths such as `<download-directory>` and `<media-mcp-home>` are placeholders for local absolute paths; URLs use `<account-index>` instead of a real account selection.

All tools return a JSON object serialized as text. Errors set `isError: true` and return:

```json
{ "error": { "code": "E_UI_DRIFT", "message": "...", "retryable": false } }
```

Limits shared across tools: `accountIndex` is an integer `0..20` (or `null` = page default).

---

## flow_status

Read-only snapshot of the bridge. **Call this first.**

Input: none.

```json
{
  "connectionState": "connected",        // connected | disconnected
  "extensionVersion": "0.2.2",
  "extensionId": "…",
  "protocolVersion": 1,
  "paired": true,
  "connectedAt": "2000-01-01T00:00:00.000Z",
  "lastMessageAt": "…",
  "pendingCalls": 0,
  "extensionCapabilities": null,
  "extension": {
    "connected": true,
    "tabId": 42,
    "url": "https://flow.google.com/u/<account-index>/project/<project-id>",
    "accountIndex": 0,
    "email": "user@example.com",
    "projectId": "<project-id>",
    "pageReady": true,
    "hooksInstalled": true,
    "capabilities": {
      "apiReplay": false,        // a captured request-replay plan exists
      "domSubmit": true,         // UI lane available
      "recaptchaMint": false,
      "trustedClicks": true,     // Chrome debugger permission active — required for generation
      "hooksInstalled": true
    },
    "downloadDir": null,
    "downloadSubdir": "Flow",
    "manifest": {
      "version": "0.2.2",
      "permissions": ["storage", "tabs", "downloads", "scripting", "alarms", "offscreen", "debugger"],
      "optionalPermissions": []
    }
  }
}
```

`extension` is `null` when the server has no paired extension (it still returns bridge-side fields).

---

## flow_accounts_list

Read-only. Enumerates accounts that have a live `flow.google.com` tab.

Input: none.

```json
{
  "accounts": [
    {
      "index": 0,
      "email": "user@example.com",
      "displayName": "Example User",
      "signedIn": true,
      "url": "https://flow.google.com/u/<account-index>/project/<project-id>",
      "tabId": 42,
      "active": true
    }
  ],
  "selectedIndex": null
}
```

---

## flow_account_select

Pins the account used by every later call.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `index` | int 0..20 | one of | `/u/{index}` from a Flow URL |
| `email` | string (email) | one of | resolved against accounts that have a live tab |
| `verify` | boolean | no | re-check the signed-in identity before storing |

```json
{ "index": 0, "email": "user@example.com", "verified": true }
```

Errors: `E_NOT_FOUND` when neither index nor matching email exists.

---

## flow_models_list

Read-only. Reports image models/aspect ratios using live UI detection and configured fallbacks. Returned model names are not a guarantee of account entitlement; inspect generation warnings if a requested setting is unavailable.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `"image"` \| `"video"` | no | defaults to all |

```json
{
  "models": [{ "name": "Imagen 4", "kind": "image", "aspects": ["1:1", "16:9"], "credits": null }],
  "aspects": ["1:1", "3:4", "4:3", "9:16", "16:9"]
}
```

Only pass returned `aspects` values to `flow_image_generate`; unknown ratios fall back to the page default with a warning.

---

## flow_projects_list

Read-only. List projects for the pinned (or given) account.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `accountIndex` | int \| null | no | overrides the pin for this call |
| `cursor` | string | no | not supported; supplying one returns `E_UNSUPPORTED` |
| `limit` | int 1..100 | no | default 50 |

```json
{
  "projects": [
    {
      "projectId": "<project-id>",
      "name": "Demo Project",
      "url": "https://flow.google.com/u/<account-index>/project/<project-id>",
      "accountIndex": 0,
      "updatedAt": null
    }
  ],
  "accountIndex": 0,
  "pageUrl": "https://flow.google.com/u/<account-index>/",
  "hasMore": null,
  "nextCursor": null,
  "warnings": ["Projects were collected from rendered cards with bounded scrolling. Completeness is not verified; absence from this list does not prove a project does not exist."]
}
```

Note: this navigates the worker tab to the account home if it is currently on a project page.

Each `.projects-grid-item` supplies its URL from `a.project-thumbnail-container[href]` and its name from `.project-title-label`. Names are preserved, including default names such as the fabricated `Tháng 1 02 - 03:04`, single-character names and duplicate names with different project IDs. Thumbnail descriptions and action labels are never used as title fallbacks. Missing titles return `name: null` with a warning. `updatedAt` is not inferred from a date-based name.

Collection waits for stable titles and scrolls the list for up to 12 seconds, retaining previously seen cards if the UI virtualizes them. Scroll positions are restored afterward. `hasMore: true` means collected results exceeded `limit`; `null` means completeness is unknown. No pagination cursor is fabricated. Resolve duplicate names by ID rather than selecting the first match. Existing project links without readable cards produce `E_UI_DRIFT`; no cards produce an empty result with a loading/empty-state warning.

---

## flow_project_create

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string 1..120 | no | renamed after creation; Flow may keep its own prefix |
| `accountIndex` | int \| null | no | |

```json
{ "projectId": "<project-id>", "url": "https://flow.google.com/u/<account-index>/project/<project-id>", "name": "Demo Project", "accountIndex": 0 }
```

Errors: `E_TIMEOUT` if the project page does not open within 40 s.

---

## flow_project_open

Opens or focuses the project tab. Use it to recover from `E_NO_TAB` / `E_PAGE_NOT_READY`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `projectId` | string 1..200 | yes | |
| `accountIndex` | int \| null | no | |
| `focus` | boolean | no | bring the tab to the foreground |

```json
{ "tabId": 42, "url": "https://flow.google.com/u/<account-index>/project/<project-id>", "projectId": "<project-id>", "accountIndex": 0 }
```

---

## flow_media_list

Read-only. Media currently rendered in a project.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `projectId` | string 1..200 | yes | |
| `accountIndex` | int \| null | no | |
| `refresh` | boolean | no | re-read the DOM instead of cached tab state |

```json
{
  "projectId": "<project-id>",
  "items": [
    {
      "mediaId": "<media-id>",
      "kind": "image",
      "url": "https://flow.google.com/asb/<media-id>=s512-rw?authuser=<account-index>",
      "thumbUrl": "https://flow.google.com/asb/<media-id>=s512-rw?authuser=<account-index>",
      "prompt": null,
      "model": null,
      "createdAt": null,
      "projectId": "<project-id>"
    }
  ],
  "pageUrl": "https://flow.google.com/u/<account-index>/project/<project-id>",
  "capturedAt": "2000-01-01T00:00:00.000Z"
}
```

`prompt`, `model`, `createdAt` are usually `null`: Flow does not expose them in the DOM. Items are ordered newest-first when the UI renders newest-first; do not rely on ordering — compare ids.

---

## Shared transport

All tools are served by one daemon at `http://127.0.0.1:61899/mcp` with `Authorization: Bearer <local token>`. Run `npx media-ui-mcp` once in a console after publication, or `npm start` from the repo. Stdio clients use `--stdio` to forward requests to the same daemon. Every client shares its extension connection and job store.

## flow_image_generate

Submits a prompt and returns immediately. Single-flight: submissions are serialized by the extension.

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `prompt` | string 1..8000 | yes | | visual description |
| `projectId` | string 1..200 | no | | omit to use/create `projectName` |
| `projectName` | string 1..120 | no | `"MCP Test"` | used to find/create a project when `projectId` is absent |
| `accountIndex` | int \| null | no | | |
| `model` | string 1..80 | no | page default | from `flow_models_list` |
| `aspectRatio` | string ≤12 | no | page default | from `flow_models_list.aspects` |
| `count` | int 1..4 | no | 1 | exact batch behavior above 1 is unverified; prefer sequential `count: 1` jobs |
| `strategy` | `"auto"` \| `"api"` \| `"dom"` | no | `"auto"` | keep `auto` |
| `timeoutMs` | int 5000..600000 | no | 120000 | page-ready wait budget |
| `referenceImages` | string[] max 4, ≤4096 each | no | | **unimplemented**, returns `E_UNSUPPORTED` |

```json
{
  "jobId": "<job-id>",
  "status": "submitted",
  "projectId": "<project-id>",
  "projectName": "Demo Project",
  "accountIndex": 0,
  "strategy": "dom",
  "expectedCount": 1,
  "baselineMediaIds": ["<existing-media-id>"],
  "warnings": [
    "Submitted with trusted CDP input (debugger permission)"
  ],
  "next": "Call flow_job_status with this jobId until status is completed."
}
```

`baselineMediaIds` is the project's media *before* submission; anything outside it is new. `warnings` is free-form diagnostics — always relayed, never fatal on its own.

---

## flow_job_status

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `jobId` | string | no | omit to list the last 20 jobs `{ "jobs": [...] }` |

```json
{
  "jobId": "<job-id>",
  "status": "completed",              // submitted | generating | completed | failed | timeout
  "projectId": "<project-id>",
  "projectName": "Demo Project",
  "accountIndex": 0,
  "prompt": "Flat vector avatar of …",
  "expectedCount": 1,
  "mediaIds": ["<new-media-id>"],
  "error": null,
  "submittedAt": "2000-01-01T00:00:00.000Z",
  "updatedAt": "2000-01-01T00:01:00.000Z",
  "hint": "Call flow_media_download for each mediaId."
}
```

- Poll every 3-5 s. The server also polls automatically every 3 s.
- `completed` when `mediaIds.length >= expectedCount`.
- `timeout` after 10 minutes without new media; `error.code = "E_TIMEOUT"`.
- Jobs are persisted to `~/.media-mcp/jobs.json`. Jobs that were active when the server stopped are marked `failed` with `E_DISCONNECTED` on restart.

---

## flow_media_download

Downloads through Chrome (uses the tab's cookies), then optionally moves the file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `mediaId` | string 1..300 | yes | id from `flow_media_list` or a job |
| `url` | string (url) | no | direct media URL; otherwise the extension resolves it from the tab |
| `projectId` | string ≤200 | no | used to resolve the project page |
| `projectName` | string ≤120 | no | names the default subfolder |
| `filename` | string ≤180 | no | duplicates get `-1`, `-2`, … |
| `subdir` | string ≤180 | no | overrides the configured `downloadSubdir` |
| `destDir` | string ≤500 | no | absolute path; the **server** moves the file after the browser download |

```json
{
  "mediaId": "<new-media-id>",
  "path": "<download-directory>/Flow/Demo Project/example-image.jpg",
  "filename": "example-image.jpg",
  "bytes": 12345,
  "mime": "image/jpeg",
  "moved": false,
  "downloadId": 7
}
```

Without `destDir`, `moved` is `false` and `path` is inside the browser's Downloads folder (`Downloads/<subdir>/<project>/`). With `destDir`, the path is a filesystem path on the machine running the MCP server.

Errors: `E_DOWNLOAD_FAILED` (HTTP/cookie failure), `E_NOT_FOUND` (media id not in the page).

---

## flow_selftest

Read-only health check of selectors, capture hooks and layout. Run after any `E_UI_DRIFT`.

Input: none.

```json
{
  "bridge": { "connectionState": "connected", "paired": true, "…": "…" },
  "extension": {
    "ok": true,
    "checks": [
      { "id": "prompt-box", "ok": true, "detail": "Composer found" },
      { "id": "generate-button", "ok": true, "detail": "…" },
      { "id": "media-dom", "ok": true, "detail": "imgs=5 editables=1 …" },
      { "id": "hooks", "ok": true, "detail": "Capture hooks installed" },
      { "id": "generate-template", "ok": false, "detail": "0 generate request template(s) captured" }
    ],
    "captured": {
      "generateTemplates": 0,
      "apiHosts": ["flow.google.com"],
      "recaptchaSiteKeys": [],
      "lastGenerateAt": null
    }
  }
}
```

`ok` ignores the optional capture checks (`generate-template`, `auth-token`, `recaptcha-sitekey`); it is `true` only when the layout and hook checks pass. A failing `generate-template` just means API replay is unavailable — DOM generation still works.

---

## flow_discovery_export

Read-only. Writes `~/.media-mcp/discovery-capture.json` and returns its contents.

Input: none.

```json
{
  "path": "<media-mcp-home>/discovery-capture.json",
  "data": {
    "export": {
      "exportedAt": "…",
      "accountIndex": 0,
      "pageUrl": "https://flow.google.com/u/<account-index>/project/<project-id>",
      "projectId": "<project-id>",
      "apiHosts": ["flow.google.com"],
      "recaptchaSiteKeys": [],
      "templates": [],
      "capturedResponses": [],
      "rpc": [{ "url": "https://flow.google.com/u/<account-index>/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=<rpc-id>", "body": "<redacted>", "at": "<timestamp>" }]
    },
    "plan": null
  }
}
```

Contains session-scoped identifiers and possibly tokens. Treat as sensitive: summarize, do not dump into chat or commit it.

---

## flow_config

Reads settings when called with no arguments.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `downloadSubdir` | string ≤180 | no | sanitized folder name under Downloads |
| `defaultAccountIndex` | int 0..20 \| null | no | |
| `allowSpend` | boolean | no | credits/spend gate; do not enable on the human's behalf |

```json
{ "settings": { "downloadSubdir": "Flow", "defaultAccountIndex": 0, "allowSpend": false }, "homeDir": "<media-mcp-home>", "allowSpend": false }
```

With updates, returns `{ "settings": { … } }` only.

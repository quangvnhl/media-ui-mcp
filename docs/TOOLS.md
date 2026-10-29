# Tool reference

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
  "extensionVersion": "0.1.0",
  "extensionId": "…",
  "protocolVersion": 1,
  "paired": true,
  "connectedAt": "2026-10-29T16:26:25.464Z",
  "lastMessageAt": "…",
  "pendingCalls": 0,
  "extensionCapabilities": null,
  "extension": {
    "connected": true,
    "tabId": 863198723,
    "url": "https://flow.google.com/u/1/project/<projectId>",
    "accountIndex": 1,
    "email": "code2829@gmail.com",
    "projectId": "<projectId>",
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
      "version": "0.1.0",
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
      "index": 1,
      "email": "code2829@gmail.com",
      "displayName": "…",
      "signedIn": true,
      "url": "https://flow.google.com/u/1/project/…",
      "tabId": 863198723,
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
{ "index": 1, "email": "code2829@gmail.com", "verified": true }
```

Errors: `E_NOT_FOUND` when neither index nor matching email exists.

---

## flow_models_list

Read-only. Reads selectable models/aspect ratios from the live UI.

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
| `cursor` | string | no | accepted for pagination; Flow currently returns the full first page |
| `limit` | int 1..100 | no | default 50 |

```json
{
  "projects": [
    {
      "projectId": "f8854ec6-3c3c-418a-a441-a2829afa70f1",
      "name": "Google Flow – CKW",
      "url": "https://flow.google.com/u/1/project/f8854ec6-…",
      "accountIndex": 1,
      "updatedAt": null
    }
  ],
  "accountIndex": 1,
  "pageUrl": "https://flow.google.com/u/1/"
}
```

Note: this navigates the worker tab to the account home if it is currently on a project page.

---

## flow_project_create

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string 1..120 | no | renamed after creation; Flow may keep its own prefix |
| `accountIndex` | int \| null | no | |

```json
{ "projectId": "…", "url": "https://flow.google.com/u/1/project/…", "name": "CKW", "accountIndex": 1 }
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
{ "tabId": 863198723, "url": "https://flow.google.com/u/1/project/…", "projectId": "…", "accountIndex": 1 }
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
  "projectId": "…",
  "items": [
    {
      "mediaId": "ANqvLOa1X7N0…",
      "kind": "image",
      "url": "https://flow.google.com/asb/ANqvLOa1X7N0…=s512-rw?authuser=1",
      "thumbUrl": "https://flow.google.com/asb/…=s512-rw?authuser=1",
      "prompt": null,
      "model": null,
      "createdAt": null,
      "projectId": "…"
    }
  ],
  "pageUrl": "https://flow.google.com/u/1/project/…",
  "capturedAt": "2026-10-29T16:21:30.883Z"
}
```

`prompt`, `model`, `createdAt` are usually `null`: Flow does not expose them in the DOM. Items are ordered newest-first when the UI renders newest-first; do not rely on ordering — compare ids.

---

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
| `count` | int 1..4 | no | 1 | UI lane submits one image per call; call again for more |
| `strategy` | `"auto"` \| `"api"` \| `"dom"` | no | `"auto"` | keep `auto` |
| `timeoutMs` | int 5000..600000 | no | 120000 | page-ready wait budget |
| `referenceImages` | string[] max 4, ≤4096 each | no | | **unimplemented**, returns `E_UNSUPPORTED` |

```json
{
  "jobId": "3714af68-41ec-4141-8f51-81c9e19e0a93",
  "status": "submitted",
  "projectId": "f8854ec6-…",
  "projectName": "Google Flow – CKW",
  "accountIndex": 1,
  "strategy": "dom",
  "expectedCount": 1,
  "baselineMediaIds": ["ANqvLOa1…", "ANqvLOav…"],
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
  "jobId": "3714af68-…",
  "status": "completed",              // submitted | generating | completed | failed | timeout
  "projectId": "…",
  "projectName": "Google Flow – CKW",
  "accountIndex": 1,
  "prompt": "Flat vector avatar of …",
  "expectedCount": 1,
  "mediaIds": ["10642a41-5a3d-41c3-97aa-8b87e68769dd"],
  "error": null,
  "submittedAt": "2026-10-29T16:26:41.435Z",
  "updatedAt": "2026-10-29T16:27:07.430Z",
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
  "mediaId": "10642a41-5a3d-41c3-97aa-8b87e68769dd",
  "path": "C:\\Users\\Quang\\Downloads\\Flow\\CKW\\ckw-avatar-cdp.jpg",
  "filename": "ckw-avatar-cdp.jpg",
  "bytes": 80929,
  "mime": "image/jpeg",
  "moved": true,
  "downloadId": 399
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
  "path": "C:\\Users\\Quang\\.media-mcp\\discovery-capture.json",
  "data": {
    "export": {
      "exportedAt": "…",
      "accountIndex": 1,
      "pageUrl": "https://flow.google.com/u/1/project/…",
      "projectId": "…",
      "apiHosts": ["flow.google.com"],
      "recaptchaSiteKeys": [],
      "templates": [],
      "capturedResponses": [],
      "rpc": [{ "url": "https://flow.google.com/u/1/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=nzlxg…", "body": "f.req=…", "at": "…" }]
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
{ "settings": { "downloadSubdir": "Flow", "defaultAccountIndex": 1, "allowSpend": false }, "homeDir": "C:\\Users\\Quang\\.media-mcp", "allowSpend": false }
```

With updates, returns `{ "settings": { … } }` only.

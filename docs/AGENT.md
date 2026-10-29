# Agent guide: driving Google Flow through media-mcp

Audience: an AI agent with the `flow_*` tools available. Read this once, then follow the loops below.

Tool schemas: [`TOOLS.md`](./TOOLS.md). Failures: [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

## 1. Mental model

- The tools act on **one Chrome tab** that a human already signed into `flow.google.com`. You never handle credentials.
- Every tool call is a JSON round-trip. Success returns a JSON object as text. Failure returns `isError: true` with `{ "error": { "code", "message", "retryable" } }`.
- **Generation is asynchronous.** `flow_image_generate` only submits. Completion is discovered by polling a job, which diffs the project's media list against the media that existed before submission.
- **Projects are addresses.** `projectId` is the only stable handle. Never invent one; get it from `flow_projects_list`, `flow_project_create`, or the URL.

## 2. Start-of-session checklist

Call `flow_status` first, every session.

| Field | Required value | If not |
| --- | --- | --- |
| `connectionState` | `"connected"` | Stop. Ask the human to open the extension popup and press **Pair**/**Reconnect**. |
| `extension` | not `null` | Same as above; the server is up but no extension is paired. |
| `extension.pageReady` | `true` | Open a Flow project first (`flow_project_open`) or ask the human to load `flow.google.com`. |
| `extension.capabilities.trustedClicks` | `true` | **Generation will not work.** Tell the human to reload the extension at `chrome://extensions`; do not retry in a loop. |
| `extension.accountIndex` | matches intent | Use `flow_account_select` before generating. |

Then identify the project:

```json
{ "name": "flow_projects_list", "arguments": {} }
```

Response: `{ "projects": [{ "projectId", "name", "url", "accountIndex" }], "accountIndex", "pageUrl" }`.

Match names case-insensitively. Flow sometimes stores a prefix (`"Google Flow – CKW"`), so prefer `contains` over equality, and confirm with the human when two projects are similar.

## 3. Canonical loops

### 3.1 Generate one image into an existing project

```
flow_image_generate { prompt, projectId, projectName?, aspectRatio?, model? }
  -> { jobId, status: "submitted", baselineMediaIds, warnings, ... }

flow_job_status { jobId }        # every 3-5 s
  -> status: submitted -> generating -> completed
     completed: mediaIds: ["<id>"] , hint: call flow_media_download

flow_media_download { mediaId, projectId, projectName, filename?, destDir? }
  -> { path, filename, bytes, mime, moved: false }
```

Rules:

- Poll at 3-5 s. The server also auto-polls every 3 s; extra calls are cheap but do not hammer faster than 1 s.
- `completed` means `mediaIds.length >= expectedCount`. Media usually appears 10-30 s after submit.
- Download **every** id in `mediaIds`; do not reuse ids from `baselineMediaIds` (those are older images).
- `warnings` are diagnostic, not fatal. Read them: they state which lane submitted (`trusted CDP input`), whether an aspect ratio fell back to the page default, or whether a request was not observed.
- `strategy: "dom"` in the response is the normal, fully automatic lane. Do not report it to the human as "manual".

### 3.2 Generate N images

`count` is accepted but the UI lane submits one prompt per call. For N images, call `flow_image_generate` N times sequentially (not in parallel), each with its own jobId and poll. Vary prompts per call if the human wants distinct results.

### 3.3 Create a project and fill it

```
flow_project_create { name: "CKW" }
  -> { projectId, url, name, accountIndex }
flow_image_generate { prompt, projectId }
...
```

If `name` comes back prefixed by Flow, keep the returned `projectId` and pass `projectName` exactly as returned on later calls.

### 3.4 Choose the account

```
flow_accounts_list {}
  -> { accounts: [{ index, email, displayName, signedIn, tabId, active }], selectedIndex }

flow_account_select { index: 1 }          # or { email: "x@y.z", verify: true }
```

Pinned accounts apply to every later call that accepts `accountIndex`. Generation fails with `E_ACCOUNT_MISMATCH` rather than silently using the wrong Google identity — do not retry with a different account without asking the human.

## 4. Choosing parameters

- `prompt`: plain text, up to 8000 chars. Write the visual content, not instructions to the tool ("a flat vector avatar of ...", not "generate me an avatar").
- `aspectRatio`: only pass values returned by `flow_models_list` (`{ models, aspects }`). An unsupported ratio produces a warning and the page default is used.
- `model`: exact name from `flow_models_list`; omit to use the account default.
- `strategy`: leave as `auto`. `api` is reserved for captured-request replay and fails with `E_UNSUPPORTED`-style errors when no replay plan exists. `dom` forces the UI lane.
- `filename` / `destDir` (download): `filename` sets the saved name; duplicates get `-1`, `-2`. Without `destDir` the file stays under `Downloads/<downloadSubdir>/<project>/`. With `destDir` the **server** moves the file there and returns the absolute path; `destDir` must be writable by the process running the MCP server, not by the browser.
- `refresh`: on `flow_media_list`, forces a re-read of the DOM instead of the cached tab state.

## 5. Reading results

`flow_image_generate` ack fields worth surfacing:

| Field | Meaning |
| --- | --- |
| `jobId` | handle for `flow_job_status` |
| `projectId` / `projectName` | where the image will appear (projectName may be Flow's normalized title) |
| `accountIndex` | Google identity used |
| `strategy` | `"dom"` (UI, automatic) or `"api"` (replay) |
| `warnings` | lane details and degradations |

`flow_job_status`:

| `status` | Action |
| --- | --- |
| `submitted` | Wait, poll again. |
| `generating` | Wait, poll again. |
| `completed` | Download each `mediaIds` entry. |
| `failed` | Read `error.code`. Fix the cause (usually account, page state, or quota) before retrying. |
| `timeout` | No new media in 10 min. Call `flow_media_list { projectId }` once: the image may still exist without being linked to the job. Otherwise re-submit. |

Media ids come in two shapes; both are valid download keys:

- `https://flow.google.com/asb/<base64-ish>` → `mediaId` is the path segment.
- `https://flow-content.google/image/<uuid>` → `mediaId` is the uuid.

Pass `mediaId` exactly as returned; passing a `url` is optional.

## 6. Errors you must handle, not retry blindly

| Code | Meaning | Correct move |
| --- | --- | --- |
| `E_DISCONNECTED` | extension offline mid-call | `flow_status`; if down, ask the human to reconnect |
| `E_NO_TAB` / `E_PAGE_NOT_READY` | no usable Flow tab | `flow_project_open` with a known projectId |
| `E_NOT_LOGGED_IN` | tab exists but Google session expired | ask the human to sign in |
| `E_ACCOUNT_MISMATCH` | pinned account ≠ signed-in account | ask which account to use, then `flow_account_select` |
| `E_UI_DRIFT` | Flow markup changed (button/composer not found) | run `flow_selftest`, report failing check ids; do not loop |
| `E_RATE_LIMITED` / `E_QUOTA` | Flow throttled or daily limit | stop generating; report to the human |
| `E_SAFETY_BLOCKED` | prompt rejected by Flow policy | rephrase once; if repeated, stop |
| `E_UNSUPPORTED` | feature not implemented (e.g. `referenceImages`) | explain the limit, continue without it |
| `E_BAD_INPUT` | parameter validation failed | fix the argument, do not retry unchanged |
| `E_TIMEOUT` | job or page wait exceeded | see `timeout` row above |

`retryable: true` means one bounded retry (max 2) with backoff is acceptable. `retryable: false` never retries.

## 7. Anti-patterns

- Polling `flow_status` instead of `flow_job_status` to detect completion — status has no media information.
- Submitting several `flow_image_generate` calls in parallel. The extension serializes submissions; parallel calls create jobs with interleaved baselines and confusing media ids.
- Downloading `baselineMediaIds` "just in case" — those are pre-existing images and confuse the human.
- Screenshotting or scraping the page yourself. All needed state is exposed by the tools.
- Treating `strategy: "dom"` as a partial/manual result. It is the automated lane.
- Asking the human to click Generate. If generation needs a human click, `trustedClicks` is `false`; fix the extension permission instead (see checklist).

## 8. Maintenance hooks

- `flow_selftest` — returns `{ ok, checks: [{ id, ok, detail }], captured }`. Run after any suspicious failure; `ok: false` with check ids `prompt-box`, `generate-button`, `media-dom`, `hooks`, `generate-template` pinpoints what broke.
- `flow_discovery_export` — dumps captured request templates, API hosts and reCAPTCHA keys to `~/.media-mcp/discovery-capture.json`. Use when API replay needs recalibration; do not paste its contents into chat (it may contain tokens).
- `flow_config` — read or change `downloadSubdir`, `defaultAccountIndex`, `allowSpend`. Never enable `allowSpend` on the human's behalf.

import { DEFAULT_PORT } from "@media-mcp/shared";
import { getSettings, patchSettings } from "./lib/storage.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const stateEl = $("state");
const dotEl = $("dot");
const versionEl = $("version");
const pairMsg = $("pairMsg");
const saveMsg = $("saveMsg");
const subdirInput = $<HTMLInputElement>("subdir");
const accountEl = $("account");
const tabEl = $("tab");
const projectEl = $("project");
const planEl = $("plan");

interface PopupStatus {
  bridge: string;
  error: string | null;
  version: string;
  settings: {
    token: string | null;
    port: number | null;
    subdir: string;
    accountIndex: number | null;
    replayPlan: { promptPath?: string } | null;
  };
}

function setMessage(el: HTMLElement, text: string, kind?: "ok" | "error"): void {
  el.textContent = text;
  el.className = `msg${kind ? ` ${kind}` : ""}`;
}

async function refresh(): Promise<void> {
  const status = (await chrome.runtime.sendMessage({ kind: "popup.status" })) as PopupStatus | undefined;
  if (!status) return;

  stateEl.textContent =
    status.bridge === "connected"
      ? "Connected to MCP server"
      : status.bridge === "connecting"
        ? "Connecting…"
        : status.bridge === "unpaired"
          ? "Not paired"
          : status.bridge === "unauthorized"
            ? "Pairing rejected"
            : "Disconnected";

  dotEl.className = `dot ${status.bridge}`;
  versionEl.textContent = `v${status.version}`;
  if (document.activeElement !== subdirInput) subdirInput.value = status.settings.subdir;
  planEl.textContent = status.settings.replayPlan?.promptPath ? "API + DOM" : "DOM only";

  if (status.error) setMessage(pairMsg, status.error, "error");

  const tabs = await chrome.tabs.query({});
  const flowTab = tabs.find((tab) => (tab.url ?? "").includes("flow.google.com"));
  if (flowTab?.url) {
    const match = /\/u\/(\d+)/.exec(flowTab.url);
    accountEl.textContent = status.settings.accountIndex !== null
      ? `/u/${status.settings.accountIndex}/`
      : match
        ? `/u/${match[1]}/`
        : "default";
    tabEl.textContent = String(flowTab.id ?? "—");
    const projectMatch = /\/project\/([^/?#]+)/.exec(flowTab.url);
    projectEl.textContent = projectMatch?.[1]?.slice(0, 12) ?? "—";
  } else {
    accountEl.textContent = "no Flow tab";
  }
}

async function findServer(): Promise<{ port: number; token: string } | null> {
  const port = DEFAULT_PORT;
  try {
      const response = await fetch(`http://127.0.0.1:${port}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      if (!response.ok) return null;
      const pair = (await response.json()) as { token?: string };
      if (pair.token) return { port, token: pair.token };
  } catch {
    return null;
  }
  return null;
}

$("pair").addEventListener("click", async () => {
  setMessage(pairMsg, "Looking for a local MCP server…");
  const found = await findServer();
  if (!found) {
    setMessage(
      pairMsg,
      `No MCP server found on port ${DEFAULT_PORT}. Run npx media-ui-mcp in a console and try again.`,
      "error"
    );
    return;
  }
  await patchSettings({ port: found.port, token: found.token });
  setMessage(pairMsg, `Paired on port ${found.port}.`, "ok");
  await chrome.runtime.sendMessage({ kind: "bridge.reconnect" });
  setTimeout(() => void refresh(), 800);
});

$("reconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ kind: "bridge.reconnect" });
  setMessage(pairMsg, "Reconnecting…");
  setTimeout(() => void refresh(), 800);
});

$("save").addEventListener("click", async () => {
  const value = subdirInput.value.trim() || "Flow";
  await patchSettings({ subdir: value });
  await chrome.runtime.sendMessage({
    kind: "popup.status"
  });
  setMessage(saveMsg, "Saved. Used as the default download subfolder.", "ok");
  setTimeout(() => setMessage(saveMsg, ""), 2500);
});

$("debugger").addEventListener("click", async () => {
  setMessage(pairMsg, "Requesting the debugger permission…");
  try {
    const already = await chrome.permissions.contains({ permissions: ["debugger"] });
    if (already) {
      setMessage(pairMsg, "Trusted clicks are already enabled.", "ok");
      await refresh();
      return;
    }
    const granted = await chrome.permissions.request({ permissions: ["debugger"] });
    setMessage(
      pairMsg,
      granted
        ? "Trusted clicks enabled."
        : "Permission not granted. Click Enable again and press Allow in the Chrome dialog.",
      granted ? "ok" : "error"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setMessage(pairMsg, `Permission request failed: ${message}`, "error");
  }
  await refresh();
});

$("openFlow").addEventListener("click", async () => {
  const settings = await getSettings();
  const url =
    settings.accountIndex === null
      ? "https://flow.google.com/"
      : `https://flow.google.com/u/${settings.accountIndex}/`;
  await chrome.tabs.create({ url });
});

void refresh();
setInterval(() => void refresh(), 2000);

import {
  parseAccountIndex,
  type AccountInfo
} from "@media-mcp/shared";
import { getSettings, patchSettings, setAccountEmail } from "./storage.js";
import { callContent, ensureContent, findFlowTabs, getPageInfo, getTab, sleep } from "./tabs.js";

interface PageInfo {
  href: string;
  accountIndex: number | null;
  email: string | null;
  ready: boolean;
}

async function readPageInfo(tabId: number): Promise<PageInfo | null> {
  try {
    await ensureContent(tabId);
    return await getPageInfo(tabId);
  } catch {
    return null;
  }
}

export async function listAccounts(): Promise<{ accounts: AccountInfo[]; selectedIndex: number | null }> {
  const settings = await getSettings();
  const tabs = await findFlowTabs();
  const byIndex = new Map<number, AccountInfo>();

  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const index = parseAccountIndex(tab.url ?? "");
    if (index === null) continue;
    if (byIndex.has(index)) {
      const existing = byIndex.get(index)!;
      if (tab.active) existing.active = true;
      continue;
    }

    let email = settings.emailByIndex[String(index)] ?? null;
    let ready = false;
    const info = await readPageInfo(tab.id);
    if (info) {
      email = info.email ?? email;
      ready = info.ready;
      if (email) await setAccountEmail(index, email);
    }

    byIndex.set(index, {
      index,
      email,
      displayName: null,
      signedIn: ready || email !== null,
      url: tab.url ?? null,
      tabId: tab.id,
      active: tab.active ?? false
    });
  }

  const accounts = [...byIndex.values()].sort((a, b) => a.index - b.index);
  return { accounts, selectedIndex: settings.accountIndex };
}

export async function resolveAccountIndex(
  requested: number | null | undefined,
  email?: string
): Promise<number | null> {
  if (typeof requested === "number") return requested;
  const settings = await getSettings();
  if (email) {
    const { accounts } = await listAccounts();
    const match = accounts.find((account) => (account.email ?? "").toLowerCase() === email.toLowerCase());
    if (match) return match.index;
    throw Object.assign(new Error(`No Flow tab is signed in as ${email}`), { code: "E_ACCOUNT_MISMATCH" });
  }
  if (settings.accountIndex !== null) return settings.accountIndex;

  const { accounts } = await listAccounts();
  return accounts[0]?.index ?? null;
}

export async function selectAccount(params: {
  index?: number;
  email?: string;
  verify?: boolean;
}): Promise<{ index: number | null; email: string | null; verified: boolean }> {
  const { accounts } = await listAccounts();
  let index = typeof params.index === "number" ? params.index : null;

  if (index === null && params.email) {
    const match = accounts.find((account) => (account.email ?? "").toLowerCase() === params.email!.toLowerCase());
    if (!match) {
      throw Object.assign(new Error(`No Flow tab is signed in as ${params.email}`), { code: "E_ACCOUNT_MISMATCH" });
    }
    index = match.index;
  }

  if (index === null) {
    throw Object.assign(new Error("Provide index or email"), { code: "E_BAD_INPUT" });
  }

  const tab = accounts.find((account) => account.index === index)?.tabId ?? null;
  let email: string | null = null;
  let verified = false;

  if (tab !== null) {
    const info = await readPageInfo(tab);
    email = info?.email ?? null;
    verified = !!email;
  }

  if (params.verify !== false) {
    if (params.email && email && params.email.toLowerCase() !== email.toLowerCase()) {
      throw Object.assign(
        new Error(`Selected tab is signed in as ${email}, not ${params.email}`),
        { code: "E_ACCOUNT_MISMATCH" }
      );
    }
    if (params.email && !email) {
      verified = false;
    }
  }

  await patchSettings({ accountIndex: index });
  if (email) await setAccountEmail(index, email);

  return { index, email, verified };
}

export async function detectEmailForTab(tabId: number): Promise<string | null> {
  const info = await readPageInfo(tabId);
  const index = info?.accountIndex ?? null;
  if (info?.email && index !== null) await setAccountEmail(index, info.email);
  return info?.email ?? null;
}

export async function waitForAccountTab(accountIndex: number | null, timeoutMs = 60_000): Promise<number> {
  const settings = await getSettings();
  const key = String(accountIndex ?? "none");
  const tabId = settings.workerTabs[key];
  if (typeof tabId !== "number") {
    throw Object.assign(new Error("No worker tab for this account"), { code: "E_NO_TAB" });
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await getTab(tabId);
    if (!tab) break;
    if (parseAccountIndex(tab.url ?? "") === accountIndex) return tabId;
    await sleep(400);
  }
  throw Object.assign(new Error("Worker tab is not on the expected account"), { code: "E_ACCOUNT_MISMATCH" });
}

export async function currentStatusEmail(tabId: number): Promise<string | null> {
  try {
    await ensureContent(tabId);
    const info = await callContent<{ email: string | null }>(tabId, "info", undefined, 10_000);
    return info.email;
  } catch {
    return null;
  }
}

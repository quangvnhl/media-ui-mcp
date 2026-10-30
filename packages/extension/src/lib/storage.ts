import { DEFAULT_PORT } from "@media-mcp/shared";

export interface ExtensionSettings {
  token: string | null;
  port: number | null;
  subdir: string;
  accountIndex: number | null;
  emailByIndex: Record<string, string>;
  workerTabs: Record<string, number>;
  replayPlan: ReplayPlan | null;
  trustedClicks: boolean;
}

export interface ReplayPlan {
  url?: string;
  promptPath?: string;
  countPath?: string;
  aspectPath?: string;
  action?: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  token: null,
  port: DEFAULT_PORT,
  subdir: "Flow",
  accountIndex: null,
  emailByIndex: {},
  workerTabs: {},
  replayPlan: null,
  trustedClicks: false
};

const KEY = "settings";

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY] as Partial<ExtensionSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(value ?? {}), port: DEFAULT_PORT };
}

export async function patchSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch, port: DEFAULT_PORT };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function getAccountIndex(): Promise<number | null> {
  const settings = await getSettings();
  return settings.accountIndex;
}

export async function setAccountEmail(index: number, email: string | null): Promise<void> {
  const settings = await getSettings();
  const emailByIndex = { ...settings.emailByIndex };
  if (email) emailByIndex[String(index)] = email;
  await patchSettings({ emailByIndex });
}

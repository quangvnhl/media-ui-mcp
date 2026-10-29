import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PORT } from "@media-mcp/shared";

export interface ServerConfig {
  homeDir: string;
  tokenFile: string;
  jobsFile: string;
  settingsFile: string;
  token: string;
  port: number;
  allowSpend: boolean;
  debug: boolean;
}

export interface Settings {
  downloadSubdir?: string;
  defaultAccountIndex?: number | null;
  allowSpend?: boolean;
}

function parsePort(argv: string[]): number {
  const flagIndex = argv.indexOf("--port");
  const raw = flagIndex >= 0 ? argv[flagIndex + 1] : process.env.MEDIA_MCP_PORT;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT;
}

export function readSettings(config: Pick<ServerConfig, "settingsFile">): Settings {
  try {
    const raw = fs.readFileSync(config.settingsFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Settings) : {};
  } catch {
    return {};
  }
}

export function writeSettings(config: Pick<ServerConfig, "settingsFile">, settings: Settings): Settings {
  const merged = { ...readSettings(config), ...settings };
  fs.mkdirSync(path.dirname(config.settingsFile), { recursive: true });
  fs.writeFileSync(config.settingsFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

function ensureToken(tokenFile: string): { token: string; created: boolean } {
  try {
    const existing = fs.readFileSync(tokenFile, "utf8").trim();
    if (existing.length >= 32) return { token: existing, created: false };
  } catch {
    // generate below
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return { token, created: true };
}

export function loadConfig(argv = process.argv): ServerConfig {
  const homeDir = process.env.MEDIA_MCP_HOME || path.join(os.homedir(), ".media-mcp");
  const tokenFile = path.join(homeDir, "token");
  const { token, created } = ensureToken(tokenFile);
  const settings = readSettings({ settingsFile: path.join(homeDir, "settings.json") });
  const allowSpend =
    process.env.MEDIA_MCP_ALLOW_SPEND === "1" || settings.allowSpend === true;

  return {
    homeDir,
    tokenFile,
    jobsFile: path.join(homeDir, "jobs.json"),
    settingsFile: path.join(homeDir, "settings.json"),
    token,
    port: parsePort(argv),
    allowSpend,
    debug: process.env.MEDIA_MCP_DEBUG === "1",
    ...(created ? { tokenCreated: true } : {})
  } as ServerConfig & { tokenCreated?: boolean };
}

export { parsePort };

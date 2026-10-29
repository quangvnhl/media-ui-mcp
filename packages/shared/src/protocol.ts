import type { ErrorCode, RpcError } from "./errors.ts";

export type { RpcError } from "./errors.ts";

export interface RpcRequest {
  v: number;
  id: string;
  method: string;
  params?: unknown;
}

export interface RpcSuccess {
  v: number;
  id: string;
  ok: true;
  result?: unknown;
}

export interface RpcFailure {
  v: number;
  id: string;
  ok: false;
  error: RpcError;
}

export type RpcResponse = RpcSuccess | RpcFailure;

export interface RpcEvent {
  v: number;
  type: "event";
  event: string;
  data?: unknown;
}

export interface HelloMessage {
  v: number;
  type: "hello";
  token: string;
  extensionVersion: string;
  extensionId: string;
}

export type ClientMessage = RpcResponse | RpcEvent | HelloMessage;
export type ServerMessage = RpcRequest | { v: number; type: "welcome"; protocolVersion: number };

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && typeof v.id === "string" && typeof v.method === "string";
}

export function isHello(value: unknown): value is HelloMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.type === "hello" && typeof v.token === "string";
}

export function isRpcResponse(value: unknown): value is RpcResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || typeof v.id !== "string") return false;
  if (v.ok === true) return true;
  if (v.ok === false) {
    const err = v.error as Record<string, unknown> | undefined;
    return !!err && typeof err.code === "string" && typeof err.message === "string";
  }
  return false;
}

export const ERROR_CODES: ErrorCode[] = [
  "E_PROTOCOL",
  "E_UNAUTHORIZED",
  "E_DISCONNECTED",
  "E_TIMEOUT",
  "E_NOT_FOUND",
  "E_BAD_INPUT",
  "E_ACCOUNT_MISMATCH",
  "E_NO_TAB",
  "E_NOT_LOGGED_IN",
  "E_PAGE_NOT_READY",
  "E_UI_DRIFT",
  "E_RATE_LIMITED",
  "E_QUOTA",
  "E_SAFETY_BLOCKED",
  "E_GENERATION_FAILED",
  "E_DOWNLOAD_FAILED",
  "E_UNSUPPORTED",
  "E_SPEND_NOT_ALLOWED",
  "E_INTERNAL"
];

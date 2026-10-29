export type ErrorCode =
  | "E_PROTOCOL"
  | "E_UNAUTHORIZED"
  | "E_DISCONNECTED"
  | "E_TIMEOUT"
  | "E_NOT_FOUND"
  | "E_BAD_INPUT"
  | "E_ACCOUNT_MISMATCH"
  | "E_NO_TAB"
  | "E_NOT_LOGGED_IN"
  | "E_PAGE_NOT_READY"
  | "E_UI_DRIFT"
  | "E_RATE_LIMITED"
  | "E_QUOTA"
  | "E_SAFETY_BLOCKED"
  | "E_GENERATION_FAILED"
  | "E_DOWNLOAD_FAILED"
  | "E_UNSUPPORTED"
  | "E_SPEND_NOT_ALLOWED"
  | "E_INTERNAL";

export interface RpcError {
  code: ErrorCode;
  message: string;
  retryable?: boolean;
  data?: unknown;
}

export class FlowMcpError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly data?: unknown;

  constructor(code: ErrorCode, message: string, options?: { retryable?: boolean; data?: unknown }) {
    super(message);
    this.name = "FlowMcpError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.data = options?.data;
  }

  toRpc(): RpcError {
    return { code: this.code, message: this.message, retryable: this.retryable, data: this.data };
  }
}

export function toRpcError(error: unknown): RpcError {
  if (error instanceof FlowMcpError) return error.toRpc();
  if (error instanceof Error) {
    return { code: "E_INTERNAL", message: error.message, retryable: false };
  }
  return { code: "E_INTERNAL", message: String(error), retryable: false };
}

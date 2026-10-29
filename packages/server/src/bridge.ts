import crypto from "node:crypto";
import http from "node:http";
import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import {
  EXTENSION_ORIGIN_PREFIX,
  PROTOCOL_VERSION,
  isHello,
  isRpcResponse,
  toRpcError,
  type RpcRequest,
  type RpcResponse
} from "@media-mcp/shared";
import { log } from "./log.js";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export interface BridgeStatus {
  connectionState: "connected" | "disconnected";
  extensionVersion: string | null;
  extensionId: string | null;
  protocolVersion: number;
  paired: boolean;
  connectedAt: string | null;
  lastMessageAt: string | null;
  pendingCalls: number;
  extensionCapabilities: Record<string, unknown> | null;
}

export class Bridge extends EventEmitter {
  private readonly server: http.Server;
  private readonly wss: WebSocketServer;
  private socket: WebSocket | null = null;
  private pending = new Map<string, PendingCall>();
  private heartbeat: NodeJS.Timeout | null = null;
  private connectedAt: string | null = null;
  private lastMessageAt: string | null = null;
  private extensionVersion: string | null = null;
  private extensionId: string | null = null;
  private extensionCapabilities: Record<string, unknown> | null = null;

  constructor(
    private readonly port: number,
    private readonly token: string
  ) {
    super();
    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
    this.wss.on("connection", (socket, req) => this.handleConnection(socket, req));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.heartbeat = setInterval(() => this.tick(), 15_000);
    log.info(`bridge listening on ws://127.0.0.1:${this.port}/ws`);
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new Error("bridge stopped"));
    }
    this.pending.clear();
    this.socket?.terminate();
    this.wss.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  isConnected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  status(): BridgeStatus {
    return {
      connectionState: this.isConnected() ? "connected" : "disconnected",
      extensionVersion: this.extensionVersion,
      extensionId: this.extensionId,
      protocolVersion: PROTOCOL_VERSION,
      paired: true,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      pendingCalls: this.pending.size,
      extensionCapabilities: this.extensionCapabilities
    };
  }

  setCapabilities(capabilities: Record<string, unknown>): void {
    this.extensionCapabilities = capabilities;
  }

  call<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    if (!this.isConnected() || !this.socket) {
      return Promise.reject(
        Object.assign(new Error("Chrome extension is not connected"), {
          code: "E_DISCONNECTED",
          retryable: true
        })
      );
    }

    const id = crypto.randomUUID();
    const message: RpcRequest = { v: PROTOCOL_VERSION, id, method };
    if (params !== undefined) message.params = params;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Object.assign(new Error(`Extension call "${method}" timed out after ${timeoutMs}ms`), {
            code: "E_TIMEOUT",
            retryable: true
          })
        );
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        method
      });

      try {
        this.socket?.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin ?? "";
    const isExtension = origin.startsWith(EXTENSION_ORIGIN_PREFIX);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    if (isExtension) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200).end(
        JSON.stringify({
          ok: true,
          port: this.port,
          protocolVersion: PROTOCOL_VERSION,
          extensionConnected: this.isConnected(),
          extensionVersion: this.extensionVersion
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/pair") {
      if (!isExtension) {
        res.writeHead(403).end(JSON.stringify({ ok: false, error: "origin_not_allowed" }));
        return;
      }
      res.writeHead(200).end(
        JSON.stringify({ ok: true, token: this.token, port: this.port, protocolVersion: PROTOCOL_VERSION })
      );
      log.info("pairing request accepted", { origin });
      return;
    }

    res.writeHead(404).end(JSON.stringify({ ok: false, error: "not_found" }));
  }

  private handleUpgrade(
    req: http.IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer
  ): void {
    const origin = req.headers.origin ?? "";
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (!origin.startsWith(EXTENSION_ORIGIN_PREFIX)) {
      log.warn("rejected ws upgrade: bad origin", { origin });
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit("connection", ws, req);
    });
  }

  private handleConnection(socket: WebSocket, req: http.IncomingMessage): void {
    let authenticated = false;
    const origin = req.headers.origin ?? "";
    this.extensionId = origin.replace(EXTENSION_ORIGIN_PREFIX, "").replace(/\/$/, "") || null;

    const authTimer = setTimeout(() => {
      if (!authenticated) {
        log.warn("ws closed: hello not received");
        socket.close(1008, "hello required");
      }
    }, 5000);

    socket.on("message", (data) => {
      this.lastMessageAt = new Date().toISOString();
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        socket.close(1003, "invalid json");
        return;
      }

      if (!authenticated) {
        if (!isHello(parsed) || parsed.token !== this.token) {
          log.warn("ws closed: unauthorized");
          socket.close(1008, "unauthorized");
          return;
        }
        authenticated = true;
        clearTimeout(authTimer);
        this.socket = socket;
        this.connectedAt = new Date().toISOString();
        this.extensionVersion = parsed.extensionVersion ?? null;
        this.extensionId = parsed.extensionId || this.extensionId;
        socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "welcome", protocolVersion: PROTOCOL_VERSION }));
        log.info("extension connected", { version: this.extensionVersion });
        this.emit("connected");
        return;
      }

      if (isRpcResponse(parsed)) {
        this.settle(parsed);
        return;
      }

      const event = parsed as { type?: string; event?: string; data?: unknown };
      if (event.type === "event" && typeof event.event === "string") {
        this.emit("event", event.event, event.data);
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (this.socket === socket) {
        this.socket = null;
        this.connectedAt = null;
        this.rejectAll("Chrome extension disconnected");
        log.info("extension disconnected");
        this.emit("disconnected");
      }
    });

    socket.on("error", (error) => log.warn("ws error", { message: error.message }));
    socket.on("pong", () => {
      this.lastMessageAt = new Date().toISOString();
    });
  }

  private settle(response: RpcResponse): void {
    const call = this.pending.get(response.id);
    if (!call) return;
    this.pending.delete(response.id);
    clearTimeout(call.timer);
    if (response.ok) {
      call.resolve(response.result);
      return;
    }
    call.reject(
      Object.assign(new Error(response.error.message), {
        code: response.error.code,
        retryable: response.error.retryable,
        data: response.error.data
      })
    );
  }

  private rejectAll(reason: string): void {
    for (const [id, call] of this.pending) {
      this.pending.delete(id);
      clearTimeout(call.timer);
      call.reject(Object.assign(new Error(reason), { code: "E_DISCONNECTED", retryable: true }));
    }
  }

  private tick(): void {
    if (!this.socket) return;
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.socket.terminate();
      return;
    }
    try {
      this.socket.ping();
    } catch {
      this.socket.terminate();
    }
  }
}

export function describeError(error: unknown): { code: string; message: string; retryable: boolean } {
  const rpc = toRpcError(error);
  return { code: rpc.code, message: rpc.message, retryable: rpc.retryable ?? false };
}

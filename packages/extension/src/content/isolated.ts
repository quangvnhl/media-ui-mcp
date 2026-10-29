interface PendingMainCall {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingMainCall>();
let mainReady = false;
const readyWaiters: (() => void)[] = [];

function notifyReady(): void {
  mainReady = true;
  while (readyWaiters.length) readyWaiters.shift()?.();
}

const isolatedScope = window as unknown as { __mediaMcpIsolatedInstalled?: boolean };
const alreadyInstalled = isolatedScope.__mediaMcpIsolatedInstalled === true;
isolatedScope.__mediaMcpIsolatedInstalled = true;

if (!alreadyInstalled) window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as
    | { __mediaMcp?: boolean; dir?: string; event?: string; id?: string; ok?: boolean; result?: unknown; error?: unknown }
    | undefined;
  if (!data || data.__mediaMcp !== true) return;

  if (data.dir === "to-isolated" && data.event === "ready") {
    notifyReady();
    return;
  }
  if (data.dir !== "to-main-res" || typeof data.id !== "string") return;

  const call = pending.get(data.id);
  if (!call) return;
  pending.delete(data.id);
  clearTimeout(call.timer);
  if (data.ok) {
    call.resolve(data.result);
  } else {
    const error = data.error as { code?: string; message?: string } | undefined;
    call.reject(
      Object.assign(new Error(error?.message ?? "page call failed"), {
        code: error?.code ?? "E_INTERNAL"
      })
    );
  }
});

function waitReady(timeoutMs: number): Promise<void> {
  if (mainReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error("Flow page hooks did not initialize"), { code: "E_PAGE_NOT_READY" }));
    }, timeoutMs);
    readyWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function callMain(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
  await waitReady(Math.min(timeoutMs, 10_000));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`Page call "${method}" timed out`), { code: "E_TIMEOUT" }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    window.postMessage({ __mediaMcp: true, dir: "to-main", id, method, params }, "*");
  });
}

interface FlowRpcMessage {
  kind: "flow.rpc";
  id: string;
  method: string;
  params?: unknown;
  timeoutMs?: number;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const rpc = message as FlowRpcMessage | undefined;
  if (!rpc || rpc.kind !== "flow.rpc" || typeof rpc.method !== "string") return false;

  callMain(rpc.method, rpc.params, rpc.timeoutMs ?? 30_000)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => {
      const err = error as { code?: string; message?: string };
      sendResponse({ ok: false, error: { code: err.code ?? "E_INTERNAL", message: err.message ?? String(error) } });
    });
  return true;
});

window.postMessage({ __mediaMcp: true, dir: "to-main", id: "boot", method: "ping" }, "*");

let pingAttempts = 0;
const pingTimer = setInterval(() => {
  if (mainReady || pingAttempts >= 15) {
    clearInterval(pingTimer);
    return;
  }
  pingAttempts += 1;
  window.postMessage({ __mediaMcp: true, dir: "to-main", id: `boot-${pingAttempts}`, method: "ping" }, "*");
}, 1000);

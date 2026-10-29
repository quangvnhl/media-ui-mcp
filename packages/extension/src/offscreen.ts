const MAX_DATA_URL_BYTES = 60 * 1024 * 1024;

interface OffscreenMessage {
  target: "offscreen";
  type: "fetch" | "fetch-dataurl" | "revoke";
  url: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const message = raw as OffscreenMessage | undefined;
  if (!message || message.target !== "offscreen") return false;

  if (message.type === "revoke") {
    try {
      URL.revokeObjectURL(message.url);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return false;
  }

  if (message.type === "fetch" || message.type === "fetch-dataurl") {
    (async () => {
      try {
        const response = await fetch(message.url, { credentials: "include", redirect: "follow" });
        if (!response.ok) {
          sendResponse({ ok: false, error: `HTTP ${response.status} for ${message.url}` });
          return;
        }
        const blob = await response.blob();
        const mime = response.headers.get("content-type") ?? blob.type ?? "";
        if (message.type === "fetch-dataurl") {
          if (blob.size > MAX_DATA_URL_BYTES) {
            sendResponse({ ok: false, error: `File too large for data URL: ${blob.size} bytes` });
            return;
          }
          const dataUrl = await blobToDataUrl(blob);
          sendResponse({ ok: true, dataUrl, mime, bytes: blob.size });
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        sendResponse({ ok: true, blobUrl, mime, bytes: blob.size });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  return false;
});

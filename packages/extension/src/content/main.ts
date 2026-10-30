import {
  DEFAULT_ASPECTS,
  DEFAULT_IMAGE_MODELS,
  MODEL_BUTTON_PATTERN,
  NEW_PROJECT_PATTERN,
  parseAccountIndex,
  parseMediaIdFromUrl,
  parseProjectId,
  setByPath,
  type CapturedRequestTemplate,
  type CapturedResponse,
  type MediaItem,
  type ModelOption,
  type ProjectInfo
} from "@media-mcp/shared";
import { PROJECT_CARD_SELECTOR, mergeProjects, projectsFromCards } from "./projects.ts";

const MAX_TEMPLATES = 12;
const MAX_RESPONSES = 40;
const MAX_BODY = 400_000;

interface AuthCapture {
  value: string;
  at: number;
}

interface PageState {
  hooksInstalled: boolean;
  templates: CapturedRequestTemplate[];
  responses: CapturedResponse[];
  apiHosts: string[];
  siteKeys: string[];
  lastAuth: AuthCapture | null;
  lastSubmitAt: number | null;
  rpc: { url: string; body: string; at: string }[];
}

const state: PageState = {
  hooksInstalled: false,
  templates: [],
  responses: [],
  apiHosts: [],
  siteKeys: [],
  lastAuth: null,
  lastSubmitAt: null,
  rpc: []
};

function pushLimited<T>(list: T[], item: T, max: number): void {
  list.push(item);
  while (list.length > max) list.shift();
}

function addHost(url: string): void {
  try {
    const host = new URL(url, location.href).hostname;
    if (host && !state.apiHosts.includes(host)) state.apiHosts.push(host);
  } catch {
    // ignore
  }
}

function headersToObject(headers: HeadersInit | undefined | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) result[String(key)] = String(value);
    return result;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function findHeader(headers: Record<string, string>, name: string): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

function captureSiteKeys(text: string): void {
  const pattern = /[?&](?:site|k)=([A-Za-z0-9_-]{20,})/g;
  for (const match of text.matchAll(pattern)) {
    const key = match[1];
    if (key && !state.siteKeys.includes(key)) state.siteKeys.push(key);
  }
  const bodyKeys = /"siteKey"\s*:\s*"([A-Za-z0-9_-]{20,})"/g;
  for (const match of text.matchAll(bodyKeys)) {
    const key = match[1];
    if (key && !state.siteKeys.includes(key)) state.siteKeys.push(key);
  }
}

function isFlowApi(url: string): boolean {
  return (
    url.includes("aisandbox-pa.googleapis.com") ||
    url.includes("/flowMedia") ||
    url.includes("flow-content.google") ||
    /\/v1\/projects\//.test(url)
  );
}

function observeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null
): void {
  addHost(url);
  const auth = findHeader(headers, "authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    state.lastAuth = { value: auth, at: Date.now() };
  }
  captureSiteKeys(`${url} ${body ?? ""}`);

  if (method === "POST" && /batchexecute/i.test(url) && body) {
    pushLimited(state.rpc, { url: new URL(url, location.href).href, body: body.slice(0, MAX_BODY), at: new Date().toISOString() }, 6);
  }

  const looksLikeGenerate =
    /batchGenerateImages|generateImages|flowMedia:generate|generateImage/i.test(url) ||
    (/flow\.google\.com|aisandbox|labs\.google/i.test(url) &&
      body !== null &&
      body.length > 40 &&
      /"prompt"\s*:/.test(body));
  if (method === "POST" && looksLikeGenerate) {
    pushLimited(
      state.templates,
      {
        url: new URL(url, location.href).href,
        method,
        headers,
        body: body ? body.slice(0, MAX_BODY) : null,
        capturedAt: new Date().toISOString()
      },
      MAX_TEMPLATES
    );
  }
}

function observeResponse(url: string, method: string, status: number, contentType: string, text: string): void {
  if (!/json/i.test(contentType)) return;
  if (!isFlowApi(url) && !/project|media|generate/i.test(url)) return;
  pushLimited(
    state.responses,
    {
      url: new URL(url, location.href).href,
      method,
      status,
      body: text.slice(0, MAX_BODY),
      capturedAt: new Date().toISOString(),
      projectId: parseProjectId(location.href)
    },
    MAX_RESPONSES
  );
  captureSiteKeys(text);
}

function installHooks(): void {
  if (state.hooksInstalled) return;
  state.hooksInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let url = "";
    let method = (init?.method ?? "GET").toUpperCase();
    let headers: Record<string, string> = headersToObject(init?.headers);
    let body: string | null = typeof init?.body === "string" ? init.body : null;

    if (input instanceof Request) {
      url = input.url;
      method = (init?.method ?? input.method ?? "GET").toUpperCase();
      if (Object.keys(headers).length === 0) headers = headersToObject(input.headers);
    } else {
      url = String(input);
    }

    if (url) {
      try {
        observeRequest(url, method, headers, body);
      } catch {
        // never break the page
      }
    }

    const promise = originalFetch(input as RequestInfo, init);
    if (url && isFlowApi(url)) {
      promise
        .then((response) => {
          const type = response.headers.get("content-type") ?? "";
          if (!/json/i.test(type)) return;
          response
            .clone()
            .text()
            .then((text) => observeResponse(url, method, response.status, type, text))
            .catch(() => undefined);
        })
        .catch(() => undefined);
    }
    return promise;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  type XhrMeta = { method: string; url: string; headers: Record<string, string> };
  const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>();

  XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    xhrMeta.set(this, { method: String(method).toUpperCase(), url: String(url), headers: {} });
    return (originalOpen as unknown as (...args: unknown[]) => void).call(
      this,
      method,
      url,
      ...rest
    );
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(
    this: XMLHttpRequest,
    name: string,
    value: string
  ) {
    const meta = xhrMeta.get(this);
    if (meta) meta.headers[name] = value;
    return originalSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = xhrMeta.get(this);
    if (meta) {
      try {
        const text = typeof body === "string" ? body : null;
        const absolute = new URL(meta.url, location.href).href;
        observeRequest(absolute, meta.method, meta.headers, text);
        if (isFlowApi(absolute)) {
          this.addEventListener("load", () => {
            try {
              const contentType = this.getResponseHeader("content-type") ?? "";
              if (/json/i.test(contentType) && typeof this.responseText === "string") {
                observeResponse(absolute, meta.method, this.status, contentType, this.responseText);
              }
            } catch {
              // ignore
            }
          });
        }
      } catch {
        // ignore
      }
    }
    return originalSend.call(this, body ?? null);
  };

  window.addEventListener("message", onWindowMessage, false);
  postToIsolated({ __mediaMcp: true, dir: "to-isolated", event: "ready", at: Date.now() });
}

function postToIsolated(payload: Record<string, unknown>): void {
  window.postMessage(payload, "*");
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.01;
}

function deepAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
  const out: T[] = [];
  const seen = new Set<Element>();
  const roots = new Set<ParentNode>();
  const visit = (node: ParentNode) => {
    if (roots.has(node)) return;
    roots.add(node);
    node.querySelectorAll<T>(selector).forEach((el) => {
      if (!seen.has(el)) {
        seen.add(el);
        out.push(el);
      }
    });
    node.querySelectorAll<HTMLElement>("*").forEach((el) => {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };
  visit(root);
  return out;
}

function elementText(el: Element): string {
  const html = el as HTMLElement;
  return (html.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
}

function matchesText(el: Element, pattern: RegExp): boolean {
  const text = elementText(el);
  if (!text || text.length > 80) return false;
  return pattern.test(text);
}

function findPromptBox(): HTMLElement | null {
  const candidates: HTMLElement[] = [];
  const push = (el: Element | null) => {
    if (el instanceof HTMLElement && isVisible(el)) candidates.push(el);
  };

  document
    .querySelectorAll<HTMLElement>('textarea, [contenteditable="true"], [role="textbox"]')
    .forEach(push);

  if (candidates.length === 0) return null;

  const score = (el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    const placeholder = `${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
    let value = rect.width * rect.height;
    if (/prompt|describe|imagine|mô tả|nhập/i.test(placeholder)) value += 5_000_000;
    if (el.tagName === "TEXTAREA") value += 2_000_000;
    return value;
  };

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] ?? null;
}

function findClickable(pattern: RegExp, root: ParentNode = document): HTMLElement | null {
  const selector = 'button, [role="button"], a, [role="menuitem"], [role="option"]';
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
  return nodes.find((el) => isVisible(el) && matchesText(el, pattern)) ?? null;
}

function isDisabled(el: HTMLElement): boolean {
  return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
}

function findGenerateButton(): HTMLElement | null {
  const EXACT =
    /^(bắt đầu tạo|bắt đầu|bat dau tao|start creating|start generating|generate|generate image|generate video|create|tạo|tạo ảnh|tạo hình ảnh|tạo video|submit|send|gửi)\.?$/i;
  const nodes = deepAll<HTMLElement>('button, [role="button"]').filter(
    (el) => isVisible(el) && !isDisabled(el)
  );

  const labelled = nodes.filter((el) => {
    const labels = [
      elementText(el),
      el.getAttribute("aria-label") ?? "",
      el.getAttribute("title") ?? ""
    ];
    if (labels.some((label) => EXACT.test(label.trim()))) return true;
    const icon = el.querySelector("mat-icon, .material-icons, .google-symbols");
    return /^(arrow_forward|send|spark|auto_awesome)$/i.test((icon?.textContent ?? "").trim());
  });
  if (labelled.length === 0) return null;

  const submitFirst = labelled.filter((el) => (el as HTMLButtonElement).type === "submit");
  const pool = submitFirst.length > 0 ? submitFirst : labelled;

  const box = findPromptBox();
  if (!box) return pool[0]!;
  const boxRect = box.getBoundingClientRect();
  const middle = boxRect.top + boxRect.height / 2;
  pool.sort((a, b) => {
    const da = Math.abs(a.getBoundingClientRect().top + a.getBoundingClientRect().height / 2 - middle);
    const db = Math.abs(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2 - middle);
    return da - db;
  });
  return pool[0]!;
}

function activateGenerateButton(button: HTMLElement): void {
  const native = button as HTMLButtonElement;
  if (native.type === "submit" && native.form) {
    try {
      native.form.requestSubmit(native);
      return;
    } catch {
      // fall back to a synthetic click
    }
  }
  humanClick(button);
}

function promptValue(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return (el.innerText || el.textContent || "").trim();
}

function pressEnter(el: HTMLElement): void {
  el.focus();
  const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}

function findModelButton(): HTMLElement | null {
  return findClickable(MODEL_BUTTON_PATTERN);
}

function setNativeValue(el: HTMLElement, value: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  el.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const inserted = document.execCommand("insertText", false, value);
  if (!inserted) {
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }
}

function humanClick(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const options = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mousedown", options));
  el.dispatchEvent(new PointerEvent("pointerup", { ...options, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseup", options));
  el.click();
}

function centerOf(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findEmail(): string | null {
  const pattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const candidates = deepAll<HTMLElement>(
    '[aria-label*="@"], [data-email], a[href*="accounts.google.com"], [aria-label*="Google Account"]'
  );
  for (const el of candidates) {
    const text = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("data-email") ?? ""} ${el.innerText ?? ""}`;
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  const header = document.querySelector("header");
  if (header) {
    const match = pattern.exec((header as HTMLElement).innerText ?? "");
    if (match) return match[0];
  }
  return null;
}

function findProjectName(): string | null {
  const editable = document.querySelector<HTMLElement>('[contenteditable="true"][aria-label*="roject"], [data-testid*="project-name"]');
  if (editable) {
    const text = elementText(editable);
    if (text) return text.slice(0, 120);
  }
  const heading = document.querySelector("h1");
  if (heading) {
    const text = elementText(heading);
    if (text && text.length < 120) return text;
  }
  const title = document.title.replace(/\s*[-–|]\s*Google\s*Flow\s*$/i, "").trim();
  return title && title.length < 120 ? title : null;
}

function mediaIdFromUrl(url: string): string | null {
  const direct = parseMediaIdFromUrl(url);
  if (direct) return direct;
  const asb = /\/asb\/([A-Za-z0-9_-]{6,})/.exec(url);
  if (asb?.[1]) return asb[1];
  if (!/flow-content\.google|googleusercontent\.com/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    const named = parsed.searchParams.get("name");
    if (named) return named;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = (segments[segments.length - 1] ?? "").replace(/\.[a-z0-9]{2,5}$/i, "");
    if (last.length >= 10) return last;
    const previous = segments[segments.length - 2] ?? "media";
    const combined = `${previous}-${last}`.replace(/[^a-z0-9_-]/gi, "");
    return combined.length >= 6 ? combined : null;
  } catch {
    return null;
  }
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function collectMediaUrls(): { url: string; mediaId: string; kind: MediaItem["kind"] }[] {
  const found = new Map<string, { url: string; mediaId: string; kind: MediaItem["kind"] }>();
  const add = (rawUrl: string | null, kind: MediaItem["kind"]) => {
    if (!rawUrl) return;
    if (rawUrl.startsWith("data:")) return;
    const isBlob = rawUrl.startsWith("blob:");
    const absolute = isBlob ? rawUrl : new URL(rawUrl, location.href).href;
    const mediaId = isBlob ? `blob-${hashString(absolute)}` : mediaIdFromUrl(absolute);
    if (!mediaId) return;
    if (!found.has(mediaId)) found.set(mediaId, { url: absolute, mediaId, kind });
  };

  deepAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.currentSrc || img.src;
    if (!src) return;
    if (img.naturalWidth > 0 && img.naturalWidth < 200) return;
    if (!/getMediaUrlRedirect|flow-content|googleusercontent|\/asb\//i.test(src)) return;
    add(src, "image");
  });
  deepAll<HTMLVideoElement>("video").forEach((video) => {
    add(video.currentSrc || video.src, "video");
    video.querySelectorAll<HTMLSourceElement>("source[src]").forEach((source) => add(source.src, "video"));
  });
  deepAll<HTMLElement>("[style*='background-image']").forEach((el) => {
    const match = /url\(["']?([^"')]+)["']?\)/.exec(el.style.backgroundImage || "");
    if (match?.[1]) add(match[1], "image");
  });

  return [...found.values()];
}

function deepFindMediaMeta(mediaId: string): { prompt: string | null; model: string | null; createdAt: string | null } {
  for (const response of [...state.responses].reverse()) {
    if (!response.body.includes(mediaId)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      continue;
    }
    const queue: unknown[] = [parsed];
    let guard = 0;
    while (queue.length > 0 && guard < 20_000) {
      guard += 1;
      const current = queue.shift();
      if (!current || typeof current !== "object") continue;
      const record = current as Record<string, unknown>;
      const values = Object.values(record);
      if (values.some((value) => value === mediaId)) {
        const prompt = pickString(record, ["prompt", "textPrompt", "userPrompt", "caption"]);
        const model = pickString(record, ["model", "modelName", "modelId", "imageModel"]);
        const createdAt = pickString(record, ["createTime", "createdAt", "timestamp", "generationTime"]);
        if (prompt || model || createdAt) return { prompt, model, createdAt };
      }
      for (const value of values) {
        if (value && typeof value === "object") queue.push(value);
      }
    }
  }
  return { prompt: null, model: null, createdAt: null };
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value.length < 4000) return value;
  }
  return null;
}

function scrapeMedia(): MediaItem[] {
  const base = collectMediaUrls();
  return base.map((item) => {
    const meta = deepFindMediaMeta(item.mediaId);
    return {
      mediaId: item.mediaId,
      kind: item.kind,
      url: item.url,
      thumbUrl: item.kind === "image" ? item.url : null,
      prompt: meta.prompt,
      model: meta.model,
      createdAt: meta.createdAt,
      projectId: parseProjectId(location.href)
    } satisfies MediaItem;
  });
}

function scrapeProjects(): ProjectInfo[] {
  return projectsFromCards(deepAll<Element>(PROJECT_CARD_SELECTOR), location.href);
}

function projectListScroller(card: Element): Element | null {
  let scroller = card.parentElement;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
    scroller = scroller.parentElement;
  }
  return scroller ?? document.scrollingElement;
}

async function collectProjects(limit: number): Promise<{
  projects: ProjectInfo[];
  href: string;
  cardCount: number;
  projectLinkCount: number;
}> {
  const collected = new Map<string, ProjectInfo>();
  const deadline = Date.now() + 12_000;
  const positions = new Map<Element, number>();
  let stable = 0;
  let previous = "";
  let cardCount = 0;
  let projectLinkCount = 0;
  let initialized = false;
  try {
    while (Date.now() < deadline) {
      const cards = deepAll<Element>(PROJECT_CARD_SELECTOR);
      if (!initialized && cards.length > 0) {
        initialized = true;
        const scroller = projectListScroller(cards[0]!);
        if (scroller) {
          positions.set(scroller, scroller.scrollTop);
          if (scroller.scrollTop > 0) {
            scroller.scrollTop = 0;
            await sleep(500);
            continue;
          }
        }
      }
      cardCount = Math.max(cardCount, cards.length);
      projectLinkCount = Math.max(projectLinkCount, deepAll<Element>('a[href*="/project/"]').length);
      mergeProjects(collected, projectsFromCards(cards, location.href));
      const projects = [...collected.values()];
      const signature = JSON.stringify(projects.map((project) => [project.projectId, project.name]));
      stable = signature === previous ? stable + 1 : 0;
      previous = signature;
      if (stable >= 2 && projects.length >= limit && projects.slice(0, limit).every((project) => project.name !== null)) break;
      if (stable >= 2 && cards.length > 0) {
        const scroller = projectListScroller(cards[0]!);
        if (scroller && scroller.scrollHeight > scroller.clientHeight) {
          if (!positions.has(scroller)) positions.set(scroller, scroller.scrollTop);
          const before = scroller.scrollTop;
          scroller.scrollTop += Math.max(1, Math.floor(scroller.clientHeight * 0.8));
          if (scroller.scrollTop !== before) stable = 0;
          else if (stable >= 4 && projects.every((project) => project.name !== null)) break;
        } else if (stable >= 4 && projects.every((project) => project.name !== null)) break;
      }
      await sleep(500);
    }
    return { projects: [...collected.values()], href: location.href, cardCount, projectLinkCount };
  } finally {
    for (const [element, scrollTop] of positions) element.scrollTop = scrollTop;
  }
}

function detectAspects(): string[] {
  const found = new Set<string>();
  const nodes = deepAll<HTMLElement>('button, [role="button"], [role="radio"], li, span');
  let checked = 0;
  for (const node of nodes) {
    if (checked > 4000) break;
    checked += 1;
    const text = elementText(node);
    if (!text || text.length > 12) continue;
    if (/^\d{1,2}:\d{1,2}$/.test(text) && isVisible(node)) found.add(text);
  }
  return found.size > 0 ? [...found] : [...DEFAULT_ASPECTS];
}

async function selectModel(name: string | undefined): Promise<string[]> {
  const warnings: string[] = [];
  if (!name) return warnings;
  const current = findModelButton();
  const currentText = current ? elementText(current) : "";
  if (currentText.toLowerCase().includes(name.toLowerCase())) return warnings;
  if (!current) {
    warnings.push(`Model selector not found; using the page default instead of "${name}"`);
    return warnings;
  }
  humanClick(current);
  await sleep(600);
  const option = Array.from(
    deepAll<HTMLElement>('[role="menuitem"], [role="option"], button, li')
  ).find((el) => isVisible(el) && elementText(el).toLowerCase().includes(name.toLowerCase()));
  if (!option) {
    warnings.push(`Model "${name}" not found in the model menu; using the page default`);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return warnings;
  }
  humanClick(option);
  await sleep(400);
  return warnings;
}

async function selectAspect(ratio: string | undefined): Promise<string[]> {
  const warnings: string[] = [];
  if (!ratio) return warnings;
  const candidates = Array.from(
    deepAll<HTMLElement>('button, [role="button"], [role="radio"], [role="option"]')
  );
  const chip = candidates.find(
    (el) => isVisible(el) && elementText(el).replace(/\s+/g, "") === ratio.replace(/\s+/g, "")
  );
  if (!chip) {
    warnings.push(`Aspect ratio "${ratio}" not found in the UI; using the page default`);
    return warnings;
  }
  humanClick(chip);
  await sleep(300);
  return warnings;
}

interface ComposerControl {
  tag: string;
  role: string;
  aria: string;
  title: string;
  text: string;
  cls: string;
  x: number;
  y: number;
}

function describeControl(el: HTMLElement): ComposerControl {
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role") ?? "",
    aria: el.getAttribute("aria-label") ?? "",
    title: el.getAttribute("title") ?? "",
    text: (elementText(el) || "").slice(0, 90),
    cls: (el.getAttribute("class") ?? "").slice(0, 90),
    x: Math.round(rect.x),
    y: Math.round(rect.y)
  };
}

function composerRoot(): HTMLElement | null {
  const box = findPromptBox();
  if (!box) return null;
  let root: HTMLElement = box;
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = root.parentElement;
    if (!parent) break;
    root = parent;
    const controls = root.querySelectorAll('button, [role="button"], [role="combobox"]');
    if (controls.length >= 3) break;
  }
  return root;
}

function visibleOverlayItems(): ComposerControl[] {
  const roots = deepAll<HTMLElement>(".cdk-overlay-container, .cdk-overlay-pane, mat-menu, mat-dialog-container");
  const source: ParentNode[] = roots.length > 0 ? roots : [document];
  const seen = new Set<HTMLElement>();
  const out: ComposerControl[] = [];
  for (const root of source) {
    for (const el of deepAll<HTMLElement>('[role="menuitem"], [role="option"], [role="radio"], button, li, mat-option', root)) {
      if (seen.has(el) || !isVisible(el)) continue;
      const text = elementText(el);
      if (!text || text.length > 90) continue;
      seen.add(el);
      out.push(describeControl(el));
    }
  }
  return out.slice(0, 60);
}

async function probeSettingsPanel(): Promise<unknown> {
  const trigger = settingsTrigger();
  if (!trigger) return { found: false, reason: "no settings trigger" };
  const root = await ensurePanel();
  if (!root) {
    closeSettings();
    return { found: false, reason: "panel did not open", trigger: describeControl(trigger) };
  }
  const items = deepAll<HTMLElement>("button, [role], li, span, div, mat-icon", root)
    .filter(isVisible)
    .filter((el) => {
      const text = elementText(el);
      return text.length > 0 && text.length <= 60;
    })
    .slice(0, 120)
    .map(describeControl);
  closeSettings();
  await sleep(300);
  return {
    found: true,
    trigger: describeControl(trigger),
    panelClass: (root?.getAttribute("class") ?? "").slice(0, 120),
    items
  };
}

async function probeControls(): Promise<unknown> {
  const root = composerRoot();
  const box = findPromptBox();
  if (!root || !box) return { found: false };
  const controls = deepAll<HTMLElement>('button, [role="button"], [role="combobox"], [role="radio"], mat-select', root)
    .filter(isVisible)
    .map(describeControl);

  const snapshot = new Set<Element>(deepAll<HTMLElement>("*"));
  const triggers = deepAll<HTMLElement>("button, [role='button']", root).filter((el) => {
    if (!isVisible(el) || isDisabled(el)) return false;
    const label = [elementText(el), el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? ""].join(" ");
    return /c\u00e0i \u0111\u1eb7t|settings|t\u00f9y ch\u1ecdn|tu\u1ef3 ch\u1ecdn|k\u00edch ho\u1ea1t/i.test(label);
  });

  const panels: { trigger: ComposerControl; appeared: ComposerControl[]; panelText: string }[] = [];
  for (const trigger of triggers.slice(0, 2)) {
    const before = new Set<Element>(deepAll<HTMLElement>("*"));
    humanClick(trigger);
    await sleep(1400);
    const appeared = deepAll<HTMLElement>("button, [role], li, span, div")
      .filter((el) => !before.has(el) && isVisible(el))
      .filter((el) => {
        const text = elementText(el);
        return text.length > 0 && text.length <= 60;
      })
      .slice(0, 80)
      .map(describeControl);
    const panelRoot = deepAll<HTMLElement>("[class*='settings'], [class*='Settings'], mat-bottom-sheet, mat-dialog-container, .cdk-overlay-pane")
      .filter(isVisible)
      .map((el) => ({ cls: (el.getAttribute("class") ?? "").slice(0, 120), text: elementText(el).slice(0, 300) }))
      .slice(0, 6);
    panels.push({ trigger: describeControl(trigger), appeared, panelText: JSON.stringify(panelRoot) });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await sleep(500);
  }
  snapshot.clear();
  return { found: true, box: describeControl(box), root: { tag: root.tagName.toLowerCase(), cls: (root.getAttribute("class") ?? "").slice(0, 90) }, controls, panels };
}


const SETTINGS_TRIGGER_RE = /c\u00e0i \u0111\u1eb7t|k\u00edch ho\u1ea1t|settings/i;

interface SettingsRequest {
  model?: string;
  aspectRatio?: string;
  count?: number;
}

interface SettingsState {
  text: string;
  model: string | null;
  aspectIcon: string | null;
  count: number | null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function settingsTrigger(): HTMLElement | null {
  const scope = composerRoot() ?? document;
  const buttons = deepAll<HTMLElement>('button, [role="button"]', scope).filter(
    (el) => isVisible(el) && !isDisabled(el)
  );
  const rank = (el: HTMLElement): number => {
    const cls = el.getAttribute("class") ?? "";
    const aria = el.getAttribute("aria-label") ?? "";
    const text = elementText(el);
    let score = 0;
    if (cls.includes("settings-trigger-button")) score += 4;
    if (SETTINGS_TRIGGER_RE.test(aria)) score += 2;
    if (text === "tune") score += 2;
    if (/\bx\d+\b|crop_/i.test(text)) score += 3;
    return score;
  };
  const ranked = buttons
    .map((el) => ({ el, score: rank(el) }))
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.el ?? null;
}

function readSettingsState(el: HTMLElement | null): SettingsState {
  const text = el ? elementText(el) : "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const countMatch = /\bx\s*(\d+)\b/i.exec(text);
  const aspectMatch = /crop_[a-z0-9_]+/i.exec(text);
  return {
    text: text.replace(/\s+/g, " ").trim(),
    model: lines[0] ?? null,
    aspectIcon: aspectMatch ? aspectMatch[0] : null,
    count: countMatch ? Number(countMatch[1]) : null
  };
}

function settingsPanel(): HTMLElement | null {
  return deepAll<HTMLElement>(".settings-content-overlay, .settings-content").find((el) => isVisible(el)) ?? null;
}

function closeSettings(): void {
  if (!settingsPanel()) return;
  const trigger = settingsTrigger();
  if (trigger) humanClick(trigger);
}

async function ensurePanel(): Promise<HTMLElement | null> {
  let panel = settingsPanel();
  if (panel) return panel;
  const trigger = settingsTrigger();
  if (!trigger) return null;
  humanClick(trigger);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(250);
    panel = settingsPanel();
    if (panel) return panel;
  }
  return null;
}

function toggleGroups(panel: HTMLElement): HTMLElement[] {
  return deepAll<HTMLElement>("mat-button-toggle-group", panel).filter(isVisible);
}

function togglesIn(group: HTMLElement): HTMLElement[] {
  return deepAll<HTMLElement>("mat-button-toggle", group).filter(isVisible);
}

function ratioPattern(ratio: string): RegExp {
  const [rawA, rawB] = ratio.split(":");
  const a = (rawA ?? "").trim();
  const b = (rawB ?? "").trim();
  if (!a || !b) return /$^/;
  return new RegExp("\\b" + a + "\\s*[:x\\/]\\s*" + b + "\\b", "i");
}

async function chooseToggle(
  group: HTMLElement,
  matcher: (el: HTMLElement) => boolean,
  label: string,
  warnings: string[]
): Promise<boolean> {
  const toggle = togglesIn(group).find(matcher);
  if (!toggle) {
    const available = togglesIn(group)
      .map((el) => elementText(el).replace(/\s+/g, " ").trim())
      .join(" | ");
    warnings.push("No " + label + " matched; available: " + (available || "none"));
    return false;
  }
  const button = toggle.querySelector<HTMLElement>('button[role="radio"]') ?? toggle;
  humanClick(button);
  await sleep(450);
  warnings.push("Selected " + label + ': "' + elementText(toggle).replace(/\s+/g, " ").trim().slice(0, 30) + '"');
  return true;
}

async function chooseModel(panel: HTMLElement, model: string, warnings: string[]): Promise<boolean> {
  const wanted = normalizeText(model);
  const menuTrigger = deepAll<HTMLElement>('button[aria-label], .model-select-trigger-content', panel).find(
    (el) => /nh\u00f3m m\u00f4 h\u00ecnh/i.test(el.getAttribute("aria-label") ?? "") || el.className.includes("model-select-trigger")
  );
  if (!menuTrigger) {
    warnings.push("Model selector not found");
    return false;
  }
  const current = normalizeText(elementText(menuTrigger));
  if (current.includes(wanted)) {
    warnings.push('Model already set: "' + elementText(menuTrigger).replace(/\s+/g, " ").trim().slice(0, 40) + '"');
    return true;
  }
  humanClick(menuTrigger);
  let items: HTMLElement[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(300);
    items = deepAll<HTMLElement>('button[role="menuitem"], .mat-mdc-menu-item, [role="menuitem"]').filter(
      (el) => isVisible(el) && !isDisabled(el)
    );
    if (items.length > 0) break;
  }
  const target = items.find((el) => normalizeText(elementText(el)).includes(wanted));
  if (!target) {
    const available = items
      .map((el) => elementText(el).replace(/\s+/g, " ").trim())
      .slice(0, 12)
      .join(" | ");
    warnings.push("No model matched; available: " + (available || "none"));
    document.body.click();
    await sleep(300);
    return false;
  }
  humanClick(target);
  await sleep(600);
  warnings.push('Selected model: "' + elementText(target).replace(/\s+/g, " ").trim().slice(0, 40) + '"');
  return true;
}

async function applySettings(request: SettingsRequest): Promise<string[]> {
  const warnings: string[] = [];
  const wantsModel = Boolean(request.model);
  const wantsAspect = Boolean(request.aspectRatio);
  const wantsCount = typeof request.count === "number" && request.count > 0;
  if (!wantsModel && !wantsAspect && !wantsCount) return warnings;

  const initial = readSettingsState(settingsTrigger());
  warnings.push("Settings before: " + (initial.text || "unknown"));

  const panel = await ensurePanel();
  if (!panel) {
    warnings.push("Settings panel did not open");
    return warnings;
  }

  if (wantsModel) await chooseModel(panel, request.model as string, warnings);

  if (wantsAspect) {
    const pattern = ratioPattern(request.aspectRatio as string);
    const group = toggleGroups(panel).find((el) => /\d+\s*:\s*\d+/.test(elementText(el)));
    if (!group) warnings.push("Aspect ratio control not found");
    else await chooseToggle(group, (el) => pattern.test(elementText(el)), "aspect " + request.aspectRatio, warnings);
  }

  if (wantsCount) {
    const target = "x" + request.count;
    const group = toggleGroups(panel).find((el) => /^x\d/i.test(normalizeText(elementText(el))));
    if (!group) warnings.push("Count control not found");
    else await chooseToggle(group, (el) => normalizeText(elementText(el)) === target, "count " + target, warnings);
  }

  closeSettings();
  await sleep(350);
  const final = readSettingsState(settingsTrigger());
  warnings.push("Settings after: " + (final.text || "unknown"));
  return warnings;
}

function modelsFromPage(): ModelOption[] {
  const models = new Map<string, ModelOption>();
  for (const model of DEFAULT_IMAGE_MODELS) models.set(model.name.toLowerCase(), { ...model, aspects: detectAspects() });

  for (const response of state.responses) {
    const matches = response.body.matchAll(/"(?:model|modelName|modelId)"\s*:\s*"([A-Za-z0-9 _.-]{3,60})"/g);
    for (const match of matches) {
      const raw = match[1];
      if (!raw || /^(GEM_PIX|NARWHAL|IMAGEN|VEO)/i.test(raw)) continue;
      const key = raw.toLowerCase();
      if (!models.has(key)) {
        models.set(key, { name: raw, kind: "image", aspects: detectAspects(), credits: null });
      }
    }
  }
  return [...models.values()];
}

// ---------------------------------------------------------------------------
// API replay
// ---------------------------------------------------------------------------

interface ReplayPlan {
  url?: string;
  promptPath?: string;
  countPath?: string;
  aspectPath?: string;
  action?: string;
  maxAgeMs?: number;
}

async function mintRecaptcha(action: string): Promise<string | null> {
  const grecaptcha = (window as unknown as {
    grecaptcha?: {
      enterprise?: { execute: (siteKey: string, opts: { action: string }) => Promise<string> };
      execute?: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }).grecaptcha;
  const siteKey = state.siteKeys[state.siteKeys.length - 1];
  if (!grecaptcha || !siteKey) return null;
  try {
    if (grecaptcha.enterprise?.execute) return await grecaptcha.enterprise.execute(siteKey, { action });
    if (grecaptcha.execute) return await grecaptcha.execute(siteKey, { action });
  } catch {
    return null;
  }
  return null;
}

async function apiGenerate(params: {
  prompt: string;
  count: number;
  aspectRatio?: string;
  plan?: ReplayPlan;
}): Promise<void> {
  const plan = params.plan;
  if (!plan?.promptPath) {
    throw Object.assign(new Error("No API replay plan captured yet"), { code: "E_UNSUPPORTED" });
  }
  const template = [...state.templates].reverse().find((item) => !plan.url || item.url.includes(plan.url));
  if (!template || !template.body) {
    throw Object.assign(new Error("No captured generate request template"), { code: "E_UNSUPPORTED" });
  }
  const maxAge = plan.maxAgeMs ?? 45 * 60 * 1000;
  if (!state.lastAuth || Date.now() - state.lastAuth.at > maxAge) {
    throw Object.assign(new Error("No fresh Authorization token captured from the page"), { code: "E_UNSUPPORTED" });
  }

  let body: unknown;
  try {
    body = JSON.parse(template.body);
  } catch {
    throw Object.assign(new Error("Captured request body is not JSON"), { code: "E_UNSUPPORTED" });
  }

  if (!setByPath(body, plan.promptPath, params.prompt)) {
    throw Object.assign(new Error(`Prompt path "${plan.promptPath}" no longer exists`), { code: "E_UI_DRIFT" });
  }
  if (plan.countPath) setByPath(body, plan.countPath, params.count);
  if (plan.aspectPath && params.aspectRatio) setByPath(body, plan.aspectPath, params.aspectRatio);

  const token = await mintRecaptcha(plan.action ?? "flow_image_generate");
  if (!token) {
    throw Object.assign(new Error("Could not mint a reCAPTCHA token; falling back to DOM"), { code: "E_UNSUPPORTED" });
  }
  setByPath(body, "recaptchaContext.token", token);
  setByPath(body, "recaptchaContext.action", plan.action ?? "flow_image_generate");

  const headers: Record<string, string> = { ...template.headers };
  headers["authorization"] = state.lastAuth.value;
  for (const key of Object.keys(headers)) {
    if (/^(host|content-length|cookie|origin|referer|sec-|accept-encoding)/i.test(key)) delete headers[key];
  }
  headers["content-type"] = "application/json";

  const response = await fetch(template.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include"
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw Object.assign(
      new Error(`Generate API returned ${response.status}: ${text.slice(0, 300)}`),
      { code: response.status === 429 ? "E_RATE_LIMITED" : "E_GENERATION_FAILED" }
    );
  }
  state.lastSubmitAt = Date.now();
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

interface MainRpcMessage {
  __mediaMcp: true;
  dir: "to-main";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

async function handleRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "ping":
      return { ready: true, href: location.href, hooksInstalled: state.hooksInstalled };
    case "focus-prompt": {
      const box = findPromptBox();
      if (!box) throw Object.assign(new Error("Prompt box not found on the page"), { code: "E_UI_DRIFT" });
      box.focus();
      if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
        box.value = "";
        box.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(box);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand("delete");
      }
      const rect = box.getBoundingClientRect();
      return {
        ok: true,
        rect: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      };
    }
    case "info":
      return {
        href: location.href,
        origin: location.origin,
        title: document.title,
        accountIndex: parseAccountIndex(location.href),
        projectId: parseProjectId(location.href),
        projectName: findProjectName(),
        email: findEmail(),
        ready: !!findPromptBox(),
        hooksInstalled: state.hooksInstalled
      };
    case "apply-settings":
      return {
        warnings: await applySettings({
          model: typeof params.model === "string" ? params.model : undefined,
          aspectRatio: typeof params.aspectRatio === "string" ? params.aspectRatio : undefined,
          count: typeof params.count === "number" ? params.count : undefined
        }),
        state: readSettingsState(settingsTrigger())
      };
    case "capture-stats":
      return {
        templates: state.templates.length,
        rpc: state.rpc.length,
        responses: state.responses.length,
        lastRpcAt: state.rpc[state.rpc.length - 1]?.at ?? null
      };
    case "models":
      return { models: modelsFromPage(), aspects: detectAspects() };
    case "projects":
      return collectProjects(typeof params.limit === "number" ? params.limit : 50);
    case "media":
      return { items: scrapeMedia(), pageUrl: location.href, projectId: parseProjectId(location.href) };
    case "fetch-as-dataurl": {
      const target = String(params.url ?? "");
      if (!target) throw Object.assign(new Error("url is required"), { code: "E_BAD_INPUT" });
      const response = await fetch(target);
      if (!response.ok) {
        throw Object.assign(new Error(`Media fetch failed with HTTP ${response.status}`), {
          code: "E_DOWNLOAD_FAILED"
        });
      }
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
        reader.readAsDataURL(blob);
      });
      return { dataUrl, mime: blob.type || "application/octet-stream", bytes: blob.size };
    }
    case "submit": {
      const prompt = String(params.prompt ?? "");
      if (!prompt) throw Object.assign(new Error("prompt is required"), { code: "E_BAD_INPUT" });
      const strategy = String(params.strategy ?? "auto");
      const count = Number(params.count ?? 1);
      const model = typeof params.model === "string" ? params.model : undefined;
      const aspectRatio = typeof params.aspectRatio === "string" ? params.aspectRatio : undefined;
      const plan = params.plan as ReplayPlan | undefined;

      const baselineMediaIds = scrapeMedia().map((item) => item.mediaId);
      const warnings: string[] = [];

      if (strategy === "api" || strategy === "auto") {
        try {
          await apiGenerate({ prompt, count, aspectRatio, plan });
          return {
            strategy: "api",
            submittedAt: new Date().toISOString(),
            baselineMediaIds,
            warnings,
            needsTrustedClick: false,
            projectName: findProjectName()
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (strategy === "api") throw error;
          warnings.push(`API replay unavailable: ${message}`);
        }
      }

      warnings.push(...(await applySettings({ model, aspectRatio, count })));

      const box = findPromptBox();
      if (!box) throw Object.assign(new Error("Prompt box not found on the page"), { code: "E_UI_DRIFT" });
      const boxDesc = [
        box.tagName.toLowerCase(),
        box.getAttribute("role") ?? "",
        box.getAttribute("aria-label") ? `label="${box.getAttribute("aria-label")}"` : "",
        (box as HTMLTextAreaElement).placeholder ? `placeholder="${(box as HTMLTextAreaElement).placeholder}"` : "",
        box.getAttribute("data-placeholder") ? `data-placeholder="${box.getAttribute("data-placeholder")}"` : ""
      ]
        .filter(Boolean)
        .join(" ");
      warnings.push(`Composer: <${boxDesc}>`);
      box.focus();
      setNativeValue(box, prompt);
      await sleep(350);

      const clicks = Math.max(1, Math.min(4, count));
      let rect: { x: number; y: number } | undefined;
      const button = findGenerateButton();
      if (button) {
        const native = button as HTMLButtonElement;
        warnings.push(
          `Submitting with button "${(button.getAttribute("aria-label") ?? "").trim()}" type=${native.type} form=${Boolean(native.form)}`
        );
      } else {
        warnings.push("No generate button matched; falling back to the Enter key");
      }

      for (let index = 0; index < clicks; index += 1) {
        if (button) {
          activateGenerateButton(button);
          rect = centerOf(button);
        } else {
          pressEnter(box);
        }
        await sleep(1600);

        if (promptValue(box).trim().length > 0) {
          warnings.push("The composer still holds the prompt after submit; trying the Enter key");
          pressEnter(box);
          await sleep(1200);
        } else if (index > 0) {
          warnings.push("Prompt was cleared after the first submit; extra copies were skipped");
          break;
        }
      }
      state.lastSubmitAt = Date.now();

      const deadline = Date.now() + 6000;
      let confirmed = false;
      while (Date.now() < deadline) {
        const latest = [...state.templates].reverse()[0];
        const latestAt = latest ? Date.parse(latest.capturedAt) : 0;
        if (latestAt > Date.now() - 6000) {
          confirmed = true;
          break;
        }
        if (document.querySelector('[aria-busy="true"], [data-loading="true"]')) {
          confirmed = true;
          break;
        }
        await sleep(400);
      }

      return {
        strategy: "dom",
        submittedAt: new Date().toISOString(),
        baselineMediaIds,
        warnings,
        needsTrustedClick: !confirmed,
        rect,
        projectName: findProjectName()
      };
    }
    case "create-project": {
      const pattern = NEW_PROJECT_PATTERN;
      const buttons = Array.from(deepAll<HTMLElement>('button, [role="button"], a')).filter(
        (el) => isVisible(el) && (pattern.test(elementText(el)) || elementText(el).trim() === "+")
      );
      const target = buttons[0];
      if (!target) throw Object.assign(new Error("New project button not found"), { code: "E_UI_DRIFT" });
      const before = location.href;
      humanClick(target);
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        if (location.href !== before && parseProjectId(location.href)) {
          return {
            projectId: parseProjectId(location.href),
            url: location.href,
            name: findProjectName()
          };
        }
        await sleep(300);
      }
      throw Object.assign(new Error("Project was not created in time"), { code: "E_TIMEOUT" });
    }
    case "rename-project": {
      const name = String(params.name ?? "").trim();
      if (!name) throw Object.assign(new Error("name is required"), { code: "E_BAD_INPUT" });
      const findTitleInput = (): HTMLElement | null => {
        const nodes = Array.from(
          deepAll<HTMLElement>('[contenteditable="true"], input[type="text"]')
        ).filter((el) => isVisible(el) && el.getBoundingClientRect().top < 220);
        const current = findProjectName();
        return (
          nodes.find((el) => current && elementText(el).trim() === current.trim()) ??
          nodes.find((el) => !/prompt|describe|mô tả/i.test(el.getAttribute("placeholder") ?? "")) ??
          null
        );
      };
      let input = findTitleInput();
      if (!input) {
        const heading = Array.from(
          deepAll<HTMLElement>("h1, button, [role=button]")
        ).find((el) => isVisible(el) && findProjectName() && elementText(el).trim() === findProjectName()!.trim());
        if (heading) {
          humanClick(heading);
          await sleep(700);
          input = findTitleInput();
        }
      }
      if (!input) return { renamed: false, name: findProjectName() };
      setNativeValue(input, name);
      await sleep(200);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      input.blur();
      await sleep(600);
      return { renamed: true, name };
    }
    case "capture":
      return {
        exportedAt: new Date().toISOString(),
        version: "0.1.0",
        accountIndex: parseAccountIndex(location.href),
        pageUrl: location.href,
        projectId: parseProjectId(location.href),
        apiHosts: state.apiHosts,
        recaptchaSiteKeys: state.siteKeys,
        templates: state.templates,
        rpc: state.rpc,
        capturedResponses: state.responses.slice(-10),
        lastAuthAt: state.lastAuth?.at ?? null,
        lastSubmitAt: state.lastSubmitAt
      };
    case "selftest": {
      const onProjectList = parseProjectId(location.href) === null;
      const projects = onProjectList ? scrapeProjects() : [];
      const cards = onProjectList ? deepAll<Element>(PROJECT_CARD_SELECTOR).length : 0;
      const checks = [
        {
          id: "project-list-names",
          ok: !onProjectList || (cards > 0 && projects.length > 0 && projects.every((project) => project.name !== null)),
          detail: onProjectList
            ? `cards=${cards} projects=${projects.length} named=${projects.filter((project) => project.name !== null).length}; empty or unloaded lists require verification`
            : "not applicable inside a project"
        },
        { id: "hooks", ok: state.hooksInstalled, detail: "fetch/XHR capture hooks installed" },
        { id: "prompt-box", ok: onProjectList || !!findPromptBox(), detail: onProjectList ? "not applicable on the project list" : "prompt input located" },
        { id: "generate-button", ok: onProjectList || !!findGenerateButton(), detail: onProjectList ? "not applicable on the project list" : "generate button located" },
        { id: "project-url", ok: onProjectList || !!parseProjectId(location.href), detail: onProjectList ? "not applicable on the project list" : `project id parsed from ${location.href}` },
        { id: "account-index", ok: parseAccountIndex(location.href) !== null, detail: "account index parsed from /u/N/" },
        {
          id: "auth-token",
          ok: !!state.lastAuth && Date.now() - state.lastAuth.at < 60 * 60 * 1000,
          detail: state.lastAuth ? `bearer token captured ${Math.round((Date.now() - state.lastAuth.at) / 1000)}s ago` : "no bearer token captured yet"
        },
        { id: "generate-template", ok: state.templates.length > 0, detail: `${state.templates.length} generate request template(s) captured` },
        { id: "recaptcha-sitekey", ok: state.siteKeys.length > 0, detail: `${state.siteKeys.length} reCAPTCHA site key(s) captured` },
        (() => {
          if (onProjectList) return { id: "media-dom", ok: true, detail: "not applicable on the project list" };
          const imgs = deepAll<HTMLImageElement>("img");
          const sources = imgs.map((img) => img.currentSrc || img.src).filter(Boolean);
          const mediaish = sources.filter((src) => /flow-content|googleusercontent|getMediaUrlRedirect/i.test(src));
          const sample = mediaish[0] ?? sources[0] ?? "none";
          return {
            id: "media-dom",
            ok: mediaish.length > 0,
            detail:
              `imgs=${imgs.length} withSrc=${sources.length} mediaish=${mediaish.length} sample=${sample.slice(0, 110)}` +
              ` | frame=${location.href.slice(0, 90)}` +
              ` | srcs=[${sources.slice(0, 4).map((s) => s.slice(0, 46)).join(" ; ")}]` +
              ` | iframes=${deepAll<HTMLIFrameElement>("iframe").length}` +
              ` canvas=${deepAll<HTMLCanvasElement>("canvas").length}` +
              ` editables=${deepAll<HTMLElement>('[contenteditable="true"], textarea').length}` +
              ` btns=${deepAll<HTMLElement>('button, [role="button"]').length}` +
              ` labels=[${deepAll<HTMLElement>('button, [role="button"]')
                .slice(0, 8)
                .map((el) => (el.getAttribute("aria-label") ?? elementText(el) ?? "").slice(0, 20))
                .join(" | ")}]`
          };
        })()
      ];
      return {
        settings: readSettingsState(settingsTrigger()),
        panel: onProjectList ? null : await probeSettingsPanel(),
        composer: onProjectList ? null : await probeControls(),
        ok: checks.filter((check) => check.id !== "generate-template" && check.id !== "auth-token" && check.id !== "recaptcha-sitekey").every((check) => check.ok),
        checks,
        captured: {
          generateTemplates: state.templates.length,
          apiHosts: state.apiHosts,
          recaptchaSiteKeys: state.siteKeys,
          lastGenerateAt: state.templates[state.templates.length - 1]?.capturedAt ?? null
        }
      };
    }
    default:
      throw Object.assign(new Error(`Unknown page method: ${method}`), { code: "E_BAD_INPUT" });
  }
}

function onWindowMessage(event: MessageEvent): void {
  if (event.source !== window) return;
  const message = event.data as MainRpcMessage | undefined;
  if (!message || message.__mediaMcp !== true || message.dir !== "to-main") return;

  const { id, method } = message;
  const params = (message.params ?? {}) as Record<string, unknown>;

  if (method === "ping") {
    postToIsolated({ __mediaMcp: true, dir: "to-isolated", event: "ready", at: Date.now() });
  }

  handleRpc(method, params)
    .then((result) => {
      postToIsolated({ __mediaMcp: true, dir: "to-main-res", id, ok: true, result });
    })
    .catch((error: unknown) => {
      const err = error as { code?: string; message?: string };
      postToIsolated({
        __mediaMcp: true,
        dir: "to-main-res",
        id,
        ok: false,
        error: {
          code: err.code ?? "E_INTERNAL",
          message: err.message ?? String(error)
        }
      });
    });
}

const mainScope = window as unknown as { __mediaMcpMainInstalled?: boolean };
if (!mainScope.__mediaMcpMainInstalled) {
  mainScope.__mediaMcpMainInstalled = true;
  installHooks();
}

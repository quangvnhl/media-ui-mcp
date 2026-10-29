export type MediaKind = "image" | "video" | "audio" | "unknown";

export interface AccountInfo {
  index: number;
  email: string | null;
  displayName: string | null;
  signedIn: boolean;
  url: string | null;
  tabId: number | null;
  active: boolean;
}

export interface ProjectInfo {
  projectId: string;
  name: string | null;
  url: string;
  accountIndex: number | null;
  updatedAt: string | null;
}

export interface MediaItem {
  mediaId: string;
  kind: MediaKind;
  url: string | null;
  thumbUrl: string | null;
  prompt: string | null;
  model: string | null;
  createdAt: string | null;
  projectId: string | null;
}

export interface ModelOption {
  name: string;
  kind: "image" | "video";
  aspects: string[];
  credits: number | null;
}

export interface Capabilities {
  apiReplay: boolean;
  domSubmit: boolean;
  recaptchaMint: boolean;
  trustedClicks: boolean;
  hooksInstalled: boolean;
}

export interface StatusResult {
  manifest?: { version: string; permissions: string[]; optionalPermissions: string[] };
  connected: boolean;
  protocolVersion: number;
  extensionVersion: string;
  tabId: number | null;
  url: string | null;
  accountIndex: number | null;
  email: string | null;
  projectId: string | null;
  pageReady: boolean;
  hooksInstalled: boolean;
  capabilities: Capabilities;
  downloadDir: string | null;
  downloadSubdir: string;
}

export interface GenerateAck {
  projectId: string;
  projectName: string | null;
  accountIndex: number | null;
  tabId: number;
  strategy: "api" | "dom";
  submittedAt: string;
  baselineMediaIds: string[];
  warnings: string[];
}

export interface GenerateResult extends GenerateAck {
  jobId: string;
  prompt: string;
  expectedCount: number;
}

export interface PollResult {
  projectId: string;
  items: MediaItem[];
  pageUrl: string;
  capturedAt: string;
}

export interface DownloadResult {
  mediaId: string;
  path: string;
  filename: string;
  bytes: number;
  mime: string;
  downloadId: number;
}

export interface SelftestCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface SelftestResult {
  ok: boolean;
  checks: SelftestCheck[];
  captured: {
    generateTemplates: number;
    apiHosts: string[];
    recaptchaSiteKeys: string[];
    lastGenerateAt: string | null;
  };
}

export interface DiscoveryExport {
  exportedAt: string;
  version: string;
  accountIndex: number | null;
  pageUrl: string;
  projectId: string | null;
  apiHosts: string[];
  recaptchaSiteKeys: string[];
  templates: CapturedRequestTemplate[];
  capturedResponses: CapturedResponse[];
}

export interface CapturedRequestTemplate {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  capturedAt: string;
}

export interface CapturedResponse {
  url: string;
  method: string;
  status: number;
  body: string;
  capturedAt: string;
  projectId: string | null;
}

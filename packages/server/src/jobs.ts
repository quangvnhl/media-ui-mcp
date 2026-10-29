import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MediaItem } from "@media-mcp/shared";
import type { Bridge } from "./bridge.js";
import { log } from "./log.js";

export type JobStatus = "submitted" | "generating" | "completed" | "failed" | "timeout";

export interface Job {
  id: string;
  projectId: string;
  projectName: string | null;
  accountIndex: number | null;
  prompt: string;
  expectedCount: number;
  strategy: "api" | "dom";
  status: JobStatus;
  tabId: number | null;
  baselineMediaIds: string[];
  mediaIds: string[];
  createdAt: string;
  submittedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: { code: string; message: string } | null;
}

export interface CreateJobInput {
  projectId: string;
  projectName?: string | null;
  accountIndex: number | null;
  prompt: string;
  expectedCount: number;
  strategy: "api" | "dom";
  tabId: number | null;
  baselineMediaIds: string[];
}

const ACTIVE: JobStatus[] = ["submitted", "generating"];
export const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_HISTORY = 200;

export class JobStore {
  private jobs = new Map<string, Job>();
  private persistTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly file: string,
    private readonly bridge: Bridge
  ) {
    this.load();
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.tick();
    }, 3000);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.flush();
  }

  create(input: CreateJobInput): Job {
    const now = new Date().toISOString();
    const job: Job = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      projectName: input.projectName ?? null,
      accountIndex: input.accountIndex,
      prompt: input.prompt,
      expectedCount: input.expectedCount,
      strategy: input.strategy,
      status: "submitted",
      tabId: input.tabId,
      baselineMediaIds: input.baselineMediaIds,
      mediaIds: [],
      createdAt: now,
      submittedAt: now,
      updatedAt: now,
      completedAt: null,
      error: null
    };
    this.jobs.set(job.id, job);
    this.schedulePersist();
    return job;
  }

  get(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  update(id: string, patch: Partial<Job>): Job | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.schedulePersist();
    return job;
  }

  list(limit = 20): Job[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  active(): Job[] {
    return [...this.jobs.values()].filter((job) => ACTIVE.includes(job.status));
  }

  async poll(job: Job): Promise<Job> {
    if (!ACTIVE.includes(job.status)) return job;
    if (!this.bridge.isConnected()) return job;

    let result: { items: MediaItem[] };
    try {
      result = await this.bridge.call<{ items: MediaItem[] }>(
        "media.poll",
        {
          projectId: job.projectId,
          accountIndex: job.accountIndex,
          baselineMediaIds: job.baselineMediaIds
        },
        45_000
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.debug("job poll failed", { jobId: job.id, message });
      return job;
    }

    const baseline = new Set(job.baselineMediaIds);
    const known = new Set(job.mediaIds);
    const fresh = result.items
      .filter((item) => !baseline.has(item.mediaId) && !known.has(item.mediaId))
      .map((item) => item.mediaId);

    if (fresh.length > 0) {
      const mediaIds = [...job.mediaIds, ...fresh];
      const done = mediaIds.length >= job.expectedCount;
      return this.update(job.id, {
        mediaIds,
        status: done ? "completed" : job.status === "submitted" ? "generating" : job.status,
        completedAt: done ? new Date().toISOString() : job.completedAt
      }) ?? job;
    }

    const age = Date.now() - new Date(job.submittedAt).getTime();
    if (age > JOB_TIMEOUT_MS) {
      return this.update(job.id, {
        status: "timeout",
        error: {
          code: "E_TIMEOUT",
          message: "No new media appeared in the project within the timeout window"
        }
      }) ?? job;
    }

    if (job.status === "submitted" && age > 4000) {
      return this.update(job.id, { status: "generating" }) ?? job;
    }
    return job;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const job of this.active()) {
        await this.poll(job);
      }
    } finally {
      this.ticking = false;
    }
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw) as { jobs?: Job[] };
      for (const job of parsed.jobs ?? []) {
        if (ACTIVE.includes(job.status)) {
          job.status = "failed";
          job.error = { code: "E_DISCONNECTED", message: "Server restarted while job was running" };
        }
        this.jobs.set(job.id, job);
      }
      this.trim();
    } catch {
      // no history yet
    }
  }

  private trim(): void {
    const all = this.list(MAX_HISTORY + 50);
    const keep = new Set(all.slice(0, MAX_HISTORY).map((job) => job.id));
    for (const id of this.jobs.keys()) {
      if (!keep.has(id) && !ACTIVE.includes(this.jobs.get(id)!.status)) this.jobs.delete(id);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flush();
    }, 400);
  }

  flush(): void {
    try {
      this.trim();
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const payload = { version: 1, jobs: this.list(MAX_HISTORY) };
      fs.writeFileSync(this.file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } catch (error) {
      log.warn("failed to persist jobs", { message: error instanceof Error ? error.message : String(error) });
    }
  }
}

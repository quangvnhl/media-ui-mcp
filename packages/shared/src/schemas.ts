import { z } from "zod";

const accountIndex = z.number().int().min(0).max(20);

export const emptyParams = z.object({}).strict();

export const accountsSelectParams = z
  .object({
    index: accountIndex.optional(),
    email: z.string().email().optional(),
    verify: z.boolean().optional()
  })
  .strict();

export const projectsListParams = z
  .object({
    accountIndex: accountIndex.nullable().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional()
  })
  .strict();

export const projectCreateParams = z
  .object({
    name: z.string().min(1).max(120).optional(),
    accountIndex: accountIndex.nullable().optional()
  })
  .strict();

export const projectOpenParams = z
  .object({
    projectId: z.string().min(1).max(200),
    accountIndex: accountIndex.nullable().optional(),
    focus: z.boolean().optional()
  })
  .strict();

export const projectMediaParams = z
  .object({
    projectId: z.string().min(1).max(200),
    accountIndex: accountIndex.nullable().optional(),
    refresh: z.boolean().optional()
  })
  .strict();

export const mediaPollParams = z
  .object({
    projectId: z.string().min(1).max(200),
    accountIndex: accountIndex.nullable().optional(),
    baselineMediaIds: z.array(z.string()).max(500).optional()
  })
  .strict();

export const mediaDownloadParams = z
  .object({
    mediaId: z.string().min(1).max(300),
    url: z.string().url().optional(),
    projectId: z.string().max(200).optional(),
    projectName: z.string().max(120).optional(),
    filename: z.string().max(180).optional(),
    subdir: z.string().max(180).optional(),
    destDir: z.string().max(500).optional()
  })
  .strict();

export const imageGenerateParams = z
  .object({
    prompt: z.string().min(1).max(8000),
    projectId: z.string().min(1).max(200).optional(),
    projectName: z.string().min(1).max(120).optional(),
    accountIndex: accountIndex.nullable().optional(),
    model: z.string().min(1).max(80).optional(),
    aspectRatio: z.string().max(12).optional(),
    count: z.number().int().min(1).max(4).optional(),
    strategy: z.enum(["auto", "api", "dom"]).optional(),
    timeoutMs: z.number().int().min(5000).max(600000).optional(),
    referenceImages: z.array(z.string().max(4096)).max(4).optional()
  })
  .strict();

export const modelsListParams = z
  .object({
    kind: z.enum(["image", "video"]).optional()
  })
  .strict();

export const configSetParams = z
  .object({
    downloadSubdir: z.string().max(180).optional(),
    defaultAccountIndex: accountIndex.nullable().optional(),
    allowSpend: z.boolean().optional()
  })
  .strict();

export const methodSchemas = {
  "accounts.select": accountsSelectParams,
  "projects.list": projectsListParams,
  "projects.create": projectCreateParams,
  "projects.open": projectOpenParams,
  "projects.media": projectMediaParams,
  "media.poll": mediaPollParams,
  "media.download": mediaDownloadParams,
  "image.generate": imageGenerateParams,
  "models.list": modelsListParams,
  "config.set": configSetParams
} as const;

export type MethodName = keyof typeof methodSchemas;

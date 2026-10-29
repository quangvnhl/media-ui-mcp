import type { ModelOption } from "./types.ts";

export const DEFAULT_IMAGE_MODELS: ModelOption[] = [
  {
    name: "Nano Banana Pro",
    kind: "image",
    aspects: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    credits: null
  },
  {
    name: "Nano Banana 2",
    kind: "image",
    aspects: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    credits: null
  },
  {
    name: "Nano Banana",
    kind: "image",
    aspects: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    credits: null
  },
  {
    name: "Imagen 4",
    kind: "image",
    aspects: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    credits: null
  }
];

export const DEFAULT_ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16"];

export const MODEL_BUTTON_PATTERN = /nano banana|imagen|\bveo\b|omni/i;

export const GENERATE_BUTTON_PATTERN = /^(generate|tạo|tạo ảnh|generate image)$/i;

export const NEW_PROJECT_PATTERN = /(new project|create project|start a project|dự án mới|tạo dự án)/i;

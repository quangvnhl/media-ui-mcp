import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectUrl,
  parseAccountIndex,
  parseMediaIdFromUrl,
  parseProjectId,
  sanitizeRelativeSubdir,
  sanitizeSegment,
  setByPath,
  getByPath,
  formatPath,
  extensionForMime
} from "@media-mcp/shared";
import { deriveReplayPlan } from "../../extension/src/lib/replay.ts";

test("parseAccountIndex understands Google multi-account paths", () => {
  assert.equal(parseAccountIndex("https://flow.google.com/u/1/project/abc"), 1);
  assert.equal(parseAccountIndex("https://flow.google.com/u/0/"), 0);
  assert.equal(parseAccountIndex("https://labs.google/fx/u/3/tools/flow/project/xyz"), 3);
  assert.equal(parseAccountIndex("https://flow.google.com/project/abc"), null);
  assert.equal(parseAccountIndex("https://flow.google.com/u/abc/"), null);
});

test("parseProjectId handles query strings and hashes", () => {
  assert.equal(parseProjectId("https://flow.google.com/u/1/project/abc-123?x=1"), "abc-123");
  assert.equal(parseProjectId("https://flow.google.com/u/1/project/abc-123#frag"), "abc-123");
  assert.equal(parseProjectId("https://flow.google.com/u/1/"), null);
});

test("buildProjectUrl keeps the account path", () => {
  assert.equal(buildProjectUrl(2, "p 1"), "https://flow.google.com/u/2/project/p%201");
  assert.equal(buildProjectUrl(null, "p1"), "https://flow.google.com/project/p1");
});

test("parseMediaIdFromUrl supports redirect and direct media urls", () => {
  assert.equal(
    parseMediaIdFromUrl("https://flow.google.com/u/1/media.getMediaUrlRedirect?name=abc%2Fdef"),
    "abc/def"
  );
  assert.equal(parseMediaIdFromUrl("https://flow-content.google/media/xyz-1"), "xyz-1");
  assert.equal(parseMediaIdFromUrl("https://flow.google.com/"), null);
});

test("sanitizeSegment strips dangerous characters", () => {
  assert.equal(sanitizeSegment('a<b>c:d"e/f\\g|h?i*j'), "a_b_c_d_e_f_g_h_i_j");
  assert.equal(sanitizeSegment("  ...  "), "untitled");
  assert.equal(sanitizeSegment("CON"), "_CON");
  assert.equal(sanitizeRelativeSubdir("../../etc/passwd", "Flow"), "etc/passwd");
  assert.equal(sanitizeRelativeSubdir("", "Flow"), "Flow");
});

test("extensionForMime maps the browser content types", () => {
  assert.equal(extensionForMime("image/jpeg", "image"), "jpg");
  assert.equal(extensionForMime("image/png", "image"), "png");
  assert.equal(extensionForMime("video/mp4", "video"), "mp4");
  assert.equal(extensionForMime("application/octet-stream", "image"), "jpg");
});

test("path helpers round-trip bracket paths", () => {
  const body = { requests: [{ prompt: "old", image: { count: 1 } }], recaptchaContext: { token: "t" } };
  assert.equal(getByPath(body, '["requests"][0]["prompt"]'), "old");
  assert.ok(setByPath(body, '["requests"][0]["prompt"]', "new"));
  assert.equal(body.requests[0].prompt, "new");
  assert.ok(setByPath(body, '["requests"][0]["image"]["count"]', 3));
  assert.equal(body.requests[0].image.count, 3);
  assert.ok(!setByPath(body, '["missing"]["prompt"]', "x"));
  assert.equal(formatPath(["requests", 0, "prompt"]), '["requests"][0]["prompt"]');
});

test("deriveReplayPlan finds the prompt path from two captures", () => {
  const make = (prompt: string, count: number, aspect: string) => ({
    url: "https://aisandbox-pa.googleapis.com/v1/projects/p1/flowMedia:batchGenerateImages",
    method: "POST",
    capturedAt: new Date().toISOString(),
    body: JSON.stringify({
      requests: [{ prompt, image: { count, aspectRatio: aspect } }],
      recaptchaContext: { token: "rotating-token" }
    })
  });

  const plan = deriveReplayPlan([make("a red fox in snow", 1, "1:1"), make("a blue whale in space", 2, "16:9")]);
  assert.ok(plan);
  assert.equal(plan.promptPath, '["requests"][0]["prompt"]');
  assert.equal(plan.countPath, '["requests"][0]["image"]["count"]');
  assert.equal(plan.aspectPath, '["requests"][0]["image"]["aspectRatio"]');
  assert.equal(plan.action, "flow_image_generate");
});

test("deriveReplayPlan returns null when there is nothing to learn from", () => {
  assert.equal(deriveReplayPlan([]), null);
  assert.equal(
    deriveReplayPlan([
      { url: "https://x/y", method: "POST", body: "{}", capturedAt: new Date().toISOString() }
    ]),
    null
  );
});

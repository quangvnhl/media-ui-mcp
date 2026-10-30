import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const files = [...new Set(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8"
}).split("\0").filter(Boolean))];

const rules = [
  ["machine-specific drive path", /\b[A-Za-z]:[\\/]/],
  ["personal home path", /\/(?:Users|home)\/(?!<|\$|\{)[A-Za-z0-9._-]+/],
  ["opaque UUID in an example", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["credential-like value", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9_-]{20,})/],
  ["private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/]
];

let findings = 0;
for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
  if (/(?:^|\/)(?:token|\.pairing-token|discovery-capture[^/]*\.json)$|(?:^|\/)\.env(?:\.|$)|\.(?:har|tgz)$/i.test(file) && !file.endsWith(".env.example")) {
    console.error(`${file}: sensitive artifact must not be published`);
    findings += 1;
    continue;
  }
  if (!/\.(?:md|json|jsonc|ts|tsx|js|mjs|html|ya?ml|txt)$/.test(file) && !/(?:^|\/)(?:LICENSE|\.gitignore)$/.test(file)) continue;
  const lines = fs.readFileSync(source, "utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const issues = rules.filter(([, pattern]) => pattern.test(line)).map(([label]) => label);
    const emails = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    if (emails.some((email) => !/@(?:example\.(?:com|org|net)|users\.noreply\.github\.com)$/i.test(email))) {
      issues.push("non-example email address");
    }
    if (file.endsWith(".md")) {
      if (/\/(?:u\/\d+\/)|authuser=\d+/.test(line)) issues.push("concrete account selection in documentation");
      if (/\b(?!2000-)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(line)) issues.push("non-synthetic session timestamp");
    }
    if (issues.length > 0) {
      console.error(`${file}:${index + 1}: ${issues.join(", ")}`);
      findings += issues.length;
    }
  }
}

if (findings > 0) {
  console.error(`Privacy check failed (${findings} finding(s)); matched values are intentionally omitted.`);
  process.exitCode = 1;
} else {
  console.log(`Privacy patterns checked across ${files.length} tracked/untracked non-ignored files. Review names and context manually; this does not scan Git history or published artifacts.`);
}

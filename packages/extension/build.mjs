import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { argv } from "node:process";

const watch = argv.includes("--watch");
const outdir = "dist/extension";

const options = {
  entryPoints: {
    background: "src/background.ts",
    "main-world": "src/content/main.ts",
    isolated: "src/content/isolated.ts",
    offscreen: "src/offscreen.ts",
    popup: "src/popup.ts"
  },
  outdir,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome116"],
  sourcemap: true,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production")
  }
};

function copyStatic() {
  fs.mkdirSync(outdir, { recursive: true });
  for (const file of ["manifest.json", "popup.html", "offscreen.html"]) {
    fs.copyFileSync(file, path.join(outdir, file));
  }
  fs.cpSync("icons", path.join(outdir, "icons"), { recursive: true });
}

copyStatic();

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  const watcher = fs.watch(".", { recursive: true }, (event, filename) => {
    if (filename && (filename.endsWith(".html") || filename.endsWith("manifest.json") || /^icons[\\/]/.test(filename))) copyStatic();
  });
  process.on("SIGINT", () => {
    watcher.close();
    process.exit(0);
  });
  console.log(`[build] watching extension → ${outdir}`);
} else {
  await build(options);
  copyStatic();
  console.log(`[build] extension → ${outdir}`);
}

import { context } from "esbuild";
import { argv } from "node:process";

const watch = argv.includes("--watch");

const external = [
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/*",
  "ws",
  "zod",
  "zod/*"
];

const options = {
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  external,
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info"
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("[build] watching server sources");
} else {
  const ctx = await context(options);
  await ctx.rebuild();
  await ctx.dispose();
}

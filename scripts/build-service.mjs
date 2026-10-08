#!/usr/bin/env node
// Bundles one service (run from its directory) into dist/ for `firebase deploy`.
// Why: Cloud Build runs a plain `npm install` on the uploaded source, which can't
// resolve pnpm's workspace:* links. So @mock/shared is inlined by esbuild, and
// dist/package.json lists only real npm runtime dependencies.
import { build } from "esbuild";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const runtime = pkg.dependencies ?? {};
fs.rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  external: Object.keys(runtime),
  logLevel: "warning",
});

fs.writeFileSync("dist/package.json", JSON.stringify({
  name: pkg.name.replace("@mock/", "mock-"),
  private: true,
  main: "index.js",
  engines: { node: "22" },
  dependencies: runtime,
}, null, 2));
console.log(`built ${pkg.name}`);

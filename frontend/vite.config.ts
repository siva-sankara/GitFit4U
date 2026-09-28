import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { securityHeaders } from "./build/securityHeaders.ts";

export default defineConfig(({ mode }) => ({
  plugins: [react(), {
    name: "getfit4u-deployment-headers",
    generateBundle(_options, bundle) {
      this.emitFile({ type: "asset", fileName: "_headers", source: securityHeaders(loadEnv(mode, process.cwd(), "VITE_")) });
      const worker = readFileSync(new URL("./public/sw.js", import.meta.url), "utf8");
      const offline = readFileSync(new URL("./public/offline.html", import.meta.url), "utf8");
      // Every changed application bundle offers an update, even when the worker's
      // behavior did not change. No private data or runtime responses are cached.
      const release = createHash("sha256").update(JSON.stringify(Object.keys(bundle).sort()) + worker + offline).digest("hex").slice(0, 16);
      this.emitFile({ type: "asset", fileName: "sw.js", source: worker.replace("getfit4u-offline-v3", `getfit4u-offline-${release}`) });
    },
  }],
  worker: { format: "es" },
  build: {
    sourcemap: false,
    target: "es2022",
  },
}));

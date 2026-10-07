import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { securityHeaders } from "./build/securityHeaders.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const target = env.VITE_DEV_API_TARGET || env.VITE_API_URL || env.VITE_API_BASE_URL || "http://localhost:5000";
  return {
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target, changeOrigin: true },
        "/socket.io": { target, changeOrigin: true, ws: true },
      },
    },
    plugins: [react(), {
      name: "getfit4u-deployment-headers",
      generateBundle(_options, bundle) {
        this.emitFile({
          type: "asset",
          fileName: "_headers",
          source: securityHeaders(env, mode === "production"),
        });
        const worker = readFileSync(new URL("./public/sw.js", import.meta.url), "utf8");
        const offline = readFileSync(new URL("./public/offline.html", import.meta.url), "utf8");
        const theme = readFileSync(new URL("./public/theme-init.js", import.meta.url), "utf8");
        // Every changed application bundle offers an update, even when the worker's
        // behavior did not change. No private data or runtime responses are cached.
        const release = createHash("sha256").update(JSON.stringify(Object.keys(bundle).sort()) + worker + offline + theme).digest("hex").slice(0, 16);
        this.emitFile({ type: "asset", fileName: "sw.js", source: worker.replace("getfit4u-offline-v3", `getfit4u-offline-${release}`) });
      },
    }],
    worker: { format: "es" },
    build: {
      sourcemap: false,
      target: "es2022",
    },
  };
});

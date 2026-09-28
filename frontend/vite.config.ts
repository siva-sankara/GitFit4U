import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { securityHeaders } from "./build/securityHeaders.ts";

export default defineConfig(({ mode }) => ({
  plugins: [react(), {
    name: "getfit4u-deployment-headers",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: securityHeaders(loadEnv(mode, process.cwd(), "VITE_")) });
    },
  }],
  worker: { format: "es" },
  build: {
    sourcemap: false,
    target: "es2022",
  },
}));

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const backend = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const compiler = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
const tempBase = realpathSync(tmpdir());
const prefix = "getfit4u-vercel-types-";
const temporary = mkdtempSync(join(tempBase, prefix));

try {
  const configPath = join(temporary, "tsconfig.json");
  // Vercel's native TypeScript compiler replaces include/files in a temp config.
  // Enable semantic checking so missing ambient declarations fail this check.
  writeFileSync(configPath, JSON.stringify({
    extends: join(backend, "tsconfig.json"),
    compilerOptions: {
      sourceMap: true,
      inlineSourceMap: false,
      inlineSources: true,
      declaration: false,
      declarationMap: false,
      emitDeclarationOnly: false,
      noEmit: false,
      outDir: join(temporary, "output"),
      rootDir: backend,
      incremental: false,
      composite: false,
      noCheck: false,
      rewriteRelativeImportExtensions: true,
    },
    files: [join(backend, "src/server.ts")],
    include: [],
    exclude: [],
  }));

  const result = spawnSync(process.execPath, [compiler, "--project", configPath], {
    cwd: backend,
    stdio: "inherit",
    timeout: 300_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    if (!existsSync(join(temporary, "output/src/server.js"))) {
      throw new Error("The Vercel-style build did not emit server.js");
    }
    console.log("Vercel-style TypeScript build passed with semantic checking enabled.");
  }
} finally {
  const actualPath = realpathSync(temporary);
  if (dirname(actualPath) !== tempBase || !actualPath.startsWith(join(tempBase, prefix))) {
    console.error("Refusing to remove an unexpected temporary directory");
    process.exitCode = 1;
  } else {
    rmSync(actualPath, { recursive: true, force: true });
  }
}

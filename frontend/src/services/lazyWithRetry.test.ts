import { describe, expect, it, vi } from "vitest";
import { isDynamicImportError, loadLazyModule } from "./lazyWithRetry";

function Screen() {
  return null;
}

describe("lazy route recovery", () => {
  it("retries a transient dynamic-import fetch failure", async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockRejectedValueOnce(new TypeError("Importing a module script failed"))
      .mockResolvedValue({ default: Screen });

    const loaded = await loadLazyModule("scanner-test", importer, {
      delays: [0, 0, 0],
      reloadOnFailure: false,
    });

    expect(loaded.default).toBe(Screen);
    expect(importer).toHaveBeenCalledTimes(3);
  });

  it("does not retry programming or render errors", async () => {
    const importer = vi.fn().mockRejectedValue(new Error("Export is missing"));

    await expect(
      loadLazyModule("broken-module", importer, {
        delays: [0, 0, 0],
        reloadOnFailure: false,
      }),
    ).rejects.toThrow("Export is missing");
    expect(importer).toHaveBeenCalledOnce();
  });

  it("recognizes common browser and bundler chunk errors", () => {
    expect(isDynamicImportError(new TypeError("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isDynamicImportError(new Error("ChunkLoadError: Loading chunk 18 failed"))).toBe(true);
    expect(isDynamicImportError(new Error("Database request failed"))).toBe(false);
  });
});

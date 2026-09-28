import { describe, expect, it } from "vitest";
import { validateMediaBytes, validateMediaName } from "./mediaValidation.js";
describe("media byte validation", () => {
  it("rejects HTML disguised as a logo", () => {
    expect(() =>
      validateMediaBytes(
        Buffer.from("<html><script>alert(1)</script></html>"),
        "image/png",
        true,
      ),
    ).toThrow("contents");
  });
  it("rejects mismatched extensions and document logos", () => {
    expect(() => validateMediaName("logo.svg", "image/png")).toThrow(
      "extension",
    );
    expect(() =>
      validateMediaBytes(Buffer.from("%PDF-1.7"), "application/pdf", true),
    ).toThrow("logos");
  });
  it("accepts PNG signatures and limits decompressed image dimensions", () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(512, 16);
    png.writeUInt32BE(512, 20);
    expect(() => validateMediaBytes(png, "image/png", true)).not.toThrow();
    png.writeUInt32BE(30000, 16);
    expect(() => validateMediaBytes(png, "image/png", true)).toThrow("pixels");
  });
});

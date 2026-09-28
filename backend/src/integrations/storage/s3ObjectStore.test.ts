import { expect, it, vi } from "vitest";
vi.mock("../../config/env.js", () => ({
  env: {
    OBJECT_STORAGE_ENDPOINT: "https://storage.example.test/bucket",
    OBJECT_STORAGE_ACCESS_KEY: "verification-access",
    OBJECT_STORAGE_SECRET_KEY: "verification-secret",
    OBJECT_STORAGE_REGION: "us-east-1",
  },
}));
import { presignedObjectUrl } from "./s3ObjectStore.js";

it("rejects all ASCII control characters in object keys before signing", () => {
  for (let code = 0; code < 32; code++) {
    expect(() => presignedObjectUrl("GET", `gym/image${String.fromCharCode(code)}.png`))
      .toThrow("Invalid storage object path.");
  }
});
it("preserves printable Unicode object names and rejects traversal", () => {
  expect(presignedObjectUrl("GET", "gym/fitness-好.png")).toContain("fitness-%E5%A5%BD.png");
  for (const key of ["/root.png", "gym/../private.png", "gym/./image.png", "gym//image.png", "gym\\image.png"]) {
    expect(() => presignedObjectUrl("GET", key)).toThrow("Invalid storage object path.");
  }
});

import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../config/env.js", () => ({
  env: {
    CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "test-key",
    CLOUDINARY_API_SECRET: "server-secret",
    CLOUDINARY_FOLDER: "getfit4u",
    MEDIA_STORAGE_PROVIDER: "cloudinary",
  },
}));
import { attachmentUrl, uploadCloudinary } from "./mediaStore.js";
afterEach(() => vi.unstubAllGlobals());
it("uploads confidential messages with authenticated delivery and returns only expiring access links", async () => {
  const fetchMock = vi.fn(async (_url, options) => {
    const body = options.body as FormData;
    expect(body.get("type")).toBe("authenticated");
    expect(body.get("public_id")).toBe("getfit4u/gym/user/message/asset");
    expect(body.get("signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(body.has("api_secret")).toBe(false);
    return {
      ok: true,
      json: async () => ({
        public_id: body.get("public_id"),
        bytes: 12,
        secure_url:
          "https://res.cloudinary.com/test-cloud/image/authenticated/asset.png",
        format: "png",
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  const result = await uploadCloudinary(
    {
      objectKey: "gym/user/message/asset.png",
      mimeType: "image/png",
      purpose: "MESSAGE",
      originalName: "asset.png",
      size: 12,
    },
    Buffer.alloc(12),
  );
  const url = new URL(
    attachmentUrl({ ...result, storageProvider: "cloudinary" }),
  );
  expect(url.pathname).toBe("/v1_1/test-cloud/image/download");
  expect(url.searchParams.get("type")).toBe("authenticated");
  expect(
    Number(url.searchParams.get("expires_at")) -
      Number(url.searchParams.get("timestamp")),
  ).toBe(300);
  expect(url.toString()).not.toContain("server-secret");
});
it("sanitizes provider failures instead of returning provider secrets or internals", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "server-secret leaked in upstream debug" }),
    })),
  );
  await expect(
    uploadCloudinary(
      {
        objectKey: "logo.png",
        mimeType: "image/png",
        purpose: "GYM_LOGO",
        originalName: "logo.png",
        size: 12,
      },
      Buffer.alloc(12),
    ),
  ).rejects.toMatchObject({
    code: "MEDIA_UPLOAD_FAILED",
    message:
      "Image storage rejected its server credentials. Contact the administrator.",
  });
});

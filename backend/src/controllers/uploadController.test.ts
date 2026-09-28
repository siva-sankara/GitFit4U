import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { Attachment, Advertisement, Invoice } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { MemberProfile } from "../models/Member.js";
import { Review, Trainer, ClassSession } from "../models/Engagement.js";
import { SocialPost, SocialStory } from "../models/Social.js";
import { Message } from "../models/Collaboration.js";

const media = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  access: vi.fn(),
}));
vi.mock("../integrations/storage/mediaStore.js", () => ({
  uploadMediaBytes: media.upload,
  deleteMedia: media.remove,
  attachmentUrl: () => "https://media.example.invalid/signed-image",
  verifyMediaConfiguration: vi.fn(),
  storageProvider: () => "s3",
}));
vi.mock("../integrations/storage/s3ObjectStore.js", () => ({
  presignedObjectUrl: () => "https://media.example.invalid/fixture",
}));
vi.mock("../services/mediaAccessService.js", () => ({
  assertTenantMediaAccess: media.access,
}));
vi.mock("../services/mediaValidation.js", () => ({
  validateMediaBytes: vi.fn(),
  validateMediaName: vi.fn(),
}));
import { bytes, complete, remove } from "./uploadController.js";

// A stateful fixture checks operation ordering and compare-and-set behavior.
// The isolated MongoDB verifier separately covers actual transaction conflicts.
let row: Record<string, any>;
let inTransaction = false;
let committed = false;
const databaseSession = {} as any;
const references = [
  Gym,
  User,
  MemberProfile,
  Review,
  Trainer,
  ClassSession,
  SocialPost,
  SocialStory,
  Advertisement,
  Invoice,
  Message,
];
const referenceSessions: ReturnType<typeof vi.fn>[] = [];
const staleSave = vi.fn(() => {
  throw new Error("Stale document save must not be used");
});
function doc(value: Record<string, any>) {
  const snapshot = { ...value };
  return { ...snapshot, save: staleSave, toObject: () => ({ ...snapshot }) };
}
function query<T>(value: T) {
  const result = Promise.resolve(value) as Promise<T> & {
    session: ReturnType<typeof vi.fn>;
  };
  result.session = vi.fn(() => result);
  return result;
}
function matches(filter: Record<string, any>) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "createdAt") return true;
    if (value && typeof value === "object") {
      if ("$in" in value) return value.$in.includes(row[key]);
      if ("$ne" in value) return row[key] !== value.$ne;
    }
    return value === null ? row[key] == null : row[key] === value;
  });
}
function update(operation: Record<string, any>) {
  Object.assign(row, operation.$set || operation);
  if (operation.$inc)
    for (const [key, value] of Object.entries(operation.$inc))
      row[key] = (row[key] || 0) + Number(value);
}
function request() {
  return {
    params: { id: "upload-one" },
    auth: { userId: "user-one" },
    body: Buffer.from("file"),
  } as any;
}
function response() {
  const value = { json: vi.fn(), status: vi.fn(), send: vi.fn() };
  value.status.mockReturnValue(value);
  return value as any;
}
beforeEach(() => {
  vi.resetAllMocks();
  row = {
    _id: "attachment-one",
    publicId: "upload-one",
    ownerId: "user-one",
    purpose: "REVIEW",
    objectKey: "users/user-one/review/one.png",
    storageProvider: "s3",
    mimeType: "image/png",
    size: 4,
    status: "READY",
    deletedAt: null,
    bindingVersion: 0,
  };
  inTransaction = false;
  committed = false;
  referenceSessions.length = 0;
  staleSave.mockImplementation(() => {
    throw new Error("Stale document save must not be used");
  });
  vi.spyOn(Attachment, "findOne").mockImplementation(
    (filter: any) => query(matches(filter) ? doc(row) : null) as any,
  );
  vi.spyOn(Attachment, "findOneAndUpdate").mockImplementation(
    (filter: any, operation: any) => {
      if (!matches(filter)) return query(null) as any;
      update(operation);
      return query(doc(row)) as any;
    },
  );
  vi.spyOn(Attachment, "updateOne").mockImplementation(
    (filter: any, operation: any) => {
      const matched = matches(filter);
      if (matched) update(operation);
      return query({ matchedCount: Number(matched) }) as any;
    },
  );
  vi.spyOn(Attachment, "exists").mockImplementation(
    (filter: any) => query(matches(filter) ? { _id: row._id } : null) as any,
  );
  for (const model of references) {
    vi.spyOn(model, "exists").mockImplementation(() => {
      const result = query(null);
      referenceSessions.push(result.session);
      return result as any;
    });
  }
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(
    async (callback: any) => {
      const snapshot = { ...row };
      inTransaction = true;
      try {
        const result = await callback(databaseSession);
        committed = true;
        return result;
      } catch (error) {
        row = snapshot;
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  );
  media.upload.mockResolvedValue({
    width: 32,
    thumbnailObjectKey: row.objectKey + ".thumb.webp",
  });
  media.remove.mockImplementation(async () => {
    expect(inTransaction).toBe(false);
    expect(committed).toBe(true);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected external request");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("upload lifecycle concurrency", () => {
  it("rejects deletion while byte upload is in progress, then conditionally completes", async () => {
    row.status = "PENDING";
    let release!: (value: object) => void;
    media.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const upload = bytes(request(), response());
    await vi.waitFor(() => expect(media.upload).toHaveBeenCalledOnce());
    expect(row.status).toBe("UPLOADED");
    await expect(remove(request(), response())).rejects.toMatchObject({
      statusCode: 409,
      code: "UPLOAD_IN_PROGRESS",
    });
    expect(media.remove).not.toHaveBeenCalled();
    release({ width: 32 });
    await upload;
    expect(row.status).toBe("READY");
    expect(row.deletedAt).toBeNull();
    expect(staleSave).not.toHaveBeenCalled();
  });

  it("does not upload bytes when deletion wins before the upload claim", async () => {
    row.status = "PENDING";
    media.access.mockImplementationOnce(async () => {
      await remove(request(), response());
    });
    await expect(bytes(request(), response())).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(row.status).toBe("DELETED");
    expect(media.upload).not.toHaveBeenCalled();
  });

  it("does not resurrect a changed attachment after storage finishes", async () => {
    row.status = "PENDING";
    media.upload.mockImplementation(async () => {
      row.status = "DELETING";
      return {};
    });
    await expect(bytes(request(), response())).rejects.toMatchObject({
      code: "UPLOAD_STATE_CHANGED",
    });
    expect(row.status).toBe("DELETING");
    expect(staleSave).not.toHaveBeenCalled();
  });

  it("releases only its own UPLOADED claim after an upload provider failure", async () => {
    row.status = "PENDING";
    media.upload.mockRejectedValue(new Error("storage unavailable"));
    await expect(bytes(request(), response())).rejects.toThrow(
      "storage unavailable",
    );
    expect(row.status).toBe("PENDING");
    expect(row.deletedAt).toBeNull();
    expect(row.thumbnailObjectKey).toBe(row.objectKey + ".thumb.webp");
    await remove(request(), response());
    expect(media.remove).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailObjectKey: row.objectKey + ".thumb.webp",
      }),
    );
  });

  it.each(references.map((model) => [model.modelName, model] as const))(
    "rolls back deletion when referenced by %s",
    async (_name, model) => {
      vi.mocked(model.exists).mockImplementation(
        () => query({ _id: "reference" }) as any,
      );
      await expect(remove(request(), response())).rejects.toMatchObject({
        statusCode: 409,
        code: "MEDIA_IN_USE",
      });
      expect(row.status).toBe("READY");
      expect(row.bindingVersion).toBe(0);
      expect(media.remove).not.toHaveBeenCalled();
    },
  );

  it("checks every reference in the deletion transaction before calling storage", async () => {
    const res = response();
    await remove(request(), res);
    expect(row.status).toBe("DELETED");
    expect(referenceSessions).toHaveLength(references.length);
    for (const session of referenceSessions)
      expect(session).toHaveBeenCalledWith(databaseSession);
    expect(Message.exists).toHaveBeenCalledWith({
      deletedAt: null,
      "attachments.key": { $in: [row.publicId, row.objectKey] },
    });
    expect(media.remove).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("keeps a failed storage deletion tombstoned and permits same-owner retry", async () => {
    media.remove.mockRejectedValueOnce(
      new Error("provider temporarily unavailable"),
    );
    await expect(remove(request(), response())).rejects.toThrow(
      "provider temporarily unavailable",
    );
    expect(row.status).toBe("DELETING");
    expect(row.deletedAt).toBeNull();
    await remove(request(), response());
    expect(row.status).toBe("DELETED");
    expect(media.remove).toHaveBeenCalledTimes(2);
    expect(staleSave).not.toHaveBeenCalled();
  });

  it("does not permit another account to retry a deletion", async () => {
    row.status = "DELETING";
    const req = request();
    req.auth.userId = "other-user";
    await expect(remove(req, response())).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(media.remove).not.toHaveBeenCalled();
  });

  it("does not resurrect a legacy PENDING completion after concurrent deletion", async () => {
    row.status = "PENDING";
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "content-length": "4", "content-type": "image/png" },
      }),
    );
    fetchMock.mockImplementationOnce(async () => {
      await remove(request(), response());
      return new Response("file", { status: 200 });
    });
    await expect(
      complete({ ...request(), body: {} }, response()),
    ).rejects.toMatchObject({ statusCode: 409, code: "UPLOAD_STATE_CHANGED" });
    expect(row.status).toBe("DELETED");
    expect(staleSave).not.toHaveBeenCalled();
  });

  it("returns READY completion without contacting storage and excludes deleted records", async () => {
    const res = response();
    await complete({ ...request(), body: {} }, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(fetch).not.toHaveBeenCalled();
    row.deletedAt = new Date();
    await expect(
      complete({ ...request(), body: {} }, response()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

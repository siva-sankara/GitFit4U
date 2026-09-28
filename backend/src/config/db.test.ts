import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: { readyState: 0 },
  connect: vi.fn(),
  disconnect: vi.fn(),
  set: vi.fn(),
}));
vi.mock("mongoose", () => ({ default: mocks }));
vi.mock("./env.js", () => ({
  env: { MONGO_URI: "mongodb://localhost:27017/test", NODE_ENV: "production" },
}));
import { connectDatabase } from "./db.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connection.readyState = 0;
});

describe("database connection reuse", () => {
  it("reuses an established connection", async () => {
    mocks.connection.readyState = 1;
    await connectDatabase();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("shares a pending connection across concurrent requests", async () => {
    let connected!: () => void;
    mocks.connect.mockReturnValue(new Promise<void>((resolve) => { connected = resolve; }));
    const first = connectDatabase();
    const second = connectDatabase();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledWith("mongodb://localhost:27017/test", {
      autoIndex: false,
      serverSelectionTimeoutMS: 10_000,
    });
    mocks.connection.readyState = 1;
    connected();
    await Promise.all([first, second]);
  });

  it("retries after a failed connection attempt", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("Connection failed"));
    await expect(connectDatabase()).rejects.toThrow("Connection failed");
    mocks.connect.mockResolvedValueOnce(undefined);
    await connectDatabase();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it("creates a new connection after the previous one closes", async () => {
    mocks.connect.mockResolvedValue(undefined);
    await connectDatabase();
    mocks.connection.readyState = 1;
    await connectDatabase();
    expect(mocks.connect).toHaveBeenCalledOnce();
    mocks.connection.readyState = 0;
    await connectDatabase();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });
});

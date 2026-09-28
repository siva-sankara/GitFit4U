import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const marker = { insertOne: vi.fn(), findOne: vi.fn() };
  const collections = vi.fn();
  const db = { databaseName: "", listCollections: vi.fn(() => ({ toArray: collections })), collection: vi.fn(() => marker), dropDatabase: vi.fn() };
  const model = { createCollection: vi.fn(), createIndexes: vi.fn() };
  return { marker, collections, db, model, connection: { readyState: 1, db } };
});
vi.mock("mongoose", () => ({ default: { connection: mocks.connection, models: { Fixture: mocks.model } } }));
import { isolatedScriptDatabase } from "./isolatedScriptDatabase.js";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.readyState = 1;
  mocks.collections.mockResolvedValue([]);
  mocks.marker.insertOne.mockResolvedValue({ acknowledged: true });
  mocks.marker.findOne.mockResolvedValue({ verified: true });
  mocks.model.createCollection.mockResolvedValue({});
  mocks.model.createIndexes.mockResolvedValue([]);
  mocks.db.dropDatabase.mockResolvedValue(true);
});
function fixture() {
  const database = isolatedScriptDatabase("gfi");
  mocks.db.databaseName = database.databaseName;
  return database;
}
it("generates unique Atlas-compatible UUID database names", () => {
  const first = fixture(), second = isolatedScriptDatabase("gfi");
  expect(first.databaseName).toMatch(/^gfi_[a-f0-9]{32}$/);
  expect(first.databaseName.length).toBe(36);
  expect(first.databaseName).not.toBe(second.databaseName);
});
it("refuses a different connected database before checking or writing anything", async () => {
  const database = fixture();
  mocks.db.databaseName = "existing-application";
  await expect(database.initialize()).rejects.toThrow("different database");
  expect(mocks.db.listCollections).not.toHaveBeenCalled();
  expect(mocks.marker.insertOne).not.toHaveBeenCalled();
  expect(await database.cleanup()).toBe(false);
  expect(mocks.db.dropDatabase).not.toHaveBeenCalled();
});
it("refuses a nonempty database and never claims or removes it", async () => {
  const database = fixture();
  mocks.collections.mockResolvedValue([{ name: "users" }]);
  await expect(database.initialize()).rejects.toThrow("nonempty database");
  expect(mocks.marker.insertOne).not.toHaveBeenCalled();
  expect(mocks.model.createCollection).not.toHaveBeenCalled();
  expect(await database.cleanup()).toBe(false);
  expect(mocks.db.dropDatabase).not.toHaveBeenCalled();
});
it("claims the empty database before model writes and verifies its exact marker before cleanup", async () => {
  const database = fixture();
  await database.initialize();
  const marker = mocks.marker.insertOne.mock.calls[0][0];
  expect(marker).toMatchObject({ databaseName: database.databaseName, _id: expect.any(String) });
  expect(mocks.marker.insertOne.mock.invocationCallOrder[0]).toBeLessThan(mocks.model.createCollection.mock.invocationCallOrder[0]);
  expect(mocks.model.createIndexes).toHaveBeenCalledOnce();
  expect(await database.cleanup()).toBe(true);
  expect(mocks.marker.findOne).toHaveBeenCalledWith({ _id: marker._id, databaseName: database.databaseName });
  expect(mocks.db.dropDatabase).toHaveBeenCalledOnce();
  expect(await database.cleanup()).toBe(false);
});
it("refuses cleanup when this run's ownership marker is absent", async () => {
  const database = fixture();
  await database.initialize();
  mocks.marker.findOne.mockResolvedValue(null);
  await expect(database.cleanup()).rejects.toThrow("ownership marker");
  expect(mocks.db.dropDatabase).not.toHaveBeenCalled();
});
it("refuses cleanup if the connected database changed after setup", async () => {
  const database = fixture();
  await database.initialize();
  mocks.db.databaseName = "existing-application";
  await expect(database.cleanup()).rejects.toThrow("different database");
  expect(mocks.db.dropDatabase).not.toHaveBeenCalled();
});

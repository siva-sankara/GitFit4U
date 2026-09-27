import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

/** Test-script database ownership; never derives a cleanup target from MONGO_URI. */
export function isolatedScriptDatabase(prefix: "gfr" | "gfi" | "gfg" | "gfp") {
  assert.ok(["gfr", "gfi", "gfg", "gfp"].includes(prefix));
  // 36 bytes, below Atlas's 38-byte database-name limit.
  const databaseName = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const ownershipToken = randomUUID();
  const allowedName = new RegExp(`^${prefix}_[a-f0-9]{32}$`);
  let owned = false;
  function checkedDatabase() {
    assert.match(databaseName, allowedName);
    assert.equal(mongoose.connection.readyState, 1, "Test database is not connected");
    const database = mongoose.connection.db;
    assert.ok(database, "Test database handle is unavailable");
    assert.equal(database.databaseName, databaseName, "Refusing access to a different database");
    return database;
  }
  return {
    databaseName,
    async initialize() {
      assert.equal(owned, false, "This test database has already been claimed");
      const database = checkedDatabase();
      const collections = await database.listCollections({}, { nameOnly: true }).toArray();
      assert.equal(collections.length, 0, "Refusing to write fixtures into a nonempty database");
      await database.collection("__getfit4u_test_owner").insertOne({
        _id: ownershipToken as any,
        databaseName,
        createdAt: new Date(),
      });
      owned = true;
      // Connect with autoCreate/autoIndex disabled so no model can write before
      // the emptiness check and marker. Build required test indexes only now.
      await Promise.all(Object.values(mongoose.models).map(async (model) => {
        await model.createCollection();
        await model.createIndexes();
      }));
    },
    async cleanup() {
      if (!owned) return false;
      const database = checkedDatabase();
      const marker = await database.collection("__getfit4u_test_owner").findOne({
        _id: ownershipToken as any,
        databaseName,
      });
      assert.ok(marker, "Refusing cleanup without this run's ownership marker");
      await database.dropDatabase();
      owned = false;
      return true;
    },
  };
}

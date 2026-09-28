import fs from "node:fs";
import dns from "node:dns/promises";
import dotenv from "dotenv";
import mongoose from "mongoose";
const config = { ...dotenv.parse(fs.readFileSync(".env")), ...process.env };
const uri = config.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI is not configured.");
  process.exitCode = 1;
} else {
  const host = new URL(uri).hostname;
  console.log(
    JSON.stringify({
      configured: true,
      scheme: uri.split(":")[0],
      hostname: host,
    }),
  );
  try {
    if (uri.startsWith("mongodb+srv:"))
      console.log(
        JSON.stringify({
          srvRecords: (await dns.resolveSrv("_mongodb._tcp." + host)).length,
        }),
      );
    await mongoose.connect(uri, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 8000,
    });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    console.log(
      JSON.stringify({
        connected: true,
        replicaSet: Boolean(hello.setName),
        supportsTransactions: Boolean(
          hello.setName || hello.msg === "isdbgrid",
        ),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        connected: false,
        code: error.code,
        name: error.name,
        topology: error.reason?.type,
      }),
    );
    console.error(
      "Check cluster availability, DNS SRV resolution, the Atlas IP access list, and credentials. For blocked SRV DNS use the Atlas-provided standard connection string; do not invent hostnames or disable TLS.",
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

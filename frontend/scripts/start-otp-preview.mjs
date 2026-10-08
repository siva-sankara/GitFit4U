import { createServer } from "vite";

// Explicit testing command; ordinary dev/build configuration is unchanged.
process.env.VITE_DEV_API_TARGET = "http://127.0.0.1:5001";
const server = await createServer({ mode: "development", server: { host: "127.0.0.1" } });
await server.listen();
server.printUrls();

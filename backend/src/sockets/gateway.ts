import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../services/tokenService.js";
import { Session } from "../models/Auth.js";
import { Conversation } from "../models/Collaboration.js";

export function createRealtimeGateway(server: HttpServer) {
  const io = new Server(server, { cors: { origin: env.CLIENT_ORIGIN.split(",").map(v => v.trim()), credentials: true }, transports: ["websocket", "polling"] });
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace(/^Bearer /, "");
      if (!raw) throw new Error("Authentication required");
      const claims = verifyAccessToken(raw); const session = await Session.findOne({ publicId: claims.sid, userId: claims.sub, revokedAt: null });
      if (!session || session.expiresAt <= new Date()) throw new Error("Session expired");
      socket.data.userId = claims.sub; socket.join(`user:${claims.sub}`); next();
    } catch { next(new Error("Unauthorized")); }
  });
  io.on("connection", socket => {
    socket.on("conversation.join", async (publicId: string, acknowledge?: (value: { ok: boolean }) => void) => {
      const allowed = await Conversation.exists({ publicId, participants: socket.data.userId });
      if (allowed) socket.join(`conversation:${publicId}`); acknowledge?.({ ok: Boolean(allowed) });
    });
    socket.on("typing", async ({ conversationId, active }: { conversationId: string; active: boolean }) => {
      const allowed = await Conversation.exists({ publicId: conversationId, participants: socket.data.userId });
      if (allowed) socket.to(`conversation:${conversationId}`).emit("typing", { conversationId, userId: socket.data.userId, active: Boolean(active) });
    });
  });
  return io;
}

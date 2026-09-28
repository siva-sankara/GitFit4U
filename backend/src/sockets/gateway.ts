import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../services/tokenService.js";
import { Session, RoleAssignment } from "../models/Auth.js";
import { User } from "../models/User.js";
import { authorizedConversation } from "../controllers/messagingController.js";

async function authenticate(socket: Socket) {
  const claims = verifyAccessToken(socket.data.token);
  const [session, user] = await Promise.all([
    Session.findOne({
      publicId: claims.sid,
      userId: claims.sub,
      revokedAt: null,
    }),
    User.findById(claims.sub),
  ]);
  if (
    !session ||
    session.expiresAt <= new Date() ||
    !user ||
    user.status !== "ACTIVE" ||
    !user.roles.includes(session.activeRole)
  )
    throw new Error("Unauthorized");
  if (
    ["GYM_OWNER", "GYM_STAFF", "TRAINER"].includes(session.activeRole) &&
    !(await RoleAssignment.exists({
      userId: claims.sub,
      gymId: session.activeGymId,
      role: session.activeRole,
      status: "ACTIVE",
    }))
  )
    throw new Error("Unauthorized");
  return {
    userId: claims.sub,
    role: session.activeRole,
    gymId: session.activeGymId ? String(session.activeGymId) : undefined,
    permissions: [],
    sessionId: session.publicId,
  };
}
export function createRealtimeGateway(server: HttpServer) {
  const io = new Server(server, {
    cors: {
      origin: env.CLIENT_ORIGIN.split(",").map((value) => value.trim()),
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });
  io.use(async (socket, next) => {
    try {
      socket.data.token =
        socket.handshake.auth?.token ||
        socket.handshake.headers.authorization?.replace(/^Bearer /, "");
      const auth = await authenticate(socket);
      socket.data.userId = auth.userId;
      socket.join(`user:${auth.userId}`);
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    // Revalidate connected sessions; access-token expiry and role revocation end room access.
    const timer = setInterval(() => {
      void authenticate(socket).catch(() => socket.disconnect(true));
    }, 15000);
    timer.unref();
    socket.on("disconnect", () => clearInterval(timer));
    socket.on(
      "conversation.join",
      async (
        publicId: unknown,
        acknowledge?: (value: { ok: boolean }) => void,
      ) => {
        try {
          if (typeof publicId !== "string" || publicId.length > 120)
            throw new Error("Invalid conversation");
          await authorizedConversation(publicId, await authenticate(socket));
          await socket.join(`conversation:${publicId}`);
          if (typeof acknowledge === "function") acknowledge({ ok: true });
        } catch {
          if (typeof acknowledge === "function") acknowledge({ ok: false });
        }
      },
    );
    socket.on("conversation.leave", (publicId: unknown) => {
      if (typeof publicId === "string")
        void socket.leave(`conversation:${publicId}`);
    });
    let lastTyping = 0;
    socket.on("typing", async (payload: unknown) => {
      try {
        if (
          !payload ||
          typeof payload !== "object" ||
          Date.now() - lastTyping < 800
        )
          return;
        const { conversationId, active } = payload as {
          conversationId?: unknown;
          active?: unknown;
        };
        if (typeof conversationId !== "string" || conversationId.length > 120)
          return;
        lastTyping = Date.now();
        const auth = await authenticate(socket);
        await authorizedConversation(conversationId, auth);
        socket.to(`conversation:${conversationId}`).emit("typing", {
          conversationId,
          userId: auth.userId,
          active: Boolean(active),
        });
      } catch {
        socket.emit("operation.error", {
          message: "Conversation access is unavailable.",
        });
      }
    });
  });
  return io;
}

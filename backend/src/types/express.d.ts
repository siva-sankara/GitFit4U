import type { Role, Permission } from "../constants/domain.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: Role;
        gymId?: string;
        permissions: Permission[];
        sessionId: string;
      };
      requestId?: string;
      idempotencyKey?: string;
    }
  }
}

export {};

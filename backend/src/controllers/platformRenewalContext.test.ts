import { expect, it } from "vitest";
import { createPlatformQuote } from "./checkoutController.js";
it("rejects a renewal whose intended gym no longer matches the authenticated context before any database work", async () => {
  await expect(createPlatformQuote({ auth: { role: "GYM_OWNER", gymId: "507f1f77bcf86cd799439011", userId: "owner" }, body: { renewal: true, planId: "507f1f77bcf86cd799439013", expectedGymId: "507f1f77bcf86cd799439012" } } as any, {} as any)).rejects.toMatchObject({ statusCode: 409, code: "GYM_CONTEXT_CHANGED" });
});

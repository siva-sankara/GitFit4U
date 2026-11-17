import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseWhatsAppInvite, detectedWhatsAppLinks } from "./whatsappInvite.js";
it("keeps browser and server rules identical", () => {
  expect(readFileSync(new URL("../../../frontend/src/services/whatsappInvite.ts", import.meta.url), "utf8")).toBe(readFileSync(new URL("./whatsappInvite.ts", import.meta.url), "utf8"));
});
it.each([
  ["  \"https://chat.whatsapp.com/Ab_C-9/?mode=ac_t&app_absent=0\" ", "https://chat.whatsapp.com/Ab_C-9"],
  ["https://www.whatsapp.com/channel/0029Ab/?utm_source=share", "https://whatsapp.com/channel/0029Ab"],
  ["<https://chat.whatsapp.com/A>", "https://chat.whatsapp.com/A"],
])("normalizes presentation wrappers/share parameters and preserves identity: %s", (input, url) => expect(parseWhatsAppInvite(input).url).toBe(url));
it("requires explicit selection of URLs in share text", () => {
  const text = "Join here: https://chat.whatsapp.com/First or https://whatsapp.com/channel/Second";
  expect(parseWhatsAppInvite(text).error).toBeTruthy();
  expect(detectedWhatsAppLinks(text)).toHaveLength(2);
});
it.each(["https://wa.me/919999999999", "https://chat.whatsapp.com:443/A", "https://chat.whatsapp.com/A?redirect=x", "https://chat.whatsapp.com/%41", "https://chat.whatsapp.com/a/../A", "https://chat.whatsapp.com.evil.test/A", "https://x@chat.whatsapp.com/A", "https://chat.whatsapp.com/A#B", "javascript:alert(1)"])("rejects unsafe/non-invitation URL: %s", input => expect(parseWhatsAppInvite(input).error).toBeTruthy());

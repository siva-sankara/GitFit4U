import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { decodeInvitationQr, storeInvitationQr, verifiedInvitationQr, InvitationQr } from "./invitationQrService.js";
prepareZXingModule({ overrides: { wasmBinary: readFileSync(createRequire(import.meta.url).resolve("zxing-wasm/writer/zxing_writer.wasm")) } });
afterEach(() => vi.restoreAllMocks());
async function qr(text = "https://chat.whatsapp.com/CaseSensitive") {
  const result = await writeBarcode(text, { format: "QRCode", scale: 5 });
  return Buffer.from(await result.image!.arrayBuffer());
}
it("decodes a real QR locally and canonicalizes its destination", async () => {
  expect((await decodeInvitationQr(await qr("https://chat.whatsapp.com/AbC/?mode=ac_t"), "image/png")).url).toBe("https://chat.whatsapp.com/AbC");
});
it("rejects QR mismatch before any storage call", async () => {
  await expect(storeInvitationQr(await qr(), "image/png", { scope: "GYM_MEMBERS", ownerId: "owner", gymId: "gym" }, "https://chat.whatsapp.com/Different")).rejects.toMatchObject({ code: "INVITE_QR_MISMATCH" });
});
it("rejects two QR codes even when both are valid invitations", async () => {
  const left = await qr(), right = await qr("https://chat.whatsapp.com/Another");
  const meta = await sharp(left).metadata();
  const both = await sharp({ create: { width: meta.width! * 2 + 80, height: meta.height! + 80, channels: 3, background: "white" } }).composite([{ input: left, left: 10, top: 20 }, { input: right, left: meta.width! + 60, top: 20 }]).png().toBuffer();
  await expect(decodeInvitationQr(both, "image/png")).rejects.toMatchObject({ code: "INVITE_QR_AMBIGUOUS" });
});
it("rejects unsafe QR destinations, invalid content and absent QR", async () => {
  await expect(decodeInvitationQr(await qr("https://evil.test"), "image/png")).rejects.toMatchObject({ code: "INVITE_QR_LINK" });
  await expect(decodeInvitationQr(Buffer.from("not an image"), "image/png")).rejects.toMatchObject({ code: "FILE_CONTENT_INVALID" });
  const blank = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  await expect(decodeInvitationQr(blank, "image/png")).rejects.toMatchObject({ code: "INVITE_QR_AMBIGUOUS" });
});
it("binds stored QR to both owner and scope and compares canonical identity", async () => {
  const find = vi.spyOn(InvitationQr, "findOne").mockReturnValue({ select: () => ({ lean: async () => ({ inviteUrl: "https://chat.whatsapp.com/A" }) }) } as never);
  await expect(verifiedInvitationQr("qr", "https://chat.whatsapp.com/B", { scope: "PLATFORM_OWNERS", ownerId: "admin" })).rejects.toMatchObject({ code: "INVITE_QR_MISMATCH" });
  expect(find).toHaveBeenCalledWith({ publicId: "qr", scope: "PLATFORM_OWNERS" });
});

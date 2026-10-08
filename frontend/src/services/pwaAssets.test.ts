import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url));
it("captures real browser event objects before module startup without serializing them", () => {
  const target = new EventTarget() as EventTarget & { __gfuInstallCapture: { prompt: Event | null; installed: boolean } };
  let changes = 0;
  target.addEventListener("gfu-install-capture", () => { changes++; });
  runInNewContext(read("public/install-bootstrap.js").toString(), { window: target, Event });
  const prompt = new Event("beforeinstallprompt", { cancelable: true });
  target.dispatchEvent(prompt);
  expect(prompt.defaultPrevented).toBe(true); expect(target.__gfuInstallCapture.prompt).toBe(prompt);
  target.dispatchEvent(new Event("appinstalled"));
  expect(target.__gfuInstallCapture).toEqual({ prompt: null, installed: true }); expect(changes).toBe(2);
  const html = read("index.html").toString();
  expect(html.indexOf("/install-bootstrap.js")).toBeLessThan(html.indexOf('type="module"'));
});
it("ships a coherent standalone manifest and correctly sized PNG install icons", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest").toString());
  expect(manifest).toMatchObject({ id: "/", scope: "/", start_url: "/app/home", display: "standalone" });
  for (const icon of manifest.icons.filter((icon: any) => icon.type === "image/png")) {
    const png = read(`public${icon.src}`), [width, height] = icon.sizes.split("x").map(Number);
    expect(png.toString("hex", 0, 8)).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(width); expect(png.readUInt32BE(20)).toBe(height);
  }
});
it("uses system fonts and relative root sizing without disabling zoom", () => {
  const tokens = read("src/styles/tokens.css").toString(), global = read("src/styles/global.css").toString();
  expect(tokens).toContain("--font-system: system-ui"); expect(tokens).toContain("--font-body: var(--font-system)");
  expect(global).toMatch(/html\s*\{\s*font-size:\s*100%/); expect(global).toContain("font: inherit");
  expect(read("index.html").toString()).not.toMatch(/user-scalable=no|maximum-scale=1/);
});

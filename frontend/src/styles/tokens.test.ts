import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const [lightSource, darkSource] = source.split(':root[data-theme="dark"]');
function colors(block: string) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [match[1], match[2]]));
}
const light = colors(lightSource);
const dark = { ...light, ...colors(darkSource) };
function luminance(hex: string) {
  const components = hex.slice(1).match(/../g)!.map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
describe.each([["light", light], ["dark", dark]] as const)("%s shared palette", (_name, palette) => {
  it.each(["text", "text-secondary", "text-muted", "brand-text", "success", "warning", "error", "info"])("%s text meets 4.5:1 on page, card and form surfaces", (foreground) => {
    for (const background of ["bg", "surface-solid", "surface-elevated", "input-bg"]) {
      expect(contrast(palette[foreground], palette[background]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("preserves readable action text and selected states", () => {
    expect(contrast(palette["brand-ink"], palette.brand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette["brand-ink"], palette["brand-strong"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette["selected-text"], palette["selected-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette["text-secondary"], palette["surface-hover"])).toBeGreaterThanOrEqual(4.5);
  });
  it("makes essential control edges and focus visible at 3:1", () => {
    for (const control of ["control-border", "focus"]) {
      for (const background of ["bg", "surface-solid", "input-bg", "selected-bg"]) {
        expect(contrast(palette[control], palette[background]), `${control} on ${background}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

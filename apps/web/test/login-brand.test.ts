import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function luminance(hex: string): number {
  const channels = hex.match(/../gu)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (bright + 0.05) / (dark + 0.05);
}

test("uses the Ynov turquoise token for the login slogan with AA contrast across the gradient", async () => {
  const css = await readFile(new URL("../app/ynov-v2.css", import.meta.url), "utf8");
  assert.match(css, /\.login-brand h1\s*\{[^}]*color:\s*var\(--teal\)/u);
  assert.ok(contrast("23b2a4", "181d25") >= 4.5);
  assert.ok(contrast("23b2a4", "0f141c") >= 4.5);
});

/**
 * WCAG 2.1 AA contrast for the design tokens in globals.css. Text pairs need 4.5:1; UI
 * component boundaries and focus indicators need 3:1 (1.4.11). A token change that breaks
 * a pair fails here rather than in an audit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");
const theme = css.match(/@theme\s*{([\s\S]*?)}/)?.[1] ?? "";
const tokens = Object.fromEntries(
  [...theme.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]),
);

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ["text", "surface"],
  ["text", "canvas"],
  ["heading", "surface"],
  ["heading", "canvas"],
  ["muted", "surface"],
  ["muted", "canvas"],
  ["primary", "surface"],
  ["primary", "canvas"],
  ["primary", "primary-soft"],
  ["on-primary", "primary"],
  ["on-primary", "primary-hover"],
  ["on-primary", "danger-text"],
  ["success-text", "success-bg"],
  ["warning-text", "warning-bg"],
  ["danger-text", "danger-bg"],
  ["info-text", "info-bg"],
  ["neutral-text", "neutral-bg"],
  ["heading", "primary-soft"],
];

const NON_TEXT_PAIRS: [string, string][] = [
  ["border-strong", "surface"],
  ["focus", "surface"],
  ["focus", "canvas"],
];

describe("design token contrast", () => {
  it("parses the tokens", () => {
    expect(Object.keys(tokens).length).toBeGreaterThan(15);
  });

  it.each(TEXT_PAIRS)("%s on %s meets 4.5:1", (fg, bg) => {
    expect(tokens[fg], fg).toBeDefined();
    expect(tokens[bg], bg).toBeDefined();
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("%s against %s meets 3:1", (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3);
  });
});

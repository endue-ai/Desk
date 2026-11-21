// @vitest-environment jsdom
// A sample's universal view formats dates and numbers in the locale the surfaces' catalog gives
// the desk's language (#361, ADR 0250).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ShellCtx } from "../../shell/context";
import { Store, sampleState } from "../../shell/state";
import { universalBody } from "./universal";

const catalog = (lang: "en" | "ko"): Record<string, string> => {
  const path = join(import.meta.dirname, "../messages", `${lang}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
};

const ctx = (lang: "en" | "ko") =>
  ({ store: new Store(sampleState(lang, 0)), wall: () => 0 }) as unknown as ShellCtx;

describe("a sample's universal view (#361)", () => {
  it("takes its locale from surface/messages in either language", () => {
    for (const lang of ["en", "ko"] as const) {
      const locale = catalog(lang)["surface.locale"];
      expect(locale, `surface.locale in ${lang}.json`).toBeTypeOf("string");
      const el = universalBody(ctx(lang), { type: "text", source: { data: { entries: [] } } });
      expect(el.getAttribute("locale")).toBe(locale);
    }
    expect([catalog("en")["surface.locale"], catalog("ko")["surface.locale"]]).toEqual([
      "en-US",
      "ko-KR",
    ]);
  });
});

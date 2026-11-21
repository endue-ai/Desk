// A local agent's words, on its screen and in the agent bar, come from the surfaces' catalog (#361,
// ADR 0250), in English and in Korean, and read as they did when they were inline.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fill } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { localText } from "./copy";
import { why } from "./model";

const catalog = (lang: "en" | "ko"): Record<string, string> => {
  const path = join(import.meta.dirname, "../messages", `${lang}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
};
const PREFIX = "surface.localAgent.";
type Key = Parameters<typeof localText>[1];

describe("a local agent's words (#361)", () => {
  it("come from surface/messages, in English and Korean", () => {
    const en = catalog("en");
    const ko = catalog("ko");
    const ids = Object.keys(en).filter((id) => id.startsWith(PREFIX));
    expect(ids.length, "surface.localAgent.* ids in surface/messages/en.json").toBeGreaterThan(40);
    for (const id of ids) {
      const key = id.slice(PREFIX.length) as Key;
      expect(ko[id], `${id} in ko.json`).toBeTypeOf("string");
      expect(localText("en", key), id).toBe(fill(en[id] ?? ""));
      expect(localText("ko", key), id).toBe(fill(ko[id] ?? ""));
    }
    expect(localText("en", "idle", { name: "Codex" })).toBe("Codex · on this computer");
    expect(localText("ko", "idle", { name: "Codex" })).toBe("Codex · 이 컴퓨터");
  });

  it("says why a call failed in words, in the desk's language when it carries none", () => {
    expect(why("en", new Error("no such session"))).toBe("no such session");
    expect(why("ko", "busy")).toBe("busy");
    expect(why("en", { code: 1 })).toBe(catalog("en")["surface.localAgent.unknownError"]);
    expect(why("ko", undefined)).toBe(catalog("ko")["surface.localAgent.unknownError"]);
    expect(why("ko", undefined)).not.toBe(why("en", undefined));
  });
});

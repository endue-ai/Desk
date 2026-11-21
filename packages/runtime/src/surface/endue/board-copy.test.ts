// An endue agent's Studio board reads its words, and puts its sentence together, from the surfaces'
// catalog (#361, ADR 0250), in English and in Korean, as it did when they were inline.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fill } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { boardText, boardWord, type Capability, capability } from "./board-copy";

const catalog = (lang: "en" | "ko"): Record<string, string> => {
  const path = join(import.meta.dirname, "../messages", `${lang}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
};
const PREFIX = "surface.board.";
type Key = Parameters<typeof boardText>[1];

const said = (lang: "en" | "ko", facts: Capability) =>
  capability(lang, facts)
    .map((s) => s.text)
    .join("");
const toned = (lang: "en" | "ko", facts: Capability, tone: "hl" | "warn") =>
  capability(lang, facts)
    .filter((s) => s.tone === tone)
    .map((s) => s.text);

const facts = (over: Partial<Capability> = {}): Capability => ({
  inputs: ["Console chat", "Live"],
  skills: 2,
  tools: 3,
  outputs: ["Gmail", "Notion"],
  moreOutputs: 1,
  broken: ["Slack"],
  ...over,
});

describe("the Studio board's words (#361)", () => {
  it("come from surface/messages, in English and Korean", () => {
    const en = catalog("en");
    const ko = catalog("ko");
    const ids = Object.keys(en).filter((id) => id.startsWith(PREFIX));
    expect(ids.length, "surface.board.* ids in surface/messages/en.json").toBeGreaterThan(100);
    for (const id of ids) {
      const key = id.slice(PREFIX.length) as Key;
      expect(ko[id], `${id} in ko.json`).toBeTypeOf("string");
      expect(boardText("en", key), id).toBe(fill(en[id] ?? ""));
      expect(boardText("ko", key), id).toBe(fill(ko[id] ?? ""));
    }
    expect(boardText("ko", "opens", { name: "MCP" })).toBe("스튜디오에서 MCP 을 엽니다");
  });

  it("puts the sentence together from the catalog in both languages", () => {
    const en = catalog("en");
    expect(said("en", facts())).toBe(
      "Takes requests from Console chat · Live, handles them with 2 skills and 3 built-in tools, " +
        "and leaves results in Gmail · Notion +1 · Outputs. Needs reconnecting: Slack",
    );
    expect(toned("en", facts(), "hl")).toEqual([
      "Console chat · Live",
      fill(en["surface.board.doesSkillsN"] ?? "", { n: 2 }),
      fill(en["surface.board.doesToolsN"] ?? "", { n: 3 }),
      "Gmail · Notion +1 · Outputs",
    ]);
    expect(toned("en", facts(), "warn")).toEqual([" Needs reconnecting: Slack"]);
    const ko = facts({ inputs: ["콘솔 채팅", "라이브"] });
    expect(said("ko", ko)).toBe(
      "콘솔 채팅 · 라이브 에서 요청을 받아 스킬 2개와 내장 도구 3개로 처리하고, " +
        "결과를 Gmail · Notion 외 1 · 결과물에 남겨요. 다시 연결이 필요해요: Slack",
    );
    expect(toned("ko", ko, "hl")).toEqual([
      "콘솔 채팅 · 라이브",
      "스킬 2개",
      "내장 도구 3개",
      "Gmail · Notion 외 1 · 결과물",
    ]);
  });

  it("says how the agent handles requests with skills only, tools only or by talking", () => {
    const only = (over: Partial<Capability>) =>
      facts({ outputs: [], moreOutputs: 0, broken: [], ...over });
    expect(said("en", only({ tools: 0 }))).toBe(
      "Takes requests from Console chat · Live, handles them with 2 skills, and leaves results in Outputs.",
    );
    expect(said("en", only({ skills: 0 }))).toContain("handles them with 3 built-in tools, and");
    expect(said("en", only({ skills: 0, tools: 0 }))).toContain(
      "handles them in conversation, and",
    );
    expect(said("ko", only({ tools: 0 }))).toBe(
      "Console chat · Live 에서 요청을 받아 스킬 2개로 처리하고, 결과를 결과물에 남겨요.",
    );
    expect(said("ko", only({ skills: 0 }))).toContain("내장 도구 3개로 처리하고, 결과를");
    expect(said("ko", only({ skills: 0, tools: 0 }))).toContain(
      "에서 요청을 받아 대화만으로 처리하고, 결과를",
    );
  });

  it("names a channel, a wallpaper, a trait and a tool group from its id, else not at all", () => {
    expect(boardWord("en", "tool", "web_fetch")).toBe("Web Fetch");
    expect(boardWord("ko", "tool", "web_fetch")).toBe("웹 조회");
    expect(boardWord("ko", "tool", "memory")).toBe("메모리");
    expect(boardWord("en", "trait", "self_evolving")).toBe("Self-evolving");
    expect(boardWord("ko", "trait", "self_config")).toBe("Self Configuration");
    expect(boardWord("en", "channel", "navertalk")).toBe("NAVER TalkTalk");
    expect(boardWord("ko", "channel", "kakao")).toBe("카카오톡");
    expect(boardWord("ko", "wallpaper", "constellation")).toBe("별자리");
    expect(boardWord("en", "tool", "brand_new")).toBeUndefined();
    expect(boardWord("en", "tool", "settings")).toBeUndefined();
    expect(boardWord("en", "channel", "x-y")).toBeUndefined();
  });
});

// The endue cards' and the agent bar's words come from the surfaces' catalog (#361, ADR 0250), in
// English and in Korean, and read as they did when they were inline.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fill,
  type StudioSpace,
  type StudioSpacesGetResult,
  type StudioSpaceWorkStatus,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { endueText } from "./copy";
import { spaceStudio } from "./model";

const catalog = (lang: "en" | "ko"): Record<string, string> => {
  const path = join(import.meta.dirname, "../messages", `${lang}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
};
const PREFIX = "surface.endue.";
type Key = Parameters<typeof endueText>[1];

const at = "2026-11-08T09:00:00Z";
const space: StudioSpace = {
  id: "sp_1",
  key: "launch",
  name: "Launch",
  status: "active",
  createdAt: at,
  updatedAt: at,
};

describe("the endue cards' words (#361)", () => {
  it("come from surface/messages, in English and Korean", () => {
    const en = catalog("en");
    const ko = catalog("ko");
    const ids = Object.keys(en).filter((id) => id.startsWith(PREFIX));
    expect(ids.length, "surface.endue.* ids in surface/messages/en.json").toBeGreaterThan(40);
    for (const id of ids) {
      const key = id.slice(PREFIX.length) as Key;
      expect(ko[id], `${id} in ko.json`).toBeTypeOf("string");
      expect(endueText("en", key), id).toBe(fill(en[id] ?? ""));
      expect(endueText("ko", key), id).toBe(fill(ko[id] ?? ""));
    }
    expect(endueText("en", "barSpace", { name: "Launch" })).toBe("Launch space");
    expect(endueText("ko", "barSpace", { name: "Launch" })).toBe("Launch 스페이스");
    expect(ko["surface.endue.work.inProgress"]).toBe("진행 중");
  });

  it("a piece of work's status reads its own word in either language", () => {
    const statuses: StudioSpaceWorkStatus[] = ["in_progress", "needs_you", "partly_done", "paused"];
    const value: StudioSpacesGetResult = {
      space,
      counts: { activeWorkItems: 4, openAttentionItems: 1, results: 0 },
      agents: [],
      work: statuses.map((status, i) => ({ id: `w${i}`, title: "x", status, updatedAt: "" })),
      results: [],
      rooms: [],
      problems: [],
    };
    const meta = (lang: "en" | "ko") =>
      spaceStudio(lang, space, { state: "ready", value }, [], Date.parse(at)).work.map(
        (w) => w.meta,
      );
    expect(meta("en")).toEqual(["In progress", "Needs you", "Partly done", "Paused"]);
    expect(meta("ko")).toEqual(["진행 중", "확인 필요", "일부 완료", "꺼짐"]);
  });
});

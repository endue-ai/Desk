// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { ItemQuery, UniversalPage } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createClock, readsClock } from "../ui/clock.js";
import { createScreen } from "../ui/screen.js";
import { failureText } from "../ui/words.js";

// What desk.universal's page says when a source fails (07 #16: words, not "fs.read: not_found: …"),
// and a calendar paged to another day reading that day's entries, not today's.
const NOW = new Date(2026, 9, 30, 9).getTime(); // Friday 30 October 2026, 9 in the morning
const FILES = { permission: "fs:read" as const, paths: ["~/**"] };
const EVENTS = { permission: "data:read" as const, kinds: ["event" as const] };

/** A page like Today: a day's calendar over the clock, and a list that does not read it. */
const PAGE: UniversalPage = {
  id: "test.today",
  title: "Today",
  sections: [
    {
      title: "Schedule",
      type: "calendar",
      options: { range: "day" },
      source: {
        items: {
          kinds: ["event"],
          where: [
            { field: "start", op: "lt", value: "{tomorrow}" },
            { field: "end", op: "gt", value: "{today}" },
          ],
        },
      },
    },
    { title: "Missing", type: "list", source: { file: "~/nope/missing.yaml" } },
  ],
};

async function mount() {
  const queries: ItemQuery[] = [];
  const host = createTestHost({
    pluginId: "desk.universal",
    grants: [FILES, EVENTS],
    files: {},
    handlers: {
      "data.query": ({ query }) => {
        queries.push(query);
        return { items: [], total: 0 };
      },
    },
  });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  const page = document.createElement("main");
  document.body.append(page);
  const screen = createScreen(page, ctx, { now: () => NOW });
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await host.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  const sections = () => [...page.querySelectorAll(".desk-universal-page > desk-universal-view")];
  /** The day {today} was filled with in the last query. */
  const today = () => String(queries.at(-1)?.where?.[1]?.value ?? "").slice(0, 10);
  return { host, page, screen, settle, sections, queries, today };
}

const range = (anchor: string) =>
  new CustomEvent("desk-range", {
    bubbles: true,
    composed: true,
    detail: { anchor, range: "day" },
  });

describe("desk.universal's page", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("says a source that fails in words, not the bridge's error", async () => {
    const m = await mount();
    m.screen.open(PAGE);
    await m.settle();
    const missing = m.sections()[1];
    expect(missing?.getAttribute("state")).toBe("error");
    expect(missing?.getAttribute("message")).toBe("There is no file at ~/nope/missing.yaml.");
  });

  it("a calendar paged to another day reads that day; Today reads the live clock again", async () => {
    const m = await mount();
    m.screen.open(PAGE);
    await m.settle();
    expect(m.today()).toBe("2026-10-30");
    const reads = m.queries.length;

    m.sections()[0]?.dispatchEvent(range("2026-10-31"));
    await m.settle();
    expect(m.queries.length).toBeGreaterThan(reads);
    expect(m.today()).toBe("2026-10-31");
    expect(String(m.queries.at(-1)?.where?.[0]?.value).slice(0, 10)).toBe("2026-11-01");

    m.sections()[0]?.dispatchEvent(range("2026-10-30"));
    await m.settle();
    expect(m.today()).toBe("2026-10-30");

    // A view drawn again starts on the live clock.
    m.sections()[0]?.dispatchEvent(range("2026-10-29"));
    await m.settle();
    m.screen.close();
    m.screen.open(PAGE);
    await m.settle();
    expect(m.today()).toBe("2026-10-30");
  });

  it("the clock moves only for views that read it, and only to a day", () => {
    expect(readsClock(PAGE)).toBe(true);
    expect(readsClock(PAGE.sections[1])).toBe(false);
    const clock = createClock(() => NOW);
    expect(clock.move("2026-10-30")).toBe(false);
    expect(clock.now()).toBe(NOW);
    expect(clock.move("next week")).toBe(false);
    expect(clock.move("2026-11-02")).toBe(true);
    expect(new Date(clock.now()).getDate()).toBe(2);
    clock.reset();
    expect(clock.now()).toBe(NOW);
  });

  it("says each kind of failure for a person", () => {
    const file = { file: "~/boards/launch.yaml" };
    const url = { url: "https://example.com/feed.yaml" };
    const bridge = (code: string) =>
      Object.assign(new Error(`fs.read: ${code}: No such file or directory (os error 2)`), {
        code,
      });
    const universal = (message: string) =>
      Object.assign(new Error(message), { name: "UniversalError" });
    expect(failureText(bridge("not_found"), file)).toBe(
      "There is no file at ~/boards/launch.yaml.",
    );
    expect(failureText(bridge("io_error"), file)).toBe("~/boards/launch.yaml could not be read.");
    expect(failureText(bridge("timeout"), url)).toBe("example.com took too long to answer.");
    expect(failureText(bridge("offline"), url)).toBe(
      "example.com cannot be reached: this computer is offline.",
    );
    expect(failureText(universal("404 from example.com"), url)).toBe(
      "example.com answered 404: there is nothing to show.",
    );
    expect(failureText(universal("Not YAML: bad indentation"), file)).toBe(
      "~/boards/launch.yaml is not YAML or JSON.",
    );
    expect(failureText(universal("Not a universal data document: entries: missing"), file)).toBe(
      "~/boards/launch.yaml holds no entries a view can show.",
    );
    expect(failureText(bridge("not_found"), { command: "example.feed.get" })).toBe(
      "No plugin answers for this view any more.",
    );
    // No sentence carries a method, a code or the system's own words.
    for (const code of ["not_found", "io_error", "internal", "invalid_params"])
      expect(failureText(bridge(code), file)).not.toMatch(/fs\.read|_|os error/);
  });
});

// Calendar commands and clock updates through the real view and a controllable desk clock.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CommandFailed } from "../../../packages/plugin-sdk/src/index";
import { createView } from "../ui/view.js";
import { documentOf, key } from "./dom";
import { ics } from "./fixtures";
import { disk, file, type Mounted, mount } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const A = file("~/Calendar/clock.ics");
const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

async function setup(options: { now?: number; paletteError?: Error } = {}) {
  const doc = documentOf(html);
  let mounted: Mounted | undefined;
  const view = createView(doc as never, {
    previous: () => mounted?.app.previous(),
    next: () => mounted?.app.next(),
    today: () => mounted?.app.today(),
    show: (mode) => mounted?.app.show(mode),
    goto: (date) => mounted?.app.goto(date),
    compose: (at) => mounted?.app.compose(at ?? {}),
    edit: (id) => mounted?.app.edit(id),
    ask: () => mounted?.app.ask(),
  });
  mounted = await mount({
    ...options,
    handlers: disk({ [A.path]: ics() }),
    view: { ...view, editor: () => {} },
  });
  await mounted.host.command("desk.files.visit", A);
  return { ...mounted, doc };
}

describe("calendar date and clock", () => {
  it("leaves the status line empty when g is cancelled", async () => {
    const m = await setup({
      paletteError: new CommandFailed("desk.palette.pick", "cancelled", "nothing was picked"),
    });
    m.doc.body.dispatchEvent(key("g"));
    await m.settle();
    expect(m.doc.getElementById("status")?.textContent).toBe("");
    m.app.dispose();
  });

  it.each(["2026-02-31", "2026-13-01"])("rejects the impossible date %s", async (date) => {
    const m = await setup();
    const anchor = m.view.last.anchor;
    await expect(m.host.command("endue.calendar.goto", { date })).rejects.toThrow(
      `"${date}" is not a date; write it as 2026-11-03.`,
    );
    expect(m.doc.getElementById("status")?.textContent).toContain(`"${date}" is not a date`);
    expect(m.view.last.anchor).toBe(anchor);
    m.app.dispose();
  });

  it("goes to a valid date", async () => {
    const m = await setup();
    await m.host.command("endue.calendar.goto", { date: "2026-02-28" });
    expect(m.view.last.anchor).toBe(day("2026-02-28"));
    m.app.dispose();
  });

  it("reports other palette failures", async () => {
    const m = await setup({ paletteError: new Error("palette unavailable") });
    m.doc.body.dispatchEvent(key("g"));
    await m.settle();
    expect(m.doc.getElementById("status")?.textContent).toBe("palette unavailable");
    m.app.dispose();
  });

  it("moves the now line at the minute boundary and stops on dispose", async () => {
    const m = await setup({ now: Date.parse("2026-10-30T00:00:30Z") });
    m.app.show("week");
    const top = () => m.doc.querySelector(".now")?.style.top;
    const before = top();
    const scroll = m.doc.querySelector(".scroll");
    if (!scroll) throw new Error("missing timeline");
    scroll.scrollTop = 413;
    scroll.focus();
    expect(before).toBeDefined();
    m.clock.now += 29_000;
    m.tick();
    expect(top()).toBe(before);
    m.clock.now += 1_000;
    m.tick();
    expect(top()).not.toBe(before);
    expect(m.doc.querySelector(".scroll")?.scrollTop).toBe(413);
    expect(m.doc.activeElement).toBe(m.doc.querySelector(".scroll"));
    const renders = m.view.states.length;
    m.app.dispose();
    m.clock.now += 60_000;
    m.tick();
    expect(m.view.states).toHaveLength(renders);
  });

  it("moves today's highlight at midnight in the display time zone", async () => {
    const m = await setup({ now: Date.parse("2026-10-30T14:59:30Z") });
    const highlighted = () =>
      m.doc.querySelector('[aria-current="date"]')?.getAttribute("data-day");
    expect(highlighted()).toBe(String(day("2026-10-30")));
    m.clock.now += 30_000;
    m.tick();
    expect(highlighted()).toBe(String(day("2026-10-31")));
    m.app.dispose();
  });
});

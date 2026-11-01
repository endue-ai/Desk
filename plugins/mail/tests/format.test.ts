import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

/** Count explicit construction and the Date helpers that construct formatters internally. */
function formatterWork() {
  const construct = vi.spyOn(Intl, "DateTimeFormat");
  const date = vi.spyOn(Date.prototype, "toLocaleDateString");
  const time = vi.spyOn(Date.prototype, "toLocaleTimeString");
  const full = vi.spyOn(Date.prototype, "toLocaleString");
  return () =>
    construct.mock.calls.length +
    date.mock.calls.length +
    time.mock.calls.length +
    full.mock.calls.length;
}

const START = Date.UTC(2026, 10, 3, 7);
const END = START + 3_600_000;
const span = {
  start: {
    wall: START,
    utc: START,
    allDay: false,
    zone: "UTC",
    floating: false,
    approximate: false,
  },
  end: { wall: END, utc: END, allDay: false, zone: "UTC", floating: false, approximate: false },
  allDay: false,
};

describe("mail date formatter reuse", () => {
  it("redraws the invitation without constructing the same formatters again", async () => {
    const work = formatterWork();
    const { whenLine } = await import("../ui/format.js");
    const clock = { locale: "en-GB", zone: "Europe/Berlin" };
    const shown = whenLine(span, clock);
    expect(shown).toEqual({ line: "Tue, 3 Nov 2026, 08:00 – 09:00" });
    const first = work();
    expect(first).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) expect(whenLine(span, clock)).toEqual(shown);
    expect(work()).toBe(first);
  });

  it("reuses list and reader formatters while keeping locales, zones and options separate", async () => {
    const work = formatterWork();
    const { listTime, fullTime } = await import("../ui/format.js");
    const clock = { locale: "en-GB", zone: "Asia/Seoul", now: END };
    const iso = new Date(START).toISOString();
    expect(listTime(iso, clock)).toBe("16:00");
    expect(fullTime(iso, clock)).toBe("Tue, 3 Nov 2026, 16:00");
    const first = work();
    expect(listTime(iso, clock)).toBe("16:00");
    expect(fullTime(iso, clock)).toBe("Tue, 3 Nov 2026, 16:00");
    expect(work()).toBe(first);
    expect(fullTime(iso, { ...clock, zone: "Europe/Berlin" })).toBe("Tue, 3 Nov 2026, 08:00");
    expect(listTime(iso, { ...clock, locale: "en-US" })).toBe("04:00 PM");
    expect(listTime("invalid", clock)).toBe("");
    expect(fullTime("invalid", clock)).toBe("invalid");
  });

  it("bounds cached formatters when documents or locale settings supply many variants", async () => {
    const work = formatterWork();
    const { fullTime } = await import("../ui/format.js");
    const iso = new Date(START).toISOString();
    const firstClock = { locale: "en-US-x-cache0", zone: "UTC" };
    const shown = fullTime(iso, firstClock);
    const first = work();
    expect(fullTime(iso, firstClock)).toBe(shown);
    expect(work()).toBe(first);
    for (let i = 1; i < 80; i++) fullTime(iso, { ...firstClock, locale: `en-US-x-cache${i}` });
    const afterFill = work();
    expect(fullTime(iso, firstClock)).toBe(shown);
    expect(work()).toBe(afterFill + 1);
  });
});

it("resolves the current zone again when the person changes it", async () => {
  const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
  let zone = "Asia/Seoul";
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolved.call(this), timeZone: zone };
  });
  const { whenLine } = await import("../ui/format.js");
  expect(whenLine(span, { locale: "en-GB" }).line).toBe("Tue, 3 Nov 2026, 16:00 – 17:00");
  zone = "Europe/Berlin";
  expect(whenLine(span, { locale: "en-GB" }).line).toBe("Tue, 3 Nov 2026, 08:00 – 09:00");
});

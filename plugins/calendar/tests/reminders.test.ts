// Reminders: when VALARMs are due (RFC 5545 §3.6.6, RFC 9074 ACKNOWLEDGED), and the notifications the
// plugin shows for them while a calendar is open, each once.
import { describe, expect, it } from "vitest";
import { dueReminders } from "../ui/calendar/alarms.js";
import { at, ics, model } from "./fixtures";
import { disk, file, mount, NOW } from "./harness";

const MIN = 60_000;
const alarm = (...lines: string[]) => ["BEGIN:VALARM", ...lines, "END:VALARM"];
const EVENT = ["UID:e", "DTSTART:20261030T010000Z", "DTEND:20261030T020000Z", "SUMMARY:Review"];

const due = (text: string, from: string, to: string) =>
  dueReminders(model(text), at(from), at(to)).map((r) => [
    new Date(r.at).toISOString().slice(11, 16),
    r.message,
  ]);

describe("when alarms are due", () => {
  it("before the start, after the end, at a set time, and repeated", () => {
    const text = ics([
      ...EVENT,
      ...alarm("ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Soon"),
      ...alarm("ACTION:AUDIO", "TRIGGER;RELATED=END:PT5M"),
      ...alarm("ACTION:DISPLAY", "TRIGGER;VALUE=DATE-TIME:20261030T003000Z", "DESCRIPTION:Prepare"),
      ...alarm(
        "ACTION:DISPLAY",
        "TRIGGER:-PT10M",
        "REPEAT:2",
        "DURATION:PT5M",
        "DESCRIPTION:Again",
      ),
      ...alarm("ACTION:EMAIL", "TRIGGER:-PT1H", "SUMMARY:Mail", "ATTENDEE:mailto:a@b.c"),
    ]);
    expect(due(text, "2026-10-30T00:00:00Z", "2026-10-30T03:00:00Z")).toEqual([
      ["00:30", "Prepare"],
      ["00:45", "Soon"],
      ["00:50", "Again"],
      ["00:55", "Again"],
      ["01:00", "Again"],
      ["02:05", "Review"],
    ]);
  });

  it("not when acknowledged, nor for a cancelled event, and each instance of a series", () => {
    const acknowledged = ics([
      ...EVENT,
      ...alarm("ACTION:DISPLAY", "TRIGGER:-PT15M", "ACKNOWLEDGED:20261030T004600Z"),
    ]);
    expect(due(acknowledged, "2026-10-30T00:00:00Z", "2026-10-31T00:00:00Z")).toEqual([]);
    const cancelled = ics([
      ...EVENT,
      "STATUS:CANCELLED",
      ...alarm("ACTION:DISPLAY", "TRIGGER:-PT15M"),
    ]);
    expect(due(cancelled, "2026-10-30T00:00:00Z", "2026-10-31T00:00:00Z")).toEqual([]);
    const series = ics([
      ...EVENT,
      "RRULE:FREQ=DAILY;COUNT=3",
      ...alarm("ACTION:DISPLAY", "TRIGGER:-PT15M"),
    ]);
    expect(
      dueReminders(model(series), at("2026-10-30T00:00:00Z"), at("2026-11-02T00:00:00Z")).map(
        (r) => r.key,
      ),
    ).toEqual([
      `e@20261030T010000Z|0|${at("2026-10-30T00:45:00Z")}`,
      `e@20261031T010000Z|0|${at("2026-10-31T00:45:00Z")}`,
      `e@20261101T010000Z|0|${at("2026-11-01T00:45:00Z")}`,
    ]);
  });
});

describe("notifications", () => {
  const A = file("~/Calendar/a.ics");
  // Due 15 minutes before 01:00Z, which is 00:45Z; the clock starts at 00:00Z.
  const TEXT = ics([
    ...EVENT,
    "LOCATION:Room 2",
    ...alarm("ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Review in 15 minutes"),
  ]);

  it("come once when the alarm is due, with when and where", async () => {
    const m = await mount({ handlers: disk({ [A.path]: TEXT }) });
    await m.host.command("desk.files.visit", A);
    m.clock.now = NOW + 44 * MIN;
    m.tick();
    await m.settle();
    expect(m.params("ui.notify")).toEqual([]);
    m.clock.now = NOW + 45 * MIN;
    m.tick();
    await m.settle();
    expect(m.params("ui.notify")).toEqual([
      {
        title: "Review in 15 minutes",
        body: "10:00 AM – 11:00 AM · Room 2",
        level: "info",
        scope: { permission: "ui:notify" },
      },
    ]);
    m.clock.now = NOW + 46 * MIN;
    m.tick();
    await m.settle();
    expect(m.params("ui.notify")).toHaveLength(1);
    expect((m.host.state as { fired: string[] }).fired).toHaveLength(1);
  });

  it("do not come again after a reload, nor later than five minutes", async () => {
    const first = await mount({ handlers: disk({ [A.path]: TEXT }) });
    await first.host.command("desk.files.visit", A);
    first.clock.now = NOW + 45 * MIN;
    first.tick();
    await first.settle();
    const again = await mount({ handlers: disk({ [A.path]: TEXT }), state: first.host.state });
    again.clock.now = NOW + 46 * MIN;
    await again.host.command("desk.files.visit", A);
    await again.settle();
    expect(again.params("ui.notify")).toEqual([]);
    const late = await mount({ handlers: disk({ [A.path]: TEXT }) });
    late.clock.now = NOW + 51 * MIN;
    await late.host.command("desk.files.visit", A);
    await late.settle();
    expect(late.params("ui.notify")).toEqual([]);
  });

  it("stay quiet when the setting turns them off", async () => {
    const m = await mount({
      handlers: disk({ [A.path]: TEXT }),
      settings: { "endue.calendar.reminders": false, "endue.calendar.time-zone": "Asia/Seoul" },
    });
    await m.host.command("desk.files.visit", A);
    m.clock.now = NOW + 45 * MIN;
    m.tick();
    await m.settle();
    expect(m.params("ui.notify")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { fixtureItems, type Item, type ItemCondition } from "../../../packages/bridge/src/index";
import { matches } from "../../../packages/bridge/src/stub-query";
import { clockOf, fill, fillValue } from "../ui/template.js";

const NOW = Date.parse("2026-10-30T09:00:00+09:00");
const seoul = { zone: "Asia/Seoul", locale: "en-US", now: NOW, params: {} };
const item = (id: string) => fixtureItems().find((i) => i.id === id) as Item;

describe("templates", () => {
  it("fills fields and dotted paths, and leaves a missing one empty", () => {
    const review = item("ev-review");
    expect(fill("{title} in {location}", review, seoul)).toBe("Design review in Room 1");
    expect(fill("{source.connector}/{source.instance}", review, seoul)).toBe(
      "desk.fixtures/default",
    );
    expect(fill("{raw.labels}", review, seoul)).toBe("work");
    expect(fill("[{nothing}] [{raw.nothing.deeper}]", review, seoul)).toBe("[] []");
    expect(fill("{attendees}", item("ev-standup"), seoul)).toBe("Mina, Jun");
    expect(fill("From {from}", item("msg-landlord"), seoul)).toBe("From Mr. Park");
  });

  it("formats time, date, relative and number in the zone and locale given", () => {
    const review = item("ev-review");
    expect(fill("{start|time}–{end|time}", review, seoul)).toBe("16:00–17:00");
    expect(fill("{start|time}", review, { ...seoul, zone: "UTC" })).toBe("07:00");
    expect(fill("{start|date}", review, seoul)).toBe("Fri, Oct 30");
    expect(fill("{start|date}", review, { ...seoul, locale: "de-DE" })).toBe("Fr., 30. Okt.");
    expect(fill("{due|relative}", item("task-report"), seoul)).toBe("in 8 hours");
    expect(fill("{due|relative}", item("task-groceries"), seoul)).toBe("tomorrow");
    expect(fill("{updatedAt|relative}", item("note-stew"), seoul)).toBe("6 days ago");
    const metric = { points: [{ v: 1234.5 }] };
    expect(fill("{points.0.v|number}", metric, seoul)).toBe("1,234.5");
    expect(fill("{points.0.v|number}", metric, { ...seoul, locale: "de-DE" })).toBe("1.234,5");
    expect(fill("{title|time} {title|number}", review, seoul)).toBe(" ");
  });

  it("has no expressions: anything else in braces stays as written", () => {
    const review = item("ev-review");
    expect(fill("{a + b} {title|upper} {} {{title}} {location}}}", review, seoul)).toBe(
      "{a + b} {title|upper} {} {title} Room 1}",
    );
    expect(fill("{params.days * 2}", review, { ...seoul, params: { days: 3 } })).toBe(
      "{params.days * 2}",
    );
  });

  it("fills {now}, {today}, {tomorrow} and {yesterday} from the injected clock in the view's zone, as RFC 3339 instants", () => {
    expect(clockOf(NOW, "Asia/Seoul")).toEqual({
      now: "2026-10-30T09:00:00+09:00",
      today: "2026-10-30T00:00:00+09:00",
      tomorrow: "2026-10-31T00:00:00+09:00",
      yesterday: "2026-10-29T00:00:00+09:00",
    });
    // The same instant is still the 29th in Los Angeles.
    expect(clockOf(NOW, "America/Los_Angeles")).toEqual({
      now: "2026-10-29T17:00:00-07:00",
      today: "2026-10-29T00:00:00-07:00",
      tomorrow: "2026-10-30T00:00:00-07:00",
      yesterday: "2026-10-28T00:00:00-07:00",
    });
    expect(fill("{today} {tomorrow|date}", {}, seoul)).toBe(
      "2026-10-30T00:00:00+09:00 Sat, Oct 31",
    );

    const asked: ItemCondition[] = [{ field: "start", op: "gte", value: "{today}" }];
    const where = fillValue(asked, {}, seoul);
    expect(where).toEqual([{ field: "start", op: "gte", value: "2026-10-30T00:00:00+09:00" }]);
    // 16:00 UTC on the 29th is 01:00 on the 30th in Seoul: after the start of today, as an instant.
    const early = { ...item("ev-standup"), start: "2026-10-29T16:00:00Z" } as Item;
    expect(matches(early, { where })).toBe(true);
    const before: ItemCondition = { field: "start", op: "lt", value: where[0]?.value };
    expect(matches(item("ev-hike"), { where: [before] })).toBe(false);
  });

  it("fills {params.<name>} inside where values and action args, not only in titles", () => {
    const env = { ...seoul, params: { project: "DESK", days: 14 } };
    expect(fill("Sprint: {params.project}", {}, env)).toBe("Sprint: DESK");
    expect(
      fillValue(
        [
          { field: "project", op: "eq", value: "{params.project}" },
          { field: "priority", op: "lte", value: "{params.days}" },
          { field: "status", op: "in", value: ["open", "{params.project}"] },
        ],
        {},
        env,
      ),
    ).toEqual([
      { field: "project", op: "eq", value: "DESK" },
      // A template that is one placeholder alone keeps the value's type.
      { field: "priority", op: "lte", value: 14 },
      { field: "status", op: "in", value: ["open", "DESK"] },
    ]);
    const args = { id: "{id}", instance: "{source.instance}", note: "for {params.project}", n: 3 };
    expect(fillValue(args, item("task-report"), env)).toEqual({
      id: "task-report",
      instance: "default",
      note: "for DESK",
      n: 3,
    });
    expect(fillValue({ priority: "{priority}" }, item("task-report"), env)).toEqual({
      priority: 1,
    });
  });
});

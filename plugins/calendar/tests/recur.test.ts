// The recurrence examples of RFC 5545 §3.8.5.3, each as written there (America/New_York, from DTSTART),
// checked as local wall times. UNTIL is compared in the zone of DTSTART, as the events layer does.
import { describe, expect, it } from "vitest";
import { expand } from "../ui/ical/recur.js";
import { parseRule } from "../ui/ical/rrule.js";
import { formatTime, parseTime, wallOf } from "../ui/ical/values.js";
import { ianaZone } from "../ui/ical/zones.js";

const NY = ianaZone("America/New_York");
if (!NY) throw new Error("the platform lacks America/New_York");

const END = wallOf({ date: true, y: 2008, m: 1, d: 1 });

/** The local starts a rule makes from DTSTART, at most `max` of them, as compact strings. */
function starts(rule: string, dtstart: string, max = 200, end = END): string[] {
  const parsed = parseRule(rule);
  if ("error" in parsed) throw new Error(parsed.error);
  const start = parseTime(dtstart);
  if (!start) throw new Error(`bad DTSTART ${dtstart}`);
  const until = parsed.rule.until;
  const zone = NY as NonNullable<typeof NY>;
  const pastUntil = (wall: number) =>
    until
      ? !until.date && until.utc
        ? zone.toUtc(wall) > wallOf(until)
        : wall > wallOf(until)
      : false;
  const out: string[] = [];
  for (const wall of expand(parsed.rule, wallOf(start), { end, pastUntil })) {
    out.push(formatTime({ ...timeOf(wall) }));
    if (out.length >= max) break;
  }
  return out;
}

function timeOf(wall: number) {
  const date = new Date(wall);
  return {
    date: false as const,
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    h: date.getUTCHours(),
    mi: date.getUTCMinutes(),
    s: date.getUTCSeconds(),
    utc: false,
  };
}

/** Dates at 09:00, written as MMDD within a year, for compact expectations. */
const at9 = (year: number, ...days: string[]) => days.map((d) => `${year}${d}T090000`);

describe("RFC 5545 §3.8.5.3 recurrence examples", () => {
  const T = "19970902T090000";

  it("daily for 10 occurrences", () => {
    expect(starts("FREQ=DAILY;COUNT=10", T)).toEqual(
      at9(1997, "0902", "0903", "0904", "0905", "0906", "0907", "0908", "0909", "0910", "0911"),
    );
  });

  it("daily until December 24, 1997: 113 days, the last on December 23", () => {
    const list = starts("FREQ=DAILY;UNTIL=19971224T000000Z", T, 500);
    expect(list).toHaveLength(113);
    expect(list.at(-1)).toBe("19971223T090000");
  });

  it("every other day, forever", () => {
    expect(starts("FREQ=DAILY;INTERVAL=2", T, 5)).toEqual(
      at9(1997, "0902", "0904", "0906", "0908", "0910"),
    );
  });

  it("every 10 days, 5 occurrences", () => {
    expect(starts("FREQ=DAILY;INTERVAL=10;COUNT=5", T)).toEqual(
      at9(1997, "0902", "0912", "0922", "1002", "1012"),
    );
  });

  it("every day in January, for 3 years, written two ways", () => {
    const yearly = starts(
      "FREQ=YEARLY;UNTIL=20000131T140000Z;BYMONTH=1;BYDAY=SU,MO,TU,WE,TH,FR,SA",
      "19980101T090000",
      500,
      wallOf({ date: true, y: 2001, m: 1, d: 1 }),
    );
    const daily = starts(
      "FREQ=DAILY;UNTIL=20000131T140000Z;BYMONTH=1",
      "19980101T090000",
      500,
      wallOf({ date: true, y: 2001, m: 1, d: 1 }),
    );
    expect(yearly).toHaveLength(93);
    expect(daily).toEqual(yearly);
    expect(yearly.slice(30, 32)).toEqual(["19980131T090000", "19990101T090000"]);
    expect(yearly.at(-1)).toBe("20000131T090000");
  });

  it("weekly for 10 occurrences", () => {
    expect(starts("FREQ=WEEKLY;COUNT=10", T)).toEqual([
      ...at9(1997, "0902", "0909", "0916", "0923", "0930", "1007", "1014", "1021", "1028", "1104"),
    ]);
  });

  it("every other week, forever, with WKST=SU", () => {
    expect(starts("FREQ=WEEKLY;INTERVAL=2;WKST=SU", T, 13)).toEqual([
      ...at9(1997, "0902", "0916", "0930", "1014", "1028", "1111", "1125", "1209", "1223"),
      ...at9(1998, "0106", "0120", "0203", "0217"),
    ]);
  });

  it("weekly on Tuesday and Thursday for five weeks, by UNTIL and by COUNT", () => {
    const expected = at9(
      1997,
      "0902",
      "0904",
      "0909",
      "0911",
      "0916",
      "0918",
      "0923",
      "0925",
      "0930",
      "1002",
    );
    expect(starts("FREQ=WEEKLY;UNTIL=19971007T000000Z;WKST=SU;BYDAY=TU,TH", T)).toEqual(expected);
    expect(starts("FREQ=WEEKLY;COUNT=10;WKST=SU;BYDAY=TU,TH", T)).toEqual(expected);
  });

  it("every other week on Monday, Wednesday and Friday until December 24, 1997", () => {
    expect(
      starts(
        "FREQ=WEEKLY;INTERVAL=2;UNTIL=19971224T000000Z;WKST=SU;BYDAY=MO,WE,FR",
        "19970901T090000",
      ),
    ).toEqual(
      at9(
        1997,
        ...["0901", "0903", "0905", "0915", "0917", "0919", "0929", "1001", "1003", "1013"],
        ...["1015", "1017", "1027", "1029", "1031", "1110", "1112", "1114", "1124", "1126"],
        ...["1128", "1208", "1210", "1212", "1222"],
      ),
    );
  });

  it("every other week on Tuesday and Thursday, for 8 occurrences", () => {
    expect(starts("FREQ=WEEKLY;INTERVAL=2;COUNT=8;WKST=SU;BYDAY=TU,TH", T)).toEqual(
      at9(1997, "0902", "0904", "0916", "0918", "0930", "1002", "1014", "1016"),
    );
  });

  it("monthly on the first Friday for 10 occurrences, and until December 24", () => {
    expect(starts("FREQ=MONTHLY;COUNT=10;BYDAY=1FR", "19970905T090000")).toEqual([
      ...at9(1997, "0905", "1003", "1107", "1205"),
      ...at9(1998, "0102", "0206", "0306", "0403", "0501", "0605"),
    ]);
    expect(starts("FREQ=MONTHLY;UNTIL=19971224T000000Z;BYDAY=1FR", "19970905T090000")).toEqual(
      at9(1997, "0905", "1003", "1107", "1205"),
    );
  });

  it("every other month on the first and last Sunday, for 10 occurrences", () => {
    expect(starts("FREQ=MONTHLY;INTERVAL=2;COUNT=10;BYDAY=1SU,-1SU", "19970907T090000")).toEqual([
      ...at9(1997, "0907", "0928", "1102", "1130"),
      ...at9(1998, "0104", "0125", "0301", "0329", "0503", "0531"),
    ]);
  });

  it("monthly on the second-to-last Monday for 6 months", () => {
    expect(starts("FREQ=MONTHLY;COUNT=6;BYDAY=-2MO", "19970922T090000")).toEqual([
      ...at9(1997, "0922", "1020", "1117", "1222"),
      ...at9(1998, "0119", "0216"),
    ]);
  });

  it("monthly on the third-to-the-last day, forever", () => {
    expect(starts("FREQ=MONTHLY;BYMONTHDAY=-3", "19970928T090000", 6)).toEqual([
      ...at9(1997, "0928", "1029", "1128", "1229"),
      ...at9(1998, "0129", "0226"),
    ]);
  });

  it("monthly on the 2nd and 15th, and on the first and last day, for 10 occurrences", () => {
    expect(starts("FREQ=MONTHLY;COUNT=10;BYMONTHDAY=2,15", T)).toEqual([
      ...at9(1997, "0902", "0915", "1002", "1015", "1102", "1115", "1202", "1215"),
      ...at9(1998, "0102", "0115"),
    ]);
    expect(starts("FREQ=MONTHLY;COUNT=10;BYMONTHDAY=1,-1", "19970930T090000")).toEqual([
      ...at9(1997, "0930", "1001", "1031", "1101", "1130", "1201", "1231"),
      ...at9(1998, "0101", "0131", "0201"),
    ]);
  });

  it("every 18 months on the 10th through 15th, for 10 occurrences", () => {
    expect(
      starts("FREQ=MONTHLY;INTERVAL=18;COUNT=10;BYMONTHDAY=10,11,12,13,14,15", "19970910T090000"),
    ).toEqual([
      ...at9(1997, "0910", "0911", "0912", "0913", "0914", "0915"),
      ...at9(1999, "0310", "0311", "0312", "0313"),
    ]);
  });

  it("every Tuesday, every other month", () => {
    expect(starts("FREQ=MONTHLY;INTERVAL=2;BYDAY=TU", T, 13)).toEqual([
      ...at9(1997, "0902", "0909", "0916", "0923", "0930", "1104", "1111", "1118", "1125"),
      ...at9(1998, "0106", "0113", "0120", "0127"),
    ]);
  });

  it("yearly in June and July, and every other year in January to March, 10 times", () => {
    expect(starts("FREQ=YEARLY;COUNT=10;BYMONTH=6,7", "19970610T090000")).toEqual(
      [1997, 1998, 1999, 2000, 2001].flatMap((y) => at9(y, "0610", "0710")),
    );
    expect(starts("FREQ=YEARLY;INTERVAL=2;COUNT=10;BYMONTH=1,2,3", "19970310T090000")).toEqual([
      ...at9(1997, "0310"),
      ...[1999, 2001, 2003].flatMap((y) => at9(y, "0110", "0210", "0310")),
    ]);
  });

  it("every third year on the 1st, 100th and 200th day, for 10 occurrences", () => {
    expect(
      starts("FREQ=YEARLY;INTERVAL=3;COUNT=10;BYYEARDAY=1,100,200", "19970101T090000"),
    ).toEqual([
      ...at9(1997, "0101", "0410", "0719"),
      ...at9(2000, "0101", "0409", "0718"),
      ...at9(2003, "0101", "0410", "0719"),
      ...at9(2006, "0101"),
    ]);
  });

  it("every 20th Monday of the year, and Monday of week 20", () => {
    expect(starts("FREQ=YEARLY;BYDAY=20MO", "19970519T090000", 3)).toEqual([
      "19970519T090000",
      "19980518T090000",
      "19990517T090000",
    ]);
    expect(starts("FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO", "19970512T090000", 3)).toEqual([
      "19970512T090000",
      "19980511T090000",
      "19990517T090000",
    ]);
  });

  it("every Thursday in March, and every Thursday in June to August", () => {
    expect(starts("FREQ=YEARLY;BYMONTH=3;BYDAY=TH", "19970313T090000", 11)).toEqual([
      ...at9(1997, "0313", "0320", "0327"),
      ...at9(1998, "0305", "0312", "0319", "0326"),
      ...at9(1999, "0304", "0311", "0318", "0325"),
    ]);
    const summer = starts("FREQ=YEARLY;BYDAY=TH;BYMONTH=6,7,8", "19970605T090000", 13);
    expect(summer).toEqual(
      at9(1997, ...["0605", "0612", "0619", "0626", "0703", "0710", "0717", "0724", "0731"]).concat(
        at9(1997, "0807", "0814", "0821", "0828"),
      ),
    );
  });

  it("every Friday the 13th, with DTSTART left out by EXDATE", () => {
    const list = starts(
      "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13",
      T,
      6,
      wallOf(parseTime("20010101") as never),
    );
    // DTSTART always comes first; the RFC's EXDATE removes it in the events layer.
    expect(list).toEqual([
      "19970902T090000",
      ...at9(1998, "0213", "0313", "1113"),
      ...at9(1999, "0813"),
      ...at9(2000, "1013"),
    ]);
  });

  it("the first Saturday after the first Sunday, and US election day every 4 years", () => {
    expect(
      starts("FREQ=MONTHLY;BYDAY=SA;BYMONTHDAY=7,8,9,10,11,12,13", "19970913T090000", 10),
    ).toEqual([
      ...at9(1997, "0913", "1011", "1108", "1213"),
      ...at9(1998, "0110", "0207", "0307", "0411", "0509", "0613"),
    ]);
    expect(
      starts(
        "FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8",
        "19961105T090000",
        3,
        wallOf(parseTime("20100101") as never),
      ),
    ).toEqual(["19961105T090000", "20001107T090000", "20041102T090000"]);
  });

  it("BYSETPOS: the third of Tuesday to Thursday, and the second-to-last weekday", () => {
    expect(starts("FREQ=MONTHLY;COUNT=3;BYDAY=TU,WE,TH;BYSETPOS=3", "19970904T090000")).toEqual(
      at9(1997, "0904", "1007", "1106"),
    );
    expect(starts("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2", "19970929T090000", 7)).toEqual([
      ...at9(1997, "0929", "1030", "1127", "1230"),
      ...at9(1998, "0129", "0226", "0330"),
    ]);
  });

  it("every 3 hours, every 15 minutes, and every hour and a half", () => {
    // The RFC's UNTIL here is 17:00Z, before the 15:00 local it lists (erratum 3883); 21:00Z is meant.
    expect(starts("FREQ=HOURLY;INTERVAL=3;UNTIL=19970902T210000Z", T)).toEqual([
      "19970902T090000",
      "19970902T120000",
      "19970902T150000",
    ]);
    expect(starts("FREQ=MINUTELY;INTERVAL=15;COUNT=6", T)).toEqual([
      "19970902T090000",
      "19970902T091500",
      "19970902T093000",
      "19970902T094500",
      "19970902T100000",
      "19970902T101500",
    ]);
    expect(starts("FREQ=MINUTELY;INTERVAL=90;COUNT=4", T)).toEqual([
      "19970902T090000",
      "19970902T103000",
      "19970902T120000",
      "19970902T133000",
    ]);
  });

  it("every 20 minutes from 9:00 to 16:40 every day, written two ways", () => {
    const daily = starts("FREQ=DAILY;BYHOUR=9,10,11,12,13,14,15,16;BYMINUTE=0,20,40", T, 48);
    const minutely = starts("FREQ=MINUTELY;INTERVAL=20;BYHOUR=9,10,11,12,13,14,15,16", T, 48);
    expect(daily).toHaveLength(48);
    expect(minutely).toEqual(daily);
    expect(daily.slice(22, 26)).toEqual([
      "19970902T162000",
      "19970902T164000",
      "19970903T090000",
      "19970903T092000",
    ]);
  });

  it("WKST changes which days a two-week rule takes", () => {
    expect(starts("FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO", "19970805T090000")).toEqual(
      at9(1997, "0805", "0810", "0819", "0824"),
    );
    expect(starts("FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU", "19970805T090000")).toEqual(
      at9(1997, "0805", "0817", "0819", "0831"),
    );
  });

  it("an invalid date (February 30) is skipped, not moved", () => {
    expect(starts("FREQ=MONTHLY;BYMONTHDAY=15,30;COUNT=5", "20070115T090000")).toEqual(
      at9(2007, "0115", "0130", "0215", "0315", "0330"),
    );
  });
});

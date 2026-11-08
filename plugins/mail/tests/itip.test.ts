import { describe, expect, it } from "vitest";
import { whenLine } from "../ui/format.js";
import { parse, prop, props } from "../ui/ical/component.js";
import {
  myAttendee,
  readCalendar,
  replyBody,
  replyCalendar,
  replySubject,
  supersedes,
} from "../ui/ical/itip.js";
import { INVITE, ME } from "./harness";

const NOW = Date.UTC(2026, 9, 30);

describe("reading an iTIP message", () => {
  it("reads a REQUEST: the method, the event, the organizer and the attendees with their status", () => {
    const { method, invitations, problems } = readCalendar(INVITE, "Asia/Seoul");
    expect(method).toBe("REQUEST");
    expect(problems).toEqual([]);
    const [invitation] = invitations;
    expect(invitation).toMatchObject({
      method: "REQUEST",
      uid: "review-7@example.com",
      sequence: 2,
      dtstamp: Date.UTC(2026, 9, 29, 2),
      summary: "Design review",
      location: "Room 1",
      description: "Slides first, then questions.",
      allDay: false,
      organizer: { name: "Mina", email: "mina@example.com" },
      status: "CONFIRMED",
      exceptions: 0,
    });
    expect(invitation?.start).toMatchObject({ utc: Date.UTC(2026, 10, 3, 7), zone: "Asia/Seoul" });
    expect(invitation?.end.utc).toBe(Date.UTC(2026, 10, 3, 8));
    expect(invitation?.attendees).toEqual([
      { name: "Me", email: ME, partstat: "NEEDS-ACTION", role: "REQ-PARTICIPANT", rsvp: true },
      { name: "Jun", email: "jun@example.com", partstat: "ACCEPTED", rsvp: false },
    ]);
  });

  it("fills in the end from DURATION, a day for a date, the same instant for a bare time", () => {
    const base = (lines: string[]) =>
      readCalendar(
        ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:u", ...lines, "END:VEVENT", "END:VCALENDAR"].join(
          "\n",
        ),
        "UTC",
      ).invitations[0];
    const timed = base(["DTSTART:20261103T070000Z", "DURATION:PT45M"]);
    expect(timed?.end.utc).toBe(Date.UTC(2026, 10, 3, 7, 45));
    const day = base(["DTSTART;VALUE=DATE:20261103"]);
    expect(day).toMatchObject({ allDay: true });
    expect((day?.end.wall ?? 0) - (day?.start.wall ?? 0)).toBe(86_400_000);
    const instant = base(["DTSTART:20261103T070000Z"]);
    expect(instant?.end.utc).toBe(instant?.start.utc);
    expect(base(["DTSTART:20261103T070000Z", "DTEND:20261103T060000Z"])?.end.utc).toBe(
      Date.UTC(2026, 10, 3, 7),
    );
    expect(base(["SUMMARY:no start"])).toBeUndefined();
  });

  it("reads a CANCEL as cancelled, keeps the RRULE as written, counts exceptions, flags problems", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "METHOD:CANCEL",
      "BEGIN:VEVENT",
      "UID:series",
      "RECURRENCE-ID;TZID=Asia/Seoul:20261110T160000",
      "DTSTART;TZID=Asia/Seoul:20261103T160000",
      "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=5",
      "EXDATE;TZID=Asia/Seoul:20261117T160000",
      "EXDATE;TZID=Asia/Seoul:20261124T160000",
      "SUMMARY:Weekly",
      "nonsense",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const reading = readCalendar(text, "Asia/Seoul");
    expect(reading.method).toBe("CANCEL");
    expect(reading.invitations[0]).toMatchObject({
      status: "CANCELLED",
      rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=5",
      exceptions: 2,
      recurrenceId: "20261110T160000",
    });
    expect(reading.problems).toEqual(["Line 11 is not a property."]);
    expect(readCalendar("not a calendar").problems).toContain(
      "The calendar part holds no VCALENDAR.",
    );
  });

  it("finds the person among the attendees by address, in any case", () => {
    const [invitation] = readCalendar(INVITE).invitations;
    expect(myAttendee(invitation as never, ["ME@EXAMPLE.COM"])?.name).toBe("Me");
    expect(myAttendee(invitation as never, ["nobody@example.com"])).toBeUndefined();
  });

  it("knows a newer revision by SEQUENCE, then by DTSTAMP", () => {
    const [a] = readCalendar(INVITE).invitations;
    const [b] = readCalendar(INVITE.replace("SEQUENCE:2", "SEQUENCE:3")).invitations;
    const [c] = readCalendar(
      INVITE.replace("DTSTAMP:20261029T020000Z", "DTSTAMP:20261029T030000Z"),
    ).invitations;
    const [d] = readCalendar(INVITE.replace("UID:review-7@example.com", "UID:other")).invitations;
    expect(supersedes(a as never, b as never)).toBe(true);
    expect(supersedes(b as never, a as never)).toBe(false);
    expect(supersedes(a as never, c as never)).toBe(true);
    expect(supersedes(a as never, d as never)).toBe(false);
  });
});

describe("answering (RFC 5546 §3.2.3, RFC 6047)", () => {
  const invitation = () =>
    readCalendar(INVITE).invitations[0] as NonNullable<
      ReturnType<typeof readCalendar>["invitations"][0]
    >;

  it("writes a METHOD:REPLY with the one attendee and the organizer's values echoed", () => {
    const me = myAttendee(invitation(), [ME]);
    const ics = replyCalendar(invitation(), me as never, "ACCEPTED", NOW);
    expect(ics.split("\r\n").slice(0, 4)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//endue//Desk Mail 0.1//EN",
      "METHOD:REPLY",
    ]);
    const { calendars } = parse(ics);
    const event = calendars[0]?.components.find((c) => c.name === "VEVENT");
    expect(event).toBeDefined();
    const e = event as NonNullable<typeof event>;
    expect(prop(e, "UID")?.value).toBe("review-7@example.com");
    expect(prop(e, "SEQUENCE")?.value).toBe("2");
    expect(prop(e, "DTSTAMP")?.value).toBe("20261030T000000Z");
    expect(prop(e, "ORGANIZER")).toEqual({
      name: "ORGANIZER",
      params: { CN: ["Mina"] },
      value: "mailto:mina@example.com",
    });
    expect(props(e, "ATTENDEE")).toEqual([
      { name: "ATTENDEE", params: { CN: ["Me"], PARTSTAT: ["ACCEPTED"] }, value: `mailto:${ME}` },
    ]);
    expect(prop(e, "DTSTART")).toEqual({
      name: "DTSTART",
      params: { TZID: ["Asia/Seoul"] },
      value: "20261103T160000",
    });
    expect(prop(e, "SUMMARY")?.value).toBe("Design review");
    expect(prop(e, "LOCATION")).toBeUndefined();
  });

  it("carries the VTIMEZONE the times need, and the RECURRENCE-ID of one instance", () => {
    const text = INVITE.replace(
      "BEGIN:VEVENT",
      [
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Seoul",
        "BEGIN:STANDARD",
        "DTSTART:19881009T030000",
        "TZOFFSETFROM:+1000",
        "TZOFFSETTO:+0900",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "RECURRENCE-ID;TZID=Asia/Seoul:20261103T160000",
      ].join("\r\n"),
    );
    const [inv] = readCalendar(text).invitations;
    const ics = replyCalendar(inv as never, { email: ME }, "DECLINED", NOW);
    const { calendars } = parse(ics);
    expect(calendars[0]?.components.map((c) => c.name)).toEqual(["VTIMEZONE", "VEVENT"]);
    const event = calendars[0]?.components[1];
    expect(prop(event as never, "RECURRENCE-ID")?.value).toBe("20261103T160000");
    expect(props(event as never, "ATTENDEE")[0]?.params).toEqual({ PARTSTAT: ["DECLINED"] });
  });

  it("refuses an answer without an address or an organizer", () => {
    expect(() => replyCalendar(invitation(), { name: "Me" }, "ACCEPTED", NOW)).toThrow(
      "email address",
    );
    const [noOrganizer] = readCalendar(INVITE.replace(/ORGANIZER.*\r\n/, "")).invitations;
    expect(() => replyCalendar(noOrganizer as never, { email: ME }, "ACCEPTED", NOW)).toThrow(
      "organizer",
    );
  });

  it("writes the subject and one sentence for people without calendar software", () => {
    expect(replySubject("ACCEPTED", invitation())).toBe("Accepted: Design review");
    expect(replySubject("TENTATIVE", invitation())).toBe("Tentative: Design review");
    expect(replySubject("DECLINED", invitation())).toBe("Declined: Design review");
    expect(replyBody({ name: "Me", email: ME }, "TENTATIVE", invitation())).toBe(
      "Me has tentatively accepted the invitation: Design review.",
    );
  });

  it("says when the meeting is, in the person's zone and in the organizer's when it differs", () => {
    const inv = invitation();
    const clock = { locale: "en-GB", zone: "Europe/Berlin" };
    expect(whenLine(inv, clock)).toEqual({
      line: "Tue, 3 Nov 2026, 08:00 – 09:00",
      elsewhere: "16:00 – 17:00 in Asia/Seoul",
    });
    expect(whenLine(inv, { locale: "en-GB", zone: "Asia/Seoul" })).toEqual({
      line: "Tue, 3 Nov 2026, 16:00 – 17:00",
    });
    const day = readCalendar(
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:d\nDTSTART;VALUE=DATE:20261103\nDTEND;VALUE=DATE:20261105\nEND:VEVENT\nEND:VCALENDAR",
    ).invitations[0];
    expect(whenLine(day as never, clock).line).toBe("Tue, 3 Nov 2026 – Wed, 4 Nov 2026 (all day)");
    const floating = readCalendar(
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:f\nDTSTART:20261103T160000\nEND:VEVENT\nEND:VCALENDAR",
      "Europe/Berlin",
    ).invitations[0];
    expect(whenLine(floating as never, clock).note).toContain("Written without a time zone");
  });
});

import { describe, expect, it } from "vitest";
import {
  formatAddress,
  formatAddresses,
  forwardDraft,
  newDraft,
  parseAddress,
  parseAddresses,
  prefixed,
  problemsOf,
  quoted,
  replyDraft,
  sendArgs,
  threading,
} from "../ui/compose.js";
import { messageOf } from "../ui/model.js";
import { ME, sample } from "./harness";

const lunch = () => messageOf(sample()[0] as never);
const NOW = "2026-10-30T00:00:00Z";

describe("addresses", () => {
  it("reads the common forms and refuses the rest", () => {
    expect(parseAddress("Mina <Mina@Example.com>")).toEqual({
      name: "Mina",
      email: "mina@example.com",
    });
    expect(parseAddress('"Park, Jun" <jun@example.com>')).toEqual({
      name: "Park, Jun",
      email: "jun@example.com",
    });
    expect(parseAddress("<a@b.co>")).toEqual({ email: "a@b.co" });
    expect(parseAddress("a@b.co")).toEqual({ email: "a@b.co" });
    expect(parseAddress("nobody")).toBeUndefined();
    expect(parseAddress("Mina <not an address>")).toBeUndefined();
  });

  it("splits a line on commas and semicolons outside quotes, drops duplicates, keeps the bad parts", () => {
    const { people, invalid } = parseAddresses(
      '"Park, Jun" <jun@example.com>; mina@example.com, Mina <mina@example.com>, oops, <x@y.zz>',
    );
    expect(people).toEqual([
      { name: "Park, Jun", email: "jun@example.com" },
      { email: "mina@example.com" },
      { email: "x@y.zz" },
    ]);
    expect(invalid).toEqual(["oops"]);
    expect(parseAddresses("")).toEqual({ people: [], invalid: [] });
  });

  it("writes an address so it reads back the same", () => {
    expect(formatAddress({ name: "Mina", email: "mina@example.com" })).toBe(
      "Mina <mina@example.com>",
    );
    expect(formatAddress({ name: "Park, Jun", email: "jun@example.com" })).toBe(
      '"Park, Jun" <jun@example.com>',
    );
    expect(formatAddress({ email: "a@b.co" })).toBe("a@b.co");
    expect(formatAddress({ name: "Only a name" })).toBe("Only a name");
    const line = formatAddresses([
      { name: "Park, Jun", email: "jun@example.com" },
      { email: "a@b.co" },
    ]);
    expect(parseAddresses(line).people).toEqual([
      { name: "Park, Jun", email: "jun@example.com" },
      { email: "a@b.co" },
    ]);
  });
});

describe("drafts", () => {
  it("prefixes a subject once and quotes every line", () => {
    expect(prefixed("Re", "Lunch")).toBe("Re: Lunch");
    expect(prefixed("Re", "RE: Lunch")).toBe("Re: Lunch");
    expect(prefixed("Re", "re:Lunch")).toBe("Re: Lunch");
    expect(prefixed("Fwd", "FW: Lunch")).toBe("Fwd: Lunch");
    expect(prefixed("Fwd", "")).toBe("Fwd: (No subject)");
    expect(quoted("a\n> b\n\n")).toBe("> a\n>> b");
  });

  it("a reply goes to the sender with the original quoted and the threading headers", () => {
    const draft = replyDraft(lunch(), { signature: "-- me", now: NOW });
    expect(draft).toMatchObject({
      account: "acme.imap/work",
      to: "Mina <mina@example.com>",
      cc: "",
      subject: "Re: Lunch today?",
      inReplyTo: "<lunch-2@example.com>",
      references: ["<lunch-1@example.com>", "<lunch-2@example.com>"],
      replyTo: { source: { connector: "acme.imap", instance: "work" }, id: "m-lunch" },
      savedAt: NOW,
    });
    expect(draft.body).toBe(
      "\n\n-- me\n\nOn 2026-10-30T08:12:00+09:00, Mina <mina@example.com> wrote:\n> Still on for 12:30 at the bistro?\n",
    );
  });

  it("a reply to all leaves the person out and never repeats an address", () => {
    const message = {
      ...lunch(),
      to: [{ email: ME }, { name: "Jun", email: "jun@example.com" }],
      cc: [{ email: "jun@example.com" }, { email: "ci@example.com" }, { email: ME }],
    };
    const draft = replyDraft(message, { all: true, addresses: [ME.toUpperCase()], now: NOW });
    expect(draft.to).toBe("Mina <mina@example.com>, Jun <jun@example.com>");
    expect(draft.cc).toBe("ci@example.com");
    // When only the person was written to, the reply still goes to the sender.
    const own = { ...message, from: { email: ME }, to: [{ email: ME }], cc: [] };
    expect(replyDraft(own, { all: true, addresses: [ME], now: NOW }).to).toBe(ME);
  });

  it("a forward has no recipient and carries the original under a header block", () => {
    const draft = forwardDraft(lunch(), { now: NOW });
    expect(draft.to).toBe("");
    expect(draft.subject).toBe("Fwd: Lunch today?");
    expect(draft.body).toContain(
      "---------- Forwarded message ----------\nFrom: Mina <mina@example.com>\n",
    );
    expect(draft.body).toContain("Subject: Lunch today?\nTo: me@example.com\n");
    expect(draft.body).toContain("\n\nStill on for 12:30 at the bistro?\n");
    expect(draft.references).toEqual(["<lunch-1@example.com>", "<lunch-2@example.com>"]);
    expect(draft.inReplyTo).toBeUndefined();
    expect(threading({ ...lunch(), messageId: undefined })).toEqual({});
  });

  it("a new draft takes the command's arguments and the signature", () => {
    const draft = newDraft({
      to: "a@b.co",
      subject: "Hi",
      body: "Hello",
      signature: "-- me",
      now: NOW,
    });
    expect(draft).toMatchObject({
      to: "a@b.co",
      cc: "",
      bcc: "",
      subject: "Hi",
      body: "Hello\n\n-- me",
    });
    expect(draft.id).toMatch(/^d-/);
    expect(newDraft().body).toBe("");
  });

  it("names what stops a send, and shapes the connector's arguments", () => {
    const empty = newDraft({ now: NOW });
    expect(problemsOf(empty)).toEqual([
      "Choose the account to send from.",
      "Add at least one recipient.",
    ]);
    const bad = { ...empty, account: "acme.imap/work", to: "nobody, a@b.co", bcc: "x" };
    expect(problemsOf(bad)).toEqual([
      "nobody is not an email address.",
      "x is not an email address.",
    ]);
    const good = {
      ...empty,
      account: "acme.imap/work",
      to: "Mina <mina@example.com>",
      cc: "a@b.co",
      subject: "  ",
    };
    expect(problemsOf(good)).toEqual([]);
    expect(
      sendArgs({
        ...good,
        inReplyTo: "<x@y>",
        references: ["<x@y>"],
        calendar: { method: "REPLY", ics: "BEGIN:VCALENDAR" },
      }),
    ).toEqual({
      instance: "work",
      to: [{ name: "Mina", email: "mina@example.com" }],
      cc: [{ email: "a@b.co" }],
      subject: "(No subject)",
      body: "",
      inReplyTo: "<x@y>",
      references: ["<x@y>"],
      calendar: { method: "REPLY", ics: "BEGIN:VCALENDAR" },
    });
  });
});

describe("problemsOf without an account", () => {
  it("says no account is connected when there is none to choose from", () => {
    const draft = { ...newDraft({ now: NOW }), to: "mina@example.com", account: "" };
    expect(problemsOf(draft, [])).toEqual(["No mail account is connected yet."]);
    expect(problemsOf(draft, ["acme.imap/work"])).toEqual(["Choose the account to send from."]);
  });
});

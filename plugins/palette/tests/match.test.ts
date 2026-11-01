import { describe, expect, it } from "vitest";
import { filter, remember, score } from "../ui/match.js";

type Entry = { id: string };

const commands = [
  { id: "desk.theme.toggle", label: "Switch between light and dark", keywords: ["theme"] },
  { id: "desk.buffers.switch", label: "Switch to a buffer", keywords: ["buffers"] },
  { id: "desk.files.open", label: "Open a file", keywords: ["find-file"] },
  { id: "desk.notify.dnd", label: "Turn do not disturb on or off", keywords: ["focus"] },
];

describe("score", () => {
  it("needs the query's characters in order", () => {
    expect(score("opf", "Open a file")).toBeGreaterThan(0);
    expect(score("fpo", "Open a file")).toBe(0);
    expect(score("", "anything")).toBe(1);
  });

  it("prefers runs and word starts", () => {
    expect(score("open", "Open a file")).toBeGreaterThan(score("open", "reopen a file"));
    expect(score("af", "Open a file")).toBeGreaterThan(score("af", "leaf"));
  });
});

describe("filter", () => {
  it("matches labels, ids and keywords, best first", () => {
    // Both labels start with the word; the shorter one is the closer match.
    expect(filter("switch", commands).map((c: Entry) => c.id)).toEqual([
      "desk.buffers.switch",
      "desk.theme.toggle",
    ]);
    expect(filter("find-file", commands).map((c: Entry) => c.id)).toEqual(["desk.files.open"]);
    expect(filter("buffer", commands)[0]?.id).toBe("desk.buffers.switch");
    expect(filter("zzz", commands)).toEqual([]);
  });

  it("puts recently run commands first while nothing is typed", () => {
    const history = ["desk.notify.dnd", "desk.files.open"];
    expect(filter("", commands, history).map((c: Entry) => c.id)).toEqual([
      "desk.notify.dnd",
      "desk.files.open",
      "desk.theme.toggle",
      "desk.buffers.switch",
    ]);
  });
});

describe("remember", () => {
  it("moves a command to the front and keeps the history short", () => {
    expect(remember(["a", "b", "c"], "c", 3)).toEqual(["c", "a", "b"]);
    expect(remember(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
    expect(remember([], "a", 0)).toEqual([]);
  });
});

describe("score: where the characters may land", () => {
  it("does not match letters scattered inside words", () => {
    expect(score("keyboard", "Quit what is in progress")).toBe(0);
    expect(score("theme", "Switch between light and dark")).toBe(0);
    expect(score("af", "leaf")).toBe(0);
  });

  it("leaves fragmented matches out once a command holds the query whole", () => {
    const mail = { id: "endue.mail.forward", label: "Forward the open message" };
    expect(filter("theme", [...commands, mail]).map((c: Entry) => c.id)).toEqual([
      "desk.theme.toggle",
    ]);
    expect(filter("fom", [mail]).map((c: Entry) => c.id)).toEqual(["endue.mail.forward"]);
  });

  it("still matches runs and word starts", () => {
    expect(score("theme", "theme")).toBeGreaterThan(0);
    expect(score("light dark", "Switch between light and dark")).toBeGreaterThan(0);
    expect(score("opf", "Open a file")).toBeGreaterThan(0);
    expect(score("show a plugin", "Show a plugin's surface")).toBeGreaterThan(0);
  });
});

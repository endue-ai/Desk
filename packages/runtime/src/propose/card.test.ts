// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CardContent, createCard } from "./card";
import type { KeyRow } from "./keys-table";

const NOTE = "Eris made this from “make a quiet night profile with only notes and terminal”.";
const PROFILE: CardContent = {
  kind: "profile",
  title: "Quiet night",
  model: {
    id: "quiet-night",
    name: "Quiet night",
    description: "Notes and a terminal, and nothing that interrupts.",
    desktops: [
      {
        desktop: 1,
        windows: [
          { id: "notes", plugin: "endue.notes", title: "Notes", x: 144, y: 90, w: 720, h: 450 },
          {
            id: "terminal",
            plugin: "endue.terminal",
            title: "Terminal",
            x: 720,
            y: 450,
            w: 576,
            h: 360,
          },
        ],
      },
    ],
    on: [{ id: "endue.terminal", name: "Terminal" }],
    off: [
      { id: "endue.calendar", name: "Calendar" },
      { id: "endue.mail", name: "Mail" },
    ],
    same: 7,
    settings: [{ name: "desk.notify.dnd", from: false, to: true }],
  },
};
const NEW = { command: "endue.terminal.new", title: "New terminal", owner: "endue.terminal" };
const FOCUS: KeyRow = {
  key: "⇧⌘T",
  combo: "Meta+Shift+T",
  command: "endue.terminal.focus",
  title: "Focus the terminal",
  now: NEW,
  marks: ["taken"],
};
const KEYS: CardContent = {
  kind: "keys",
  title: "⇧⌘T → Focus the terminal",
  rows: [FOCUS, { key: "⌥⌘T", combo: "Meta+Alt+T", command: "", title: "", marks: [] }],
};

const texts = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent?.trim());
const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector);
const press = (key: string) =>
  document
    .querySelector(".proposal")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

afterEach(() => document.body.replaceChildren());

describe("the proposal card", () => {
  it("draws a profile as a ghost of its desktops, the plugins it turns on and off and the settings it changes; Apply answers", async () => {
    const card = createCard(document.body);
    const choice = card.preview(PROFILE, NOTE);
    const el = document.querySelector('.proposal[data-proposal="profile"]');
    expect(el?.getAttribute("data-state")).toBe("preview");
    expect(el?.querySelector(".proposal-title")?.textContent).toBe("Quiet night");
    expect(el?.querySelector(".proposal-note")?.textContent).toBe(NOTE);
    const desktop = el?.querySelector('.ghost-desktop[data-desktop="1"]');
    expect(desktop?.getAttribute("aria-label")).toBe("Desktop 1: Notes, Terminal");
    const windows = [...(desktop?.querySelectorAll<HTMLElement>(".ghost-window") ?? [])];
    expect(windows.map((w) => w.textContent)).toEqual(["Notes", "Terminal"]);
    expect(windows.map((w) => [w.style.left, w.style.top, w.style.width, w.style.height])).toEqual([
      ["10%", "10%", "50%", "50%"],
      ["50%", "50%", "40%", "40%"],
    ]);
    expect(texts(el as Element, '.ghost-plugins [data-change="on"] li')).toEqual(["Terminal"]);
    expect(texts(el as Element, '.ghost-plugins [data-change="off"] li')).toEqual([
      "Calendar",
      "Mail",
    ]);
    expect(el?.querySelector(".ghost-same")?.textContent).toBe("7 other plugins stay as they are.");
    expect(texts(el as Element, ".ghost-settings td")).toEqual(["desk.notify.dnd", "off", "on"]);
    expect(document.activeElement).toBe(button('[data-choice="apply"]'));

    button('[data-choice="apply"]')?.click();
    expect(await choice).toEqual({ choice: "apply" });
    expect(el?.getAttribute("data-state")).toBe("busy");
    expect(el?.querySelector(".proposal-note")?.textContent).toBe("Saving…");
    expect(button('[data-choice="retry"]')?.disabled).toBe(true);
  });

  it("draws key bindings as a table with their conflicts marked; Try again sends the correction", async () => {
    const card = createCard(document.body);
    const choice = card.preview(
      KEYS,
      "Eris made this from “bind Mod+Shift+T to open the terminal”.",
    );
    const rows = [...document.querySelectorAll(".proposal-keys tbody tr")];
    expect(rows.map((row) => row.getAttribute("data-marks"))).toEqual(["taken", ""]);
    expect(texts(rows[0] as Element, "td")).toEqual([
      "⇧⌘T",
      "Focus the terminal",
      "New terminal",
      "Taken from New terminal",
    ]);
    expect(texts(rows[1] as Element, "td")).toEqual([
      "⌥⌘T",
      "Nothing: the key is taken away",
      "",
      "",
    ]);
    const field = document.querySelector<HTMLInputElement>(".proposal-correction");
    if (field) field.value = "use Mod+Shift+Y instead";
    button('[data-choice="retry"]')?.click();
    expect(await choice).toEqual({ choice: "retry", correction: "use Mod+Shift+Y instead" });
    expect(document.querySelector(".proposal-note")?.textContent).toBe("Eris is trying again…");
  });

  it("marks two proposals on one chord and one already bound", () => {
    const card = createCard(document.body);
    void card.preview(
      {
        kind: "keys",
        title: "2 key bindings",
        rows: [
          { ...FOCUS, marks: ["taken", "twice"] },
          {
            ...FOCUS,
            command: "endue.terminal.new",
            title: "New terminal",
            marks: ["twice", "same"],
          },
        ],
      },
      "",
    );
    expect(texts(document, ".proposal-mark")).toEqual([
      "Taken from New terminal",
      "Twice in this proposal",
      "Twice in this proposal",
      "Already bound",
    ]);
  });

  it("Discard and Escape answer discard and take the card away; a newer preview discards the older", async () => {
    const card = createCard(document.body);
    const first = card.preview(PROFILE, NOTE);
    const second = card.preview(KEYS, "");
    expect(await first).toEqual({ choice: "discard" });
    expect(document.querySelectorAll(".proposal")).toHaveLength(1);
    expect(document.querySelector(".proposal")?.getAttribute("data-proposal")).toBe("keys");
    press("Escape");
    expect(await second).toEqual({ choice: "discard" });
    expect(document.querySelector(".proposal")).toBeNull();

    const third = card.preview(PROFILE, NOTE);
    button('[data-choice="discard"]')?.click();
    expect(await third).toEqual({ choice: "discard" });
    expect(document.querySelector(".proposal")).toBeNull();
  });

  it("once applied the card says so with Undo, which runs the inverse; Close takes it away", async () => {
    const card = createCard(document.body);
    void card.preview(PROFILE, NOTE);
    const undo = vi.fn();
    card.applied(PROFILE, "Eris made this profile and switched to it.", undo);
    const el = document.querySelector(".proposal");
    expect(el?.getAttribute("data-state")).toBe("applied");
    expect(el?.querySelector(".proposal-note")?.textContent).toBe(
      "Eris made this profile and switched to it.",
    );
    expect(el?.querySelector(".proposal-correction")).toBeNull();
    expect(texts(el as Element, ".proposal-actions button")).toEqual(["Undo", "Close"]);
    expect(document.activeElement).toBe(button('[data-action="undo"]'));
    button('[data-action="undo"]')?.click();
    expect(undo).toHaveBeenCalledTimes(1);
    button('[data-action="close"]')?.click();
    expect(document.querySelector(".proposal")).toBeNull();
    card.close();
    expect(document.querySelector(".proposal")).toBeNull();
  });

  it("an applied card offers the next steps before Undo, the first in focus; each runs and the card stays", () => {
    const card = createCard(document.body);
    const open = vi.fn();
    const undo = vi.fn();
    const steps = [{ label: "Open GitHub board", run: open }];
    card.applied(PACK, "GitHub is on.", undo, steps);
    const el = document.querySelector(".proposal");
    expect(texts(el as Element, ".proposal-actions button")).toEqual([
      "Open GitHub board",
      "Undo",
      "Close",
    ]);
    const next = button('[data-action="next"]');
    expect(document.activeElement).toBe(next);
    expect(next?.classList.contains("is-primary")).toBe(true);
    expect(button('[data-action="undo"]')?.classList.contains("is-primary")).toBe(false);
    next?.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(document.querySelector(".proposal")?.getAttribute("data-state")).toBe("applied");
    card.close();
  });
});

const PACK: CardContent = {
  kind: "pack",
  title: "GitHub pack",
  rows: [
    ["Connector", "GitHub"],
    ["Opens", "GitHub board"],
  ],
};

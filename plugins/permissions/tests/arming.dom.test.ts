// @vitest-environment jsdom
// The question takes no keys typed in the moment it opens (PG-01g, ADR 0335): a person typing in a
// plugin when a card comes up must not answer it with the next key. For a short arming delay Space,
// Enter and Escape answer nothing and the focus stays on the safe answer; a key pressed then stays
// swallowed until it is released; after the delay the keys answer; a pointer press answers at once.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ARM_MS } from "../ui/arming.js";
import { createView } from "../ui/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

const model = {
  promptId: "p-1",
  title: "Shop wants to connect",
  caller: { kind: "plugin", id: "endue.database" },
  permission: "db:connect",
  scope: "db.example:5432",
  reason: "To run SQL on Shop",
  duration: "session",
  waiting: 0,
  preferPersistent: false,
};

/** The view of the case before: its listeners stay on the document, so its card is put away. */
let last: { prompt(model: null): void } | undefined;

function opened(preferPersistent = false) {
  let clock = 1000;
  const answers: string[] = [];
  const keys: string[] = [];
  const view = createView(
    document,
    {
      revoke: () => {},
      allow: () => {},
      answer: (choice: string) => void answers.push(choice),
      key: (key: string) => {
        keys.push(key);
        if (key !== "Escape") return false;
        answers.push("refuse");
        return true;
      },
      close: () => {},
      dismiss: () => {},
    } as never,
    {
      now: () => clock,
      setTimer: (fn: () => void, ms: number) => void timers.push({ at: clock + ms, fn }),
    },
  );
  const timers: Array<{ at: number; fn: () => void }> = [];
  view.prompt({ ...model, preferPersistent } as never);
  last = view;
  const later = (ms: number) => {
    clock += ms;
    for (const timer of timers.splice(0)) if (timer.at <= clock) timer.fn();
  };
  return { view, answers, keys, later };
}

const focused = () => (document.activeElement as HTMLElement | null)?.textContent;
/** A key as a hand types it: down, then up; Enter and Space on a button press it as a browser does. */
function type(key: string) {
  const target = (document.activeElement ?? document.body) as HTMLElement;
  const down = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(down);
  if (key === "Enter" && !down.defaultPrevented && target instanceof HTMLButtonElement)
    target.click();
  const up = new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(up);
  if (key === " " && !up.defaultPrevented && target instanceof HTMLButtonElement) target.click();
}

describe("the question's arming delay (PG-01g)", () => {
  beforeEach(() => {
    last?.prompt(null);
    document.body.innerHTML = body;
  });

  it("keys typed in the moment the question opens answer nothing", () => {
    const t = opened();
    expect(focused()).toBe("Don't allow");
    for (const key of [" ", "Enter", "Escape", "a"]) type(key);
    expect(t.answers).toEqual([]);
    expect(focused()).toBe("Don't allow");
    expect(document.getElementById("prompt")?.hasAttribute("data-armed")).toBe(false);

    t.later(ARM_MS);
    expect(document.getElementById("prompt")?.hasAttribute("data-armed")).toBe(true);
    type("Enter");
    expect(t.answers).toEqual(["refuse"]);
  });

  it("a key pressed in the delay stays swallowed until it is released", () => {
    const t = opened();
    const button = document.activeElement as HTMLElement;
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
    );
    t.later(ARM_MS);
    const up = new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true });
    button.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    if (!up.defaultPrevented) button.click();
    expect(t.answers).toEqual([]);
  });

  it("a pointer press answers at once", () => {
    const t = opened();
    const allow = document.querySelector<HTMLButtonElement>("#prompt [data-answer=once]");
    allow?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(t.answers).toEqual(["once"]);
  });

  it("offers Always allow first for built-ins and leaves refusal focused", () => {
    const t = opened(true);
    const choices = [
      ...document.querySelectorAll<HTMLButtonElement>("#prompt button:not([hidden])"),
    ];
    expect(choices.map((choice) => choice.dataset.answer)).toEqual([
      "always",
      "session",
      "once",
      "refuse",
    ]);
    expect(choices[0]?.classList.contains("desk-btn-primary")).toBe(true);
    const note = document.getElementById("prompt-revoke");
    expect(note?.hidden).toBe(false);
    expect(note?.textContent).toMatch(/revoke this permission in Permissions/);
    expect(focused()).toBe("Don't allow");
    choices[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(t.answers).toEqual(["always"]);

    t.view.prompt({ ...model, promptId: "p-2" } as never);
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("#prompt button:not([hidden])")].map(
        (choice) => choice.dataset.answer,
      ),
    ).toEqual(["once", "session", "always", "refuse"]);
    expect(choices[0]?.classList.contains("desk-btn-primary")).toBe(false);
    expect(note?.hidden).toBe(true);
  });

  it("explains what each answer permits for an agent's write scope", () => {
    const t = opened();
    t.view.prompt({
      ...model,
      promptId: "p-agent",
      caller: { kind: "Agent", id: "agent:eris" },
      permissionKind: "fs:write",
    } as never);
    const effects = document.getElementById("prompt-effects");
    expect(effects?.hidden).toBe(false);
    expect(effects?.textContent).toMatch(/once.*one reversible write/i);
    expect(effects?.textContent).toMatch(/session.*reversible writes.*until.*session ends/i);
    expect(effects?.textContent).toMatch(/always.*until.*revoke/i);
    expect(effects?.textContent).toMatch(/non-reversible writes still ask/i);
  });

  it("a click a key makes in the delay answers nothing", () => {
    const t = opened();
    const refuse = document.querySelector<HTMLButtonElement>("#prompt [data-answer=refuse]");
    refuse?.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
    );
    refuse?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(t.answers).toEqual([]);
  });
});

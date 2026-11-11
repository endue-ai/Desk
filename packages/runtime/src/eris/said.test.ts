// @vitest-environment jsdom
// Her words on the desk can be read whole and found again (#161 findings 6 and 12, #158 finding
// 14): the card stays inside the desk wherever she floats, a long line is kept as text, and her
// last lines come back on "Show what Eris said".
import { describe, expect, it } from "vitest";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import { prose } from "./prose";
import { isLong, mountSaid, placeSaid, SAID } from "./said";
import { REFUSED_LINES } from "./talk";

const DESK = { width: 1280, height: 800 };
const her = (x: number, y: number) => ({ x, y, width: 128, height: 138 });

describe("where her card goes", () => {
  it("under her, centred on her, as wide as the soul text was", () => {
    expect(placeSaid(her(576, 40), DESK)).toEqual({
      left: 400,
      top: 190,
      width: 480,
      maxHeight: 594,
    });
  });

  it("inside the desk with 16 px to spare when she floats at an edge", () => {
    expect(placeSaid(her(0, 40), DESK).left).toBe(16);
    const right = placeSaid(her(1152, 40), DESK);
    expect(right.left + right.width).toBe(DESK.width - 16);
  });

  it("above her when there is more room above, never past the desk's edges", () => {
    const low = placeSaid(her(576, 640), DESK);
    expect(low).toEqual({ left: 400, bottom: 172, width: 480, maxHeight: 612 });
    const narrow = placeSaid(her(0, 40), { width: 400, height: 500 });
    expect(narrow.width).toBe(368);
  });
});

describe("what is kept as text", () => {
  it("a line longer than one line of soul text, or of more than one paragraph", () => {
    expect(isLong("Good morning. Eris has your day ready.")).toBe(false);
    expect(isLong("Something went wrong on my side. Try that again in a moment.")).toBe(false);
    expect(isLong("x".repeat(61))).toBe(true);
    expect(isLong("one\ntwo")).toBe(true);
    // Her refusal line is a spoken line: soul text that leaves, not a card to close.
    expect(isLong(REFUSED_LINES.en) || isLong(REFUSED_LINES.ko)).toBe(false);
  });

  it("reads as a person reads it: lines, bullets, bold and code, never markup", () => {
    const blocks = prose(
      document,
      "# Plan\n\n- **one** thing\n- `two`\n\n<img src=x onerror=alert(1)>",
    );
    expect(blocks.map((b) => b.textContent)).toEqual([
      "Plan",
      "• one thing• two",
      "<img src=x onerror=alert(1)>",
    ]);
    expect(blocks[1]?.querySelector("strong")?.textContent).toBe("one");
    expect(blocks[1]?.querySelector("code")?.textContent).toBe("two");
    expect(blocks[1]?.querySelectorAll("br")).toHaveLength(1);
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("her card", () => {
  function desk() {
    const commands = new Map<string, () => unknown>();
    const ctx = {
      store: new Store(emptyState("en")),
      runtime: {
        commands: {
          define: (id: string, spec: { run: () => unknown }) => {
            commands.set(id, spec.run);
            return () => commands.delete(id);
          },
        },
      },
    } as unknown as ShellCtx;
    const soul = document.createElement("div");
    soul.className = "soul";
    const said = mountSaid(document.body, ctx, soul);
    const card = () => document.querySelector<HTMLElement>(".eris-said");
    const text = () => card()?.querySelector(".eris-said-text")?.textContent ?? "";
    return { said, card, text, soul, commands };
  }

  it("keeps a long line until the person closes it, and brings her last lines back", () => {
    const d = desk();
    const long = "a long answer ".repeat(10).trim();
    expect(d.said.say(long)).toBe(true);
    d.said.update(false);
    expect(d.card()?.hidden).toBe(false);
    expect(d.card()?.classList.contains("popover")).toBe(true);
    expect(d.text()).toBe(long);
    d.card()?.querySelector<HTMLButtonElement>(".eris-said-close")?.click();
    expect(d.card()?.hidden).toBe(true);
    expect(d.said.say("Short.")).toBe(false);
    d.commands.get(SAID)?.();
    d.said.update(false);
    expect(d.card()?.hidden).toBe(false);
    expect(
      [...(d.card()?.querySelectorAll(".eris-said-text p") ?? [])].map((p) => p.textContent),
    ).toEqual([long, "Short."]);
    d.card()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(d.card()?.hidden).toBe(true);
    d.said.dispose();
  });

  it("shows a short line while its soul text shows, and a new line ends a kept one", () => {
    const d = desk();
    d.said.say("x".repeat(80));
    expect(d.said.say("Done.")).toBe(false);
    d.said.update(true);
    expect(d.card()?.hidden).toBe(false);
    expect(d.text()).toBe("");
    d.said.update(false);
    expect(d.card()?.hidden).toBe(true);
    d.said.dispose();
    expect(d.card()).toBeNull();
  });
});

// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createAsk } from "../ui/ask.js";

const ui = join(import.meta.dirname, "../ui");
const page = readFileSync(join(ui, "index.html"), "utf8");
const body = page.slice(page.indexOf("<body>") + 6, page.indexOf('<script type="module"'));
const question = {
  title: "Forget every fact?",
  text: "Eris will no longer know…",
  yes: "Forget 2 facts",
};

describe("the page's own question", () => {
  let ask: ReturnType<typeof createAsk>;
  const dialog = () => document.getElementById("ask-dialog") as HTMLElement;
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = body;
    ask = createAsk(document);
  });

  it("opens the dialog with the question's words, and Forget is yes", async () => {
    const answer = ask(question);
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(dialog().getAttribute("label")).toBe("Forget every fact?");
    expect(document.getElementById("ask-title")?.textContent).toBe("Forget every fact?");
    expect(document.getElementById("ask-text")?.textContent).toBe("Eris will no longer know…");
    expect(button("ask-yes").textContent).toBe("Forget 2 facts");
    expect(button("ask-yes").className).toContain("desk-btn-danger");
    button("ask-yes").click();
    await expect(answer).resolves.toBe(true);
    expect(dialog().hasAttribute("open")).toBe(false);
  });

  it("answers no on Cancel, on Escape (the dialog's cancel) and when it closes", async () => {
    const cancel = ask(question);
    button("ask-no").click();
    await expect(cancel).resolves.toBe(false);

    const escaped = ask(question);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    await expect(escaped).resolves.toBe(false);

    const closed = ask(question);
    dialog().dispatchEvent(new Event("close"));
    await expect(closed).resolves.toBe(false);
    expect(dialog().hasAttribute("open")).toBe(false);
  });

  it("asks one question at a time: a second one answers the first no", async () => {
    const first = ask(question);
    const second = ask({ ...question, title: "Forget everything?" });
    await expect(first).resolves.toBe(false);
    expect(dialog().hasAttribute("open")).toBe(true);
    button("ask-yes").click();
    await expect(second).resolves.toBe(true);
  });

  it("is the only way the plugin asks: no window.confirm, alert or prompt in its page", () => {
    // A plugin's page is sandboxed with scripts only: those are ignored and confirm answers no.
    for (const name of readdirSync(ui).filter((n) => /\.(js|html)$/.test(n)))
      expect(readFileSync(join(ui, name), "utf8"), name).not.toMatch(
        /\b(confirm|alert|prompt)\s*\(/,
      );
  });
});

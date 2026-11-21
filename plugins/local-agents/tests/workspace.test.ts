// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { AGENTS } from "../ui/catalog.js";
import { createView } from "../ui/view.js";
import { mount } from "./harness";

async function workspace(options: Parameters<typeof mount>[0] = {}) {
  const html = readFileSync(`${import.meta.dirname}/../ui/index.html`, "utf8");
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  let actions: Record<string, (...args: unknown[]) => unknown> = {};
  const view = createView(document, (action, ...args) => actions[action]?.(...args));
  const m = await mount({ ...options, also: view });
  actions = m.actions;
  m.app.show("chat");
  const host = document.querySelector("desk-agent-session");
  expect(host?.shadowRoot, "the plugin Chat tab uses the reader").toBeTruthy();
  return { ...m, root: host!.shadowRoot! };
}
it("opens every catalog agent in one workspace and asks for native history only on demand", async () => {
  const saved = Object.fromEntries(
    AGENTS.slice(0, -1).map((a) => [
      `chat.${a.id}`,
      { messages: [{ id: "a", role: "agent", text: `Notes for ${a.id}`, at: 1 }] },
    ]),
  );
  const calls: string[] = [];
  const m = await workspace({
    store: saved,
    handlers: {
      "agents.list": () => {
        calls.push("list");
        return { agents: [] };
      },
      "agents.sessions": () => {
        throw Error("An unlisted agent was read");
      },
    },
  });
  expect(calls).toEqual([]);
  for (const a of AGENTS) {
    const row = [...m.root.querySelectorAll<HTMLButtonElement>("[data-session-key]")].find(
      (b) => b.dataset.agent === a.id,
    );
    expect(row, a.id).toBeTruthy();
    row!.click();
    await m.settle();
    expect(m.root.querySelector("h2")?.textContent).toBeTruthy();
    if (a !== AGENTS.at(-1))
      expect(m.root.querySelector("desk-markdown")?.shadowRoot?.textContent).toContain(
        `Notes for ${a.id}`,
      );
  }
  document.querySelector<HTMLButtonElement>("[data-native-history]")!.click();
  await m.settle();
  expect(calls).toEqual(["list"]);
  expect(m.programs.calls.filter((c) => c.args[0] !== "--version")).toHaveLength(0);
});
it("keeps writes and drafts attached to their target", async () => {
  const m = await workspace();
  const input = document.querySelector<HTMLTextAreaElement>("#chat-input")!;
  const select = async (agent: string) => {
    m.root.querySelector<HTMLButtonElement>(`[data-session-key][data-agent="${agent}"]`)!.click();
    await m.settle();
  };
  input.value = "First draft";
  input.dispatchEvent(new Event("input"));
  await select(AGENTS[1]!.id);
  expect(input.value).toBe("");
  input.value = "Second draft";
  input.dispatchEvent(new Event("input"));
  await select(AGENTS[0]!.id);
  expect(input.value).toBe("First draft");
  expect(m.programs.calls.filter((c) => c.args[0] !== "--version")).toHaveLength(0);
});

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { createHomeView } from "../ui/view-home.js";
import { mount } from "./harness";

// The Home's DOM on the page's own markup (ui/index.html), drawn from the controller's model on the
// fixtures (07 #18): a press anywhere on a card opens its Studio, and an Activity board with no
// conversation at all says so once, not under each of its four columns.
const PAGE = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");

function draw(shown: Awaited<ReturnType<typeof mount>>) {
  const body = /<body>([\s\S]*)<\/body>/.exec(PAGE)?.[1] ?? "";
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
  const actions = {
    filter: vi.fn(),
    studio: vi.fn(),
    boardAgent: vi.fn(),
    openRow: vi.fn(),
    stopRun: vi.fn(),
    openWeb: vi.fn(),
    create: vi.fn(),
  };
  createHomeView(document, actions).show(shown.last(), shown.home());
  return actions;
}

const signedOut = {
  "studio.agents.list": () => {
    throw new StubError("signed_out" as never, "Sign in");
  },
};

describe("the Home's page", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("opens a card's Studio from a press anywhere on it; its own button does its own thing", async () => {
    const actions = draw(await mount());
    const card = document.querySelector<HTMLElement>('.agent-card[data-key="local:claude"]');
    if (!card) throw new Error("no card");
    card.querySelector<HTMLElement>(".role")?.click();
    expect(actions.studio).toHaveBeenLastCalledWith("local:claude");
    card.querySelector<HTMLElement>(".presence")?.click();
    expect(actions.studio).toHaveBeenCalledTimes(2);
    // The name row is one call, not two.
    card.querySelector<HTMLElement>(".card-open")?.click();
    expect(actions.studio).toHaveBeenCalledTimes(3);
    // Chat opens the chat, once.
    card.querySelector<HTMLElement>(".card-actions button")?.click();
    expect(actions.studio).toHaveBeenCalledTimes(4);
    expect(actions.studio).toHaveBeenLastCalledWith("local:claude", "chat");
  });

  it("an Activity board with no conversation says so once, without four empty columns", async () => {
    draw(
      await mount({
        studio: signedOut,
        local: { "agents.sessions": () => ({ sessions: [], total: 0 }) },
      }),
    );
    expect(document.getElementById("board")?.hidden).toBe(true);
    expect(document.getElementById("board-empty")?.hidden).toBe(false);
    expect(document.querySelectorAll(".column-empty")).toHaveLength(0);
  });

  it("a board with conversations keeps its columns, an empty one saying so", async () => {
    draw(await mount());
    expect(document.getElementById("board")?.hidden).toBe(false);
    expect(document.getElementById("board-empty")?.hidden).toBe(true);
    expect(document.querySelectorAll("#board .column")).toHaveLength(4);
  });

  it("the endue chip with nobody signed in says to sign in, not to clear a search", async () => {
    const m = await mount({ studio: signedOut });
    m.app.filter({ source: "endue" });
    draw(m);
    const empty = document.getElementById("grid-empty");
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent?.trim()).toBe("Sign in to see your endue agents.");
  });
});

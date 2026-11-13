// keepState (issue 235, ADR 0205): before a window moves into or out of an OS window, which loads its
// plugin's page again, the plugin is asked for its surface's state as an unload asks, and what it
// answers goes to its next init; one that never said hello is not asked and keeps nothing.
import { describe, expect, it } from "vitest";
import { keepState } from "./state";

const timers = { now: () => 0, after: () => () => {} };

function host(greeted: boolean, answer: unknown) {
  const asked: unknown[] = [];
  const gone: unknown[] = [];
  return {
    asked,
    gone,
    request: (id: string, name: string, args?: unknown) => {
      asked.push([id, name, args]);
      return Promise.resolve(answer);
    },
    greeted: () => greeted,
    unloaded: (id: string, state: unknown) => void gone.push([id, state]),
  };
}

describe("keepState", () => {
  it("asks a greeted plugin for its surface's state and keeps the answer for its next init", async () => {
    const h = host(true, { state: { scroll: 12 } });
    await keepState(h, "endue.terminal", "main", timers);
    expect(h.asked).toEqual([["endue.terminal", "ui.surface.state", { surface: "main" }]]);
    expect(h.gone).toEqual([["endue.terminal", { scroll: 12 }]]);
  });

  it("asks nothing of a plugin whose page never said hello, and keeps nothing", async () => {
    const h = host(false, { state: { scroll: 12 } });
    await keepState(h, "endue.notes", "main", timers);
    expect(h.asked).toEqual([]);
    expect(h.gone).toEqual([["endue.notes", undefined]]);
  });
});

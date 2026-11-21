// A feature written as ui/features/README.md says: a command that opens its panel, an action that
// changes the panel on screen, and a panel whose state keeps itself across a restart when it says
// so. The tests of the feature host, the panel buffers and the panel box share it.
import type { Feature } from "../ui/feature-host.js";

export interface Counter {
  n: number;
  keep?: boolean;
}

/** The fake feature; `log` hears what its panel module was asked to do. */
export function fakeFeature(log: string[] = []): Feature {
  return {
    id: "fake",
    commands: (deps) => ({
      "endue.database.fake-open": async ({ connection, n, keep }) => {
        const conn = await deps.manager.choose(connection, "Database: count on which connection?");
        if (!conn) return undefined;
        const state: Counter = {
          n: typeof n === "number" ? n : 1,
          ...(keep ? { keep: true } : {}),
        };
        await deps.consoles.openPanel(conn, "fake", `count: ${conn.name}`, state);
        return `Counting on ${conn.name}`;
      },
      "endue.database.fake-fail": () => {
        throw new Error("The fake command failed.");
      },
      "endue.database.fake-cancel": () => {
        throw deps.cancelled("Not counted.");
      },
    }),
    actions: (deps) => ({
      fakeBump: (by = 1) => {
        const shown = deps.consoles.current();
        if (shown?.kind !== "fake") throw new Error("No counter on screen.");
        const state = shown.fake as Counter;
        const next = { ...state, n: state.n + Number(by) };
        deps.consoles.updatePanel(shown.id, next);
        return next.n;
      },
      fakeFail: () => {
        throw new Error("The fake action failed.");
      },
    }),
    panels: {
      fake: {
        label: "Counter",
        keep: (state: Counter) => (state.keep ? state : undefined),
        render(doc, state: Counter, act, buffer) {
          log.push(`render ${buffer.id} ${state.n}`);
          const el = doc.createElement("button");
          el.type = "button";
          el.className = "desk-btn";
          el.textContent = String(state.n);
          el.addEventListener("click", () => act("fakeBump", 1));
          return {
            el,
            update(next: Counter) {
              log.push(`update ${buffer.id} ${next.n}`);
              el.textContent = String(next.n);
            },
            destroy() {
              log.push(`destroy ${buffer.id}`);
            },
          };
        },
      },
    },
  };
}

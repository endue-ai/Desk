import { describe, expect, it } from "vitest";
import { bulkSentence, runEach } from "../ui/bulk.js";
import { DB_ID, OLD_ID, WEB_ID } from "./fixtures";
import { engine, mount } from "./harness";

const web = {
  kind: "container",
  id: WEB_ID,
  name: "shop-web-1",
  state: "running",
  project: "shop",
} as const;
const db = {
  kind: "container",
  id: DB_ID,
  name: "shop-db-1",
  state: "running",
  project: "shop",
} as const;
const old = {
  kind: "container",
  id: OLD_ID,
  name: "scratch",
  state: "exited",
  project: "",
} as const;
const failsFor = (id: string, verb: string) => ({
  [verb]: (call: { args: string[] }) =>
    call.args.at(-1) === id
      ? {
          code: 1,
          stderr: `Error response from daemon: Cannot ${verb} container ${id.slice(0, 12)}: oops\n`,
        }
      : {},
});

describe("one action on many", () => {
  it("runs every item, a few at a time, and keeps going past failures", async () => {
    let running = 0;
    let most = 0;
    const outcome = await runEach([1, 2, 3, 4, 5, 6], async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running--;
      if (n % 3 === 0) throw new Error(`no ${n}`);
    });
    expect(most).toBe(4);
    expect(outcome.done).toEqual([1, 2, 4, 5]);
    expect(outcome.failed).toEqual([
      { item: 3, message: "no 3" },
      { item: 6, message: "no 6" },
    ]);
    const words = { past: "Stopped", verb: "stop" };
    expect(bulkSentence(words, "container", 3, [])).toBe("Stopped 3 containers.");
    expect(bulkSentence(words, "container", 1, [{ name: "a", message: "Gone." }])).toBe(
      "Stopped 1 of 2 containers. a: Gone.",
    );
    expect(bulkSentence(words, "container", 0, [{ name: "a", message: "Gone" }])).toBe(
      "Could not stop any of the 1 container. a: Gone.",
    );
  });
});

describe("bulk actions on marked containers", () => {
  it("runs one docker call per marked container, says what failed, and refreshes once", async () => {
    const m = await mount({ script: engine(failsFor(OLD_ID, "restart")) });
    await m.keys.containers?.();
    m.view.marks = [web, db, old];
    const reads = m.docker.of("ps").length;
    await m.keys.restart?.();
    expect(m.docker.of("restart")).toEqual([
      ["restart", "-t", "10", "--", WEB_ID],
      ["restart", "-t", "10", "--", DB_ID],
      ["restart", "-t", "10", "--", OLD_ID],
    ]);
    expect(m.view.said.at(-1)).toBe(
      `Restarted 2 of 3 containers. scratch: Cannot restart container ${OLD_ID.slice(0, 12)}: oops.`,
    );
    expect(m.docker.of("ps").length).toBe(reads + 1);
    // What failed stays marked, to try again.
    expect(m.view.marks).toEqual([old]);
  });

  it("answers agents with what was done and what failed, and fails when nothing worked", async () => {
    const m = await mount({ script: engine(failsFor(DB_ID, "stop")) });
    expect(await m.host.invoke("endue.docker.stop", { containers: ["shop-web-1", DB_ID] })).toEqual(
      {
        done: ["shop-web-1"],
        failed: [{ container: DB_ID, error: `Cannot stop container ${DB_ID.slice(0, 12)}: oops.` }],
      },
    );
    await expect(m.host.invoke("endue.docker.stop", { containers: [DB_ID] })).rejects.toThrow(
      /Could not stop any of the 1 container/,
    );
    await expect(m.host.invoke("endue.docker.stop", { containers: ["ok", "-rf"] })).rejects.toThrow(
      /not a name docker allows/,
    );
    expect(m.docker.of("stop").map((args) => args.at(-1))).toEqual(["shop-web-1", DB_ID, DB_ID]);
  });

  it("asks once before removing the marked containers, and forces only the running ones", async () => {
    const m = await mount({ commands: { "desk.palette.pick": () => "yes" } });
    await m.keys.containers?.();
    m.view.marks = [web, old];
    await m.keys.remove?.();
    const asked = m.ran("desk.palette.pick") as Array<{ title: string }>;
    expect(asked).toHaveLength(1);
    expect(asked[0]?.title).toBe(
      "Remove 2 containers: shop-web-1 and scratch? The running one is stopped first.",
    );
    expect(m.docker.of("rm")).toEqual([
      ["rm", "-f", "--", WEB_ID],
      ["rm", "--", OLD_ID],
    ]);
    expect(m.view.said.at(-1)).toBe("Removed 2 containers.");
    expect(m.view.marks).toEqual([]);
  });

  it("acts on the cursor's container alone when nothing is marked", async () => {
    const m = await mount();
    await m.keys.containers?.();
    m.view.selected = web;
    await m.keys.stop?.();
    expect(m.docker.of("stop")).toEqual([["stop", "-t", "10", "--", WEB_ID]]);
    expect(m.view.said.at(-1)).toBe("Stopped shop-web-1.");
  });
});

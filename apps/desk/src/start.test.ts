import { describe, expect, it } from "vitest";
import { readStart, relauncher } from "./start";

describe("readStart", () => {
  it("passes on what the app found at start", async () => {
    const found = {
      safe: { reason: "crash-loop", heldOff: ["endue.notes"] },
      broken: [{ name: "store.json", path: "/data/store.json.broken" }],
      dataDir: "/data",
    };
    const invoke = async (command: string) => (command === "desk_start" ? found : undefined);
    expect(await readStart(invoke)).toEqual(found);
  });

  it("starts normal when the app cannot say", async () => {
    const invoke = () => Promise.reject(new Error("unknown command desk_start"));
    expect(await readStart(invoke)).toEqual({ broken: [] });
  });
});

describe("relauncher", () => {
  it("asks the app to start the desk again", async () => {
    const asked: string[] = [];
    const relaunch = relauncher(async (command) => void asked.push(command));
    await relaunch();
    expect(asked).toEqual(["desk_relaunch"]);
  });
});

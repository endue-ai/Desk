import { expect, test } from "vitest";
import { browserBridge, sampleEnvelope, wordTimes } from "./browser";

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
};

test("storage round-trips JSON under the shell prefix", async () => {
  const bridge = browserBridge({ now: () => 0, storage: memory() });
  await bridge.storage.set("desk", { modeId: "night" });
  expect(await bridge.storage.get("desk")).toEqual({ modeId: "night" });
  expect(await bridge.storage.get("nothing")).toBeUndefined();
});

test("fake audio replays an envelope on the injected clock", () => {
  let now = 0;
  const bridge = browserBridge({ now: () => now, storage: memory() });
  const envelope = {
    frameMs: 10,
    frames: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  };
  bridge.fake.play("user", envelope, 0);
  now = 5;
  expect(bridge.audio.levels().user[0]).toBeCloseTo(0.5);
  expect(bridge.audio.levels().eris[0]).toBe(0);
  now = 100;
  expect(bridge.audio.levels().user[0]).toBe(0);
  expect(sampleEnvelope(envelope, -1)[0]).toBe(0);
});

test("brain status switches between local and cloud; permission requests are recorded", async () => {
  const bridge = browserBridge({ now: () => 0, storage: memory(), grant: (s) => s !== "mail" });
  expect(await bridge.brain.status()).toEqual({ mode: "local", model: "llama-3.2-3b" });
  expect(await bridge.brain.use("cloud")).toEqual({ mode: "cloud", credits: 1200 });
  expect(await bridge.perm.request("mail")).toBe(false);
  expect(bridge.fake.requests).toEqual(["mail"]);
});

test("word times without TTS are proportional to letters", () => {
  expect(wordTimes("ab cd", 10)).toEqual([
    { word: "ab", at: 0 },
    { word: "cd", at: 30 },
  ]);
});

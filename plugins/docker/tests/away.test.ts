// An engine docker cannot reach (none installed, Docker Desktop quit, a context whose socket is
// gone): the plugin says so once, starts no event stream and reads no list against it, asks
// `docker version` only now and then while the page can be seen, and comes back by itself.
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { notReachable } from "../ui/errors.js";
import { createWait, FIRST_ASK_MS, MAX_ASK_MS, pageOf } from "../ui/reach.js";
import { DAEMON_DOWN, VERSION_DOWN } from "./fixtures";
import { engine, fakeClock, type Mounted, mount, type Script } from "./harness";

const STEP_MS = 5_000;
/** Five minutes on the fake clock take a while on the real one. */
const SLOW = 20_000;
const PROBLEM = notReachable("unix:///Users/me/.docker/run/docker.sock");

/** The fixtures' engine, or (`up` false) a CLI whose engine does not answer. */
function switchable(up = false) {
  const fixtures = engine();
  const state = { up };
  const script: Script = (call) => {
    if (state.up) return fixtures(call);
    if (call.args[0] === "version") return { stdout: VERSION_DOWN, stderr: DAEMON_DOWN, code: 1 };
    return { stderr: DAEMON_DOWN, code: 1 };
  };
  return { state, script };
}

/** Let `ms` go by on the plugin's clock, five seconds at a time, settling the bridge in between. */
async function pass(m: Mounted, ms: number) {
  for (let gone = 0; gone < ms; gone += STEP_MS) {
    m.clock.advance(STEP_MS);
    await m.settle();
  }
}

/** Let the promises that are due run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const programs = (m: Mounted, from = 0) => m.docker.calls.slice(from).map((c) => c.args[0]);

/** A page whose visibility the test sets. */
function fakePage(hidden: boolean) {
  const shown: Array<() => void> = [];
  return {
    hidden: () => hidden,
    onShown: (fn: () => void) => shown.push(fn),
    show() {
      hidden = false;
      for (const fn of shown) fn();
    },
  };
}

describe("no engine", () => {
  it(
    "runs only docker version, eight times at most in five minutes, and notices the engine within a minute",
    async () => {
      const docker = switchable();
      const m = await mount({ script: docker.script });
      expect(programs(m)).toEqual(["version"]);
      expect(m.view.headers.at(-1)).toMatchObject({ problem: PROBLEM, live: false });
      await pass(m, 5 * 60_000);
      expect(new Set(programs(m))).toEqual(new Set(["version"]));
      expect(m.docker.calls.length).toBeLessThanOrEqual(8);
      docker.state.up = true;
      await pass(m, MAX_ASK_MS);
      expect(m.view.headers.at(-1)).toMatchObject({ problem: "", live: true });
      expect(m.docker.of("events")).toHaveLength(1);
      expect(m.view.latest("overview").counts.total).toBe(3);
    },
    SLOW,
  );

  it(
    "stops starting docker when the engine goes away while watched, and reads the screen again when it is back",
    async () => {
      const docker = switchable(true);
      const m = await mount({ script: docker.script });
      const events = m.docker.last("events");
      expect(events).toBeDefined();
      docker.state.up = false;
      m.docker.exit(events?.procId ?? "", 1, DAEMON_DOWN);
      await m.settle();
      const from = m.docker.calls.length;
      await pass(m, 5 * 60_000);
      expect(new Set(programs(m, from))).toEqual(new Set(["version"]));
      expect(m.docker.calls.length - from).toBeLessThanOrEqual(9);
      expect(m.view.headers.at(-1)).toMatchObject({ problem: PROBLEM, live: false });
      const reads = m.docker.of("ps").length;
      docker.state.up = true;
      await pass(m, MAX_ASK_MS);
      expect(m.view.headers.at(-1)).toMatchObject({ problem: "", live: true });
      expect(m.docker.of("events")).toHaveLength(2);
      expect(m.docker.of("ps").length).toBeGreaterThan(reads);
    },
    SLOW,
  );

  it(
    "asks nothing while the page is out of sight, and asks at once when it is shown",
    async () => {
      const page = fakePage(true);
      const docker = switchable();
      const m = await mount({ script: docker.script, page });
      await pass(m, 5 * 60_000);
      expect(programs(m)).toEqual(["version"]);
      docker.state.up = true;
      page.show();
      await m.settle();
      expect(m.view.headers.at(-1)).toMatchObject({ problem: "", live: true });
      expect(m.docker.of("events")).toHaveLength(1);
    },
    SLOW,
  );

  it(
    "does not ask for the grant again and again once it was refused",
    async () => {
      const m = await mount({
        handlers: {
          "proc.spawn": () => {
            throw new StubError("permission_denied", "no grant");
          },
          "perm.request": () => ({ granted: false }),
        },
      });
      await pass(m, 5 * 60_000);
      expect(m.params("perm.request")).toHaveLength(1);
      expect(m.view.headers.at(-1)?.problem).toBe("Not allowed to run docker.");
    },
    SLOW,
  );

  it(
    "says a list could not be read instead of Reading… for ever, and the engine's problem only in the header",
    async () => {
      const docker = switchable();
      const m = await mount({ script: docker.script });
      for (const name of ["compose", "images", "volumes", "networks", "containers"])
        await m.keys[name]?.();
      await m.settle();
      expect(m.view.unreads).toEqual(["compose", "images", "volumes", "networks", "containers"]);
      expect(m.view.said).not.toContain(PROBLEM);
      // A read that works while the engine was away brings the event stream back at once.
      docker.state.up = true;
      await m.keys.images?.();
      await m.settle();
      expect(m.view.headers.at(-1)).toMatchObject({ problem: "", live: true });
    },
    SLOW,
  );
});

describe("createWait", () => {
  it("asks after 5, 10, 20 and 40 seconds and then every minute, until the engine answers", async () => {
    const clock = fakeClock();
    let up = false;
    const asked: number[] = [];
    let back = 0;
    const start = clock.now();
    const wait = createWait({
      clock,
      probe: async () => {
        asked.push(clock.now() - start);
        return up;
      },
      back: () => {
        back += 1;
      },
    });
    wait.start();
    wait.start();
    for (let i = 0; i < 300; i++) {
      clock.advance(1000);
      await tick();
    }
    expect(FIRST_ASK_MS).toBe(5_000);
    expect(asked).toEqual([5_000, 15_000, 35_000, 75_000, 135_000, 195_000, 255_000]);
    up = true;
    clock.advance(MAX_ASK_MS);
    await tick();
    expect(back).toBe(1);
    expect(wait.waiting()).toBe(false);
    expect(clock.pending()).toBe(0);
  });

  it("forgets an answer that comes after a stop", async () => {
    const clock = fakeClock();
    let answer: (up: boolean) => void = () => {};
    let back = 0;
    const wait = createWait({
      clock,
      probe: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
      back: () => {
        back += 1;
      },
    });
    wait.start();
    clock.advance(FIRST_ASK_MS);
    wait.stop();
    answer(true);
    await tick();
    expect(back).toBe(0);
    expect(clock.pending()).toBe(0);
  });
});

describe("pageOf", () => {
  it("reads whether the page can be seen, and hears when it is shown again", () => {
    let state = "hidden";
    const heard: Array<() => void> = [];
    const doc = {
      get visibilityState() {
        return state;
      },
      addEventListener: (_type: string, fn: () => void) => heard.push(fn),
    } as unknown as Document;
    const page = pageOf(doc);
    let shown = 0;
    page.onShown(() => {
      shown += 1;
    });
    expect(page.hidden()).toBe(true);
    for (const fn of heard) fn();
    expect(shown).toBe(0);
    state = "visible";
    for (const fn of heard) fn();
    expect(shown).toBe(1);
    expect(page.hidden()).toBe(false);
  });
});

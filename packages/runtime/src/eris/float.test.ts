// One Eris in two windows (ADR 0027, ADR 0121, #546): the runtime hands her state from the desk to
// the floating window, and what is said there back to the desk, without losing the conversation.
import { describe, expect, it } from "vitest";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import {
  type ErisLine,
  floatSide,
  keepLines,
  MAX_LINES,
  pairedChannels,
  readBack,
  readSnapshot,
  SNAPSHOT_KEY,
  statusOf,
} from "./float";
import { linkDesk, SUMMON } from "./float-desk";
import type { ErisState } from "./states";
import type { TalkPhase } from "./talk";

type Run = (args: unknown) => unknown;

/** The desk's Eris on a store, linked to a floating window through paired channels. */
function linked(focused = true) {
  const [deskChannel, floatChannel] = pairedChannels();
  const store = new Store(emptyState("en"));
  const ticks = new Set<(now: number) => void>();
  const defined = new Map<string, Run>();
  const ran: string[] = [];
  const said: string[] = [];
  const state = { phase: "off" as TalkPhase, focused };
  const win = new EventTarget() as unknown as Window;
  const ctx = {
    store,
    ticker: {
      now: () => 0,
      add: (tick: (now: number) => void) => {
        ticks.add(tick);
        tick(0);
        return () => ticks.delete(tick);
      },
    },
    runtime: {
      commands: {
        define: (id: string, spec: { run: Run }) => {
          defined.set(id, spec.run);
          return () => defined.delete(id);
        },
        run: async (id: string) => {
          ran.push(id);
        },
      },
    },
  } as unknown as ShellCtx;
  const off = linkDesk(
    ctx,
    {
      phase: () => state.phase,
      say: (text) => {
        said.push(text);
        store.set((s) => ({ eris: { ...s.eris, state: "idle", saying: text } }));
      },
      setState: (next: ErisState) => store.set((s) => ({ eris: { ...s.eris, state: next } })),
    },
    { channel: deskChannel, focused: () => state.focused, win },
  );
  const float = floatSide(floatChannel);
  const lines = (): ErisLine[] => float.snapshot()?.lines ?? [];
  const tick = () => {
    for (const t of [...ticks]) t(16);
  };
  return { store, float, lines, said, ran, defined, state, win, off, tick };
}

describe("the floating Eris's link to the desk", () => {
  it("hands the desk's Eris to the floating window: her state, her talk phase and her lines", () => {
    const desk = linked();
    expect(desk.float.snapshot()).toMatchObject({ state: "idle", talk: "off", lines: [] });
    const heard: string[] = [];
    desk.float.onSnapshot((s) => heard.push(s.state));
    desk.store.set((s) => ({ eris: { ...s.eris, state: "thinking" } }));
    expect(desk.float.snapshot()?.state).toBe("thinking");
    expect(heard).toEqual(["thinking"]);
    desk.store.set((s) => ({ eris: { ...s.eris, state: "idle", saying: "Your 3 pm moved." } }));
    expect(desk.float.snapshot()?.saying).toBe("Your 3 pm moved.");
    expect(desk.lines()).toEqual([{ who: "eris", text: "Your 3 pm moved." }]);
    desk.state.phase = "listening";
    desk.tick();
    const snapshot = desk.float.snapshot();
    expect(snapshot?.talk).toBe("listening");
    expect(
      statusOf({
        state: snapshot?.state ?? "idle",
        talk: snapshot?.talk ?? "off",
        thinking: false,
        speaking: false,
        approval: false,
      }),
    ).toBe("listening");
  });

  it("hands a floating turn back to the desk without losing the conversation", () => {
    const desk = linked(false);
    desk.store.set((s) => ({ eris: { ...s.eris, saying: "Good morning." } }));
    desk.float.back({ line: { who: "you", text: "What is next?" }, state: "thinking" });
    // The desk's Eris thinks too, so a desk brought forward mid-turn shows it.
    expect(desk.store.get().eris.state).toBe("thinking");
    desk.float.back({
      line: { who: "eris", text: "Lunch with Mina." },
      state: "idle",
      said: "Lunch with Mina.",
    });
    expect(desk.store.get().eris.state).toBe("idle");
    // The desk is away: she says it when it is in front again.
    expect(desk.said).toEqual([]);
    desk.state.focused = true;
    desk.win.dispatchEvent(new Event("focus"));
    expect(desk.said).toEqual(["Lunch with Mina."]);
    desk.win.dispatchEvent(new Event("focus"));
    expect(desk.said).toEqual(["Lunch with Mina."]);
    expect(desk.store.get().eris.saying).toBe("Lunch with Mina.");
    // One conversation, in order, her answer once.
    expect(desk.lines()).toEqual([
      { who: "eris", text: "Good morning." },
      { who: "you", text: "What is next?" },
      { who: "eris", text: "Lunch with Mina." },
    ]);
    // The desk goes on with it.
    desk.store.set((s) => ({ eris: { ...s.eris, saying: "Mina is running late." } }));
    expect(desk.lines().map((l) => l.text)).toEqual([
      "Good morning.",
      "What is next?",
      "Lunch with Mina.",
      "Mina is running late.",
    ]);
  });

  it("says a floating answer at once while the desk is in front", () => {
    const desk = linked(true);
    desk.float.back({ line: { who: "eris", text: "Done." }, state: "idle", said: "Done." });
    expect(desk.said).toEqual(["Done."]);
  });

  it("runs desk.eris.summon: her composer opens in the desk, and a toggle closes an open one", async () => {
    const desk = linked();
    const summon = desk.defined.get(SUMMON);
    expect(summon).toBeDefined();
    await summon?.({ toggle: true });
    expect(desk.ran).toEqual(["desk.shell.talk"]);
    desk.store.set({ composer: { open: true, text: "half", selected: 0 } });
    await summon?.({ toggle: true });
    expect(desk.store.get().composer).toEqual({ open: false, text: "", selected: 0 });
    expect(desk.ran).toEqual(["desk.shell.talk"]);
    desk.store.set({ composer: { open: true, text: "", selected: 0 } });
    await summon?.({ toggle: false });
    expect(desk.ran).toEqual(["desk.shell.talk", "desk.shell.talk"]);
  });

  it("stops linking when it is disposed", () => {
    const desk = linked();
    desk.off();
    expect(desk.defined.has(SUMMON)).toBe(false);
    desk.float.back({ state: "oops" });
    expect(desk.store.get().eris.state).toBe("idle");
  });
});

describe("the link's pieces", () => {
  it("keeps the conversation's last lines, without blanks or a repeated last line", () => {
    let lines: ErisLine[] = [];
    for (let i = 0; i < MAX_LINES + 3; i++) lines = keepLines(lines, { who: "you", text: `${i}` });
    expect(lines).toHaveLength(MAX_LINES);
    expect(lines[0]?.text).toBe("3");
    expect(keepLines(lines, { who: "eris", text: "  " })).toHaveLength(MAX_LINES);
    const once = keepLines([], { who: "eris", text: "Hi." });
    expect(keepLines(once, { who: "eris", text: "Hi." })).toEqual(once);
    expect(keepLines(once, { who: "you", text: "Hi." })).toHaveLength(2);
  });

  it("shows an approval first, then listening, thinking and speaking", () => {
    const base = { state: "idle" as ErisState, talk: "off" as TalkPhase };
    const off = { thinking: false, speaking: false, approval: false };
    expect(statusOf({ ...base, ...off })).toBe("idle");
    expect(statusOf({ ...base, ...off, speaking: true })).toBe("speaking");
    expect(statusOf({ ...base, ...off, thinking: true, speaking: true })).toBe("thinking");
    expect(statusOf({ ...base, talk: "listening", ...off, thinking: true })).toBe("listening");
    expect(statusOf({ ...base, ...off, thinking: true, approval: true })).toBe("approval");
    expect(statusOf({ state: "thinking", talk: "off", ...off })).toBe("thinking");
  });

  it("leaves out what another window wrote that is not a snapshot or an answer", () => {
    expect(readSnapshot(null)).toBeUndefined();
    expect(readSnapshot("not json")).toBeUndefined();
    expect(readSnapshot(JSON.stringify({ v: 2, state: "idle", talk: "off" }))).toBeUndefined();
    expect(readSnapshot(JSON.stringify({ v: 1, state: "dancing", talk: "off" }))).toBeUndefined();
    const lines = [{ who: "eris", text: "ok" }, { who: "robot", text: "no" }, { text: 3 }];
    expect(readSnapshot(JSON.stringify({ v: 1, state: "done", talk: "off", lines }))).toEqual({
      v: 1,
      seq: 0,
      state: "done",
      talk: "off",
      saying: "",
      lines: [{ who: "eris", text: "ok" }],
    });
    expect(readBack(JSON.stringify({ v: 1, seq: 2, line: { who: "x" }, state: "nope" }))).toEqual({
      v: 1,
      seq: 2,
    });
  });

  it("pairs two channels as two windows share storage", () => {
    const [a, b] = pairedChannels();
    const heard: Array<string | null> = [];
    b.listen(SNAPSHOT_KEY, (text) => heard.push(text));
    a.listen(SNAPSHOT_KEY, () => heard.push("own"));
    a.write(SNAPSHOT_KEY, "one");
    a.write(SNAPSHOT_KEY, "one");
    expect(heard).toEqual(["one"]);
    expect(b.read(SNAPSHOT_KEY)).toBe("one");
  });
});

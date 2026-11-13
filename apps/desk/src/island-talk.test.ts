// @vitest-environment jsdom
// Talking to Eris on the island (ADR 0204): a line goes to brain.say and her answer follows its
// brain.turn events, both handed to the desk through the shared link and the desk's lines shown back;
// Enter that ends a composition sends nothing; a failed line comes back to the field.
import type { BridgeEvent } from "@endue-ai/bridge";
import { BACK_KEY, pairedChannels, SNAPSHOT_KEY } from "@endue-ai/runtime";
import { describe, expect, it, vi } from "vitest";
import { mountTalk } from "./island-talk";

function fakeCore(answer: (text: string) => BridgeEvent[] | Error) {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const said: string[] = [];
  return {
    said,
    core: {
      onEvent: (listener: (event: BridgeEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      call: vi.fn(async (method: string, params: { text: string }) => {
        if (method !== "brain.say") throw new Error(`unexpected ${method}`);
        said.push(params.text);
        const events = answer(params.text);
        if (events instanceof Error) throw events;
        queueMicrotask(() => {
          for (const event of events) for (const listener of listeners) listener(event);
        });
        return { turnId: "t-1" };
      }),
    } as never,
  };
}

const turn = (kind: "started" | "delta" | "completed", text?: string): BridgeEvent => ({
  event: "brain.turn",
  data: { turnId: "t-1", kind, ...(text ? { text } : {}) },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the island's talk", () => {
  const mount = (answer: (text: string) => BridgeEvent[] | Error) => {
    const [desk, island] = pairedChannels();
    const fake = fakeCore(answer);
    const changed = vi.fn();
    const talk = mountTalk(document, {
      core: fake.core,
      channel: island,
      lang: "en",
      shortcut: () => ({ label: "⌥↩" }),
      changed,
    });
    document.body.replaceChildren(talk.el);
    const input = talk.el.querySelector<HTMLInputElement>(".island-talk-input");
    if (!input) throw new Error("no field");
    return { desk, fake, talk, input, changed };
  };

  it("says what to do with nothing said yet, with the shortcut", () => {
    const { talk } = mount(() => []);
    expect(talk.el.querySelector(".island-talk-empty")?.textContent).toBe(
      "Ask her anything. She keeps one conversation with the desk. ⌥↩ summons her anywhere",
    );
    expect(talk.el.querySelector(".island-talk-status")?.textContent).toBe("Ready");
  });

  it("sends a line as the desk's and shows her answer, both handed to the desk", async () => {
    const { desk, fake, talk, input } = mount(() => [
      turn("started"),
      turn("delta", "Three "),
      turn("delta", "meetings."),
      turn("completed"),
    ]);
    const backs: unknown[] = [];
    desk.listen(BACK_KEY, (text) => backs.push(JSON.parse(text ?? "null")));
    input.value = "What is on today?";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(talk.asking()).toBe(true);
    expect(talk.el.dataset.status).toBe("thinking");
    await settle();
    await settle();
    expect(fake.said).toEqual(["What is on today?"]);
    const rows = [...talk.el.querySelectorAll(".island-talk-line")].map((row) => row.textContent);
    expect(rows).toEqual(["YouWhat is on today?", "ErisThree meetings."]);
    expect(backs).toMatchObject([
      { line: { who: "you", text: "What is on today?" }, state: "thinking" },
      { line: { who: "eris", text: "Three meetings." }, state: "idle", said: "Three meetings." },
    ]);
    expect(talk.asking()).toBe(false);
  });

  it("shows what the desk said, and sends nothing on an Enter that ends a composition", () => {
    const { desk, fake, talk, input } = mount(() => []);
    const snapshot = {
      v: 1,
      seq: 1,
      state: "idle",
      talk: "off",
      saying: "Hello.",
      lines: [{ who: "eris", text: "Hello." }],
    };
    desk.write(SNAPSHOT_KEY, JSON.stringify(snapshot));
    expect(talk.el.querySelector(".island-talk-text")?.textContent).toBe("Hello.");
    input.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(talk.composing()).toBe(true);
    input.value = "안녕";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229 }));
    expect(fake.said).toEqual([]);
    input.dispatchEvent(new CompositionEvent("compositionend"));
    expect(talk.composing()).toBe(false);
  });

  it("puts a line that failed back in the field to send again", async () => {
    const { talk, input } = mount(() => new Error("offline"));
    input.value = "Book a room";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await settle();
    await settle();
    expect(input.value).toBe("Book a room");
    expect(talk.el.querySelector(".island-talk-error")?.textContent).toBe(
      "Eris could not answer. Try again.",
    );
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer, back, questions, start } from "../ui/args.js";
import { commandEntries } from "../ui/match.js";
import { type Command, mount } from "./harness";

const schema = {
  type: "object",
  properties: {
    name: { type: "string", description: "The desktop's new name" },
    count: { type: "integer" },
    side: { type: "string", enum: ["left", "right"] },
    note: { type: "string" },
  },
  required: ["name", "side", "count"],
};
const rename = { id: "desk.shell.desktop-rename", title: "Rename the desktop", argsSchema: schema };

afterEach(() => {
  vi.useRealTimers();
});

/** The question an answer moved to; it fails when the answer ran the command instead. */
function asked(step: ReturnType<typeof answer>) {
  if (!("asking" in step) || !step.asking) throw new Error("the command ran");
  return step.asking;
}

describe("a command's arguments", () => {
  it("a command with required args is listed", () => {
    const entries = commandEntries([{ ...rename, provider: "desk" }], [], new Set());
    expect(entries.map((e: { id: string }) => e.id)).toEqual([rename.id]);
    expect(entries[0].argsSchema).toEqual(schema);
  });

  it("leaves out a command whose required args cannot be typed: a list or an object", () => {
    const dispatch = {
      id: "desk.agents.dispatch",
      title: "Dispatch tasks",
      provider: "desk",
      argsSchema: {
        type: "object",
        properties: { tasks: { type: "array" }, note: { type: "string" } },
        required: ["tasks"],
      },
    };
    const entries = commandEntries([dispatch, { ...rename, provider: "desk" }], [], new Set());
    expect(entries.map((e: { id: string }) => e.id)).toEqual([rename.id]);
  });

  it("asks each required argument in order", () => {
    const asked = questions(schema);
    expect(asked.map((q: { name: string }) => q.name)).toEqual(["name", "side", "count"]);
    expect(asked[0]).toMatchObject({ name: "name", title: "The desktop's new name", pick: null });
    expect(asked[1]).toMatchObject({ name: "side", pick: ["left", "right"] });
    expect(asked[2]).toMatchObject({ name: "count", type: "integer", pick: null });
    expect(questions({ type: "object" })).toEqual([]);
    expect(questions(undefined)).toEqual([]);
    expect(
      questions({ type: "object", properties: { on: { type: "boolean" } }, required: ["on"] })[0],
    ).toMatchObject({ pick: ["true", "false"] });
  });

  it("Enter on the last argument runs the command with them", () => {
    const first = start({ id: rename.id, label: rename.title, argsSchema: schema });
    const step = answer(first, "Work");
    expect(step.run).toBeUndefined();
    const second = asked(step);
    expect(second.at).toBe(1);
    const third = asked(answer(second, "right"));
    // An integer that does not read as one is asked again, saying why.
    const wrong = answer(third, "three");
    expect(asked(wrong).at).toBe(2);
    expect("invalid" in wrong && wrong.invalid).toMatch(/whole number/);
    expect(answer(third, "3")).toEqual({
      run: rename.id,
      args: { name: "Work", side: "right", count: 3 },
    });
  });

  it("Escape steps back one argument, then out", () => {
    const first = start({ id: rename.id, label: rename.title, argsSchema: schema });
    const second = asked(answer(first, "Work"));
    const before = back(second);
    expect(before?.at).toBe(0);
    // The answer given stays, to change or keep.
    expect(before?.values).toEqual({ name: "Work" });
    expect(back(first)).toBeNull();
  });
});

describe("the palette asks for them", () => {
  const commands: Command[] = [
    {
      id: "desk.shell.desktop-rename",
      title: "Rename the desktop",
      argsSchema: {
        type: "object",
        properties: { name: { type: "string" }, side: { type: "string", enum: ["left", "right"] } },
        required: ["name", "side"],
      },
    },
  ];

  it("free text, then a pick, then runs it; Escape steps back, then out", async () => {
    const palette = await mount({ commands });
    palette.type("rename");
    await vi.advanceTimersByTimeAsync(0);
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-testid="title"]')?.textContent).toContain("name");
    palette.type("Work");
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.ids()).toEqual(["left", "right"]);
    palette.key("Escape");
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.input.value).toBe("Work");
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    palette.key("ArrowDown");
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.run).toHaveBeenCalledWith("desk.shell.desktop-rename", {
      name: "Work",
      side: "right",
    });
  });

  it("Enter with nothing typed says what the question needs", async () => {
    const palette = await mount({ commands });
    palette.type("rename");
    await vi.advanceTimersByTimeAsync(0);
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-testid="status"]')?.textContent).toBe(
      "name: type something",
    );
    expect(palette.run).not.toHaveBeenCalledWith("desk.shell.desktop-rename", expect.anything());
  });

  it("Escape on the first argument goes back to the commands", async () => {
    const palette = await mount({ commands });
    palette.type("rename");
    await vi.advanceTimersByTimeAsync(0);
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    palette.key("Escape");
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.ids()).toContain("desk.shell.desktop-rename");
    expect(palette.surface.hide).not.toHaveBeenCalled();
  });
});

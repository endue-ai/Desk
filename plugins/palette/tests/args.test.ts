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

describe("a command's arguments", () => {
  it("a command with required args is listed", () => {
    const entries = commandEntries([{ ...rename, provider: "desk" }], [], new Set());
    expect(entries.map((e: { id: string }) => e.id)).toEqual([rename.id]);
    expect(entries[0].argsSchema).toEqual(schema);
  });

  it("asks each required argument in order", () => {
    const asked = questions(schema);
    expect(asked.map((q: { name: string }) => q.name)).toEqual(["name", "side", "count"]);
    expect(asked[0]).toMatchObject({ name: "name", title: "The desktop's new name", pick: null });
    expect(asked[1]).toMatchObject({ name: "side", pick: ["left", "right"] });
    expect(asked[2]).toMatchObject({ name: "count", type: "integer", pick: null });
    expect(questions({ type: "object" })).toEqual([]);
    expect(questions(undefined)).toEqual([]);
    expect(questions({ type: "object", properties: { on: { type: "boolean" } }, required: ["on"] })[0])
      .toMatchObject({ pick: ["true", "false"] });
  });

  it("Enter on the last argument runs the command with them", () => {
    let asking = start({ id: rename.id, label: rename.title, argsSchema: schema });
    let step = answer(asking, "Work");
    expect(step.run).toBeUndefined();
    asking = step.asking;
    expect(asking.at).toBe(1);
    step = answer(asking, "right");
    asking = step.asking;
    // An integer that does not read as one is asked again, saying why.
    const wrong = answer(asking, "three");
    expect(wrong.asking.at).toBe(2);
    expect(wrong.invalid).toMatch(/whole number/);
    step = answer(asking, "3");
    expect(step).toEqual({ run: rename.id, args: { name: "Work", side: "right", count: 3 } });
  });

  it("Escape steps back one argument, then out", () => {
    const first = start({ id: rename.id, label: rename.title, argsSchema: schema });
    const second = answer(first, "Work").asking;
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

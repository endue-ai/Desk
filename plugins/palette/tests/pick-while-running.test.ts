// @vitest-environment jsdom
// A question a command asks while the palette runs it (#504): "Database: copy the result as" run
// from the palette asks for its format through desk.palette.pick before it answers. Enter (or a
// press) on a row answers that question; it was ignored while the palette still waited for the
// command, which then never answered.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "./harness";

afterEach(() => {
  vi.useRealTimers();
});

const COPY = { id: "example.copy", title: "Copy the result as", provider: "example" };
const FORMATS = [
  { id: "tsv", label: "TSV" },
  { id: "csv", label: "CSV" },
];

describe("a question asked by the command the palette runs", () => {
  it("Enter on its row answers it, and the command then answers", async () => {
    const p = await mount({ commands: [COPY] });
    let answered: unknown;
    p.run.mockImplementation(async (id: string) => {
      if (id !== COPY.id) return undefined;
      const pick = p.callbacks.get("desk.palette.pick");
      answered = await pick?.({ title: "Copy the result as", items: FORMATS });
      return answered;
    });
    p.type("copy the result");
    await vi.runAllTimersAsync();
    p.key("Enter");
    await vi.runAllTimersAsync();
    expect(document.querySelector('[data-testid="title"]')?.textContent).toBe("Copy the result as");
    p.type("csv");
    await vi.runAllTimersAsync();
    p.key("Enter");
    await vi.runAllTimersAsync();
    expect(answered).toBe("csv");
    expect(p.run).toHaveBeenCalledWith(COPY.id, {});
  });

  it("a press on its row answers it too", async () => {
    const p = await mount({ commands: [COPY] });
    let answered: unknown;
    p.run.mockImplementation(async (id: string) => {
      if (id !== COPY.id) return undefined;
      answered = await p.callbacks.get("desk.palette.pick")?.({ title: "Copy as", items: FORMATS });
      return answered;
    });
    p.type("copy the result");
    await vi.runAllTimersAsync();
    p.key("Enter");
    await vi.runAllTimersAsync();
    const row = [...p.list.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.dataset.id === "tsv",
    );
    row?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(answered).toBe("tsv");
  });
});

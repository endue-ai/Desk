import { describe, expect, it, vi } from "vitest";
import { installQuit, QUIT_EVENT, type QuitAnswer } from "./quit";

/** The page's side of a quit, with buffers whose question the test answers. */
function page(mayGo: (asking: () => void) => Promise<boolean>) {
  let quit: () => void = () => {};
  const answers: QuitAnswer[] = [];
  const host = {
    buffers: {
      mayGo: vi.fn((_leaving: string, options?: { asking?: () => void }) =>
        mayGo(options?.asking ?? (() => {})),
      ),
    },
    listen: vi.fn(async (event: string, handler: () => void) => {
      expect(event).toBe(QUIT_EVENT);
      quit = handler;
      return () => {};
    }),
    answer: vi.fn(async (answer: QuitAnswer) => void answers.push(answer)),
    report: vi.fn(),
  };
  const off = installQuit(host as never);
  return { host, answers, quit: () => quit(), off };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a quit the shell asks this page about", () => {
  it("answers quit at once when nothing is unsaved", async () => {
    const p = page(async () => true);
    await settled();
    p.quit();
    await vi.waitFor(() => expect(p.answers).toEqual(["quit"]));
    expect(p.host.buffers.mayGo).toHaveBeenCalledWith("quit", expect.anything());
  });

  it("says it is asking, then answers what the person chose", async () => {
    let choose: (go: boolean) => void = () => {};
    const p = page(
      (asking) =>
        new Promise((resolve) => {
          asking();
          asking();
          choose = resolve;
        }),
    );
    await settled();
    p.quit();
    await vi.waitFor(() => expect(p.answers).toEqual(["asking"]));
    // Quit again while the question is up: the same quit, not a second question.
    p.quit();
    await vi.waitFor(() => expect(p.answers).toEqual(["asking", "asking"]));
    choose(false);
    await vi.waitFor(() => expect(p.answers).toEqual(["asking", "asking", "stay"]));
    expect(p.host.buffers.mayGo).toHaveBeenCalledTimes(1);
  });

  it("stays and says why when a save the person chose fails", async () => {
    const p = page(async () => {
      throw new Error("Not allowed to write a.md.");
    });
    await settled();
    p.quit();
    await vi.waitFor(() => expect(p.answers).toEqual(["stay"]));
    expect(p.host.report).toHaveBeenCalledWith(new Error("Not allowed to write a.md."));
  });
});

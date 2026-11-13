import { describe, expect, it, vi } from "vitest";
import { forStall, installQuit, QUIT_EVENT, type QuitAnswer } from "./quit";

/** The page's side of a quit, with buffers whose question the test answers. */
function page(mayGo: (asking: () => void) => Promise<boolean>, modified: boolean[] = []) {
  let heard: (event: { payload?: unknown }) => void = () => {};
  const answers: QuitAnswer[] = [];
  const host = {
    buffers: {
      mayGo: vi.fn((_leaving: string, options?: { asking?: () => void }) =>
        mayGo(options?.asking ?? (() => {})),
      ),
      list: vi.fn(() => modified.map((changed, i) => ({ id: `b${i}`, modified: changed }))),
    },
    listen: vi.fn(async (event: string, handler: (event: { payload?: unknown }) => void) => {
      expect(event).toBe(QUIT_EVENT);
      heard = handler;
      return () => {};
    }),
    answer: vi.fn(async (answer: QuitAnswer) => void answers.push(answer)),
    report: vi.fn(),
  };
  const off = installQuit(host as never);
  return {
    host,
    answers,
    quit: () => heard({ payload: null }),
    stalled: () => heard({ payload: { why: "stalled" } }),
    off,
  };
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

describe("a quit because this page stopped painting (ADR 0202)", () => {
  it("reads the shell's reason", () => {
    expect(forStall({ why: "stalled" })).toBe(true);
    expect(forStall(null)).toBe(false);
    expect(forStall(undefined)).toBe(false);
    expect(forStall({ why: "person" })).toBe(false);
    expect(forStall("stalled")).toBe(false);
  });

  it("quits with nothing unsaved and asks nobody", async () => {
    const p = page(async () => true, [false, false]);
    await settled();
    p.stalled();
    await vi.waitFor(() => expect(p.answers).toEqual(["quit"]));
    expect(p.host.buffers.mayGo).not.toHaveBeenCalled();
  });

  it("stays with anything unsaved, without a question nobody would see", async () => {
    const p = page(async () => true, [false, true]);
    await settled();
    p.stalled();
    await vi.waitFor(() => expect(p.answers).toEqual(["stay"]));
    expect(p.host.buffers.mayGo).not.toHaveBeenCalled();
  });

  it("stays while the person's own quit question is up", async () => {
    const p = page((asking) => new Promise(() => asking()), []);
    await settled();
    p.quit();
    await vi.waitFor(() => expect(p.answers).toEqual(["asking"]));
    p.stalled();
    await vi.waitFor(() => expect(p.answers).toEqual(["asking", "stay"]));
  });

  it("stays when the buffers cannot be read, and says why", async () => {
    const p = page(async () => true);
    p.host.buffers.list.mockImplementation(() => {
      throw new Error("no buffers");
    });
    await settled();
    p.stalled();
    await vi.waitFor(() => expect(p.answers).toEqual(["stay"]));
    expect(p.host.report).toHaveBeenCalledWith(new Error("no buffers"));
  });
});

// The OS's notifications while endue is out of sight (#306): this page sends the shell each notice
// that shows, as desk.notify.system says, with its first action. Do not disturb holds notices
// back, and a click runs the action or opens the notice.
import type { Notice } from "@endue-ai/runtime";
import { describe, expect, it, vi } from "vitest";
import { followSystemNotices, SYSTEM_SETTING, type SystemPost } from "./system-notices";

function host(setting?: unknown) {
  const values: Record<string, unknown> =
    setting === undefined ? {} : { [SYSTEM_SETTING]: setting };
  const shown = new Set<(notice: Notice) => void>();
  let activated: (payload: unknown) => void = () => {};
  const posts: SystemPost[] = [];
  const activate = vi.fn(async (_id: string, _action: boolean) => {});
  let nextId = 1;
  /** The runtime shows a notice: held ones are never shown (do not disturb). */
  const show = (input: Partial<Notice>) => {
    const notice: Notice = {
      id: `desk-${nextId++}`,
      caller: "desk",
      title: "Saved",
      level: "info",
      at: 0,
      held: false,
      ...input,
    };
    if (!notice.held) for (const listener of shown) listener(notice);
  };
  return {
    posts,
    activate,
    show,
    set: (value: unknown) => {
      values[SYSTEM_SETTING] = value;
    },
    click: (payload: unknown) => activated(payload),
    host: {
      settings: {
        get: <T>(key: string, fallback?: T) => (key in values ? values[key] : fallback) as T,
      },
      notices: {
        onShown: (listener: (notice: Notice) => void) => {
          shown.add(listener);
          return () => shown.delete(listener);
        },
        activate,
      },
      post: async (post: SystemPost) => void posts.push(post),
      listen: async (handler: (payload: unknown) => void) => {
        activated = handler;
        return () => {
          activated = () => {};
        };
      },
      report: () => {},
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the OS's notifications", () => {
  it("sends a shown notice to the shell as the setting says", async () => {
    const fake = host();
    followSystemNotices(fake.host);
    fake.show({
      title: "Update ready",
      body: "1.2.0",
      level: "success",
      actions: [
        { label: "Restart", command: "desk.update.restart" },
        { label: "Later", command: "desk.notify.dismiss" },
      ],
    });
    fake.show({
      id: "n1",
      caller: "endue.terminal",
      title: "zsh — make",
      body: "done",
      level: "warning",
    });
    await settle();
    expect(fake.posts).toEqual([
      {
        id: "desk-1",
        title: "Update ready",
        body: "1.2.0",
        level: "success",
        action: "Restart",
        when: "background",
      },
      {
        id: "n1",
        title: "zsh — make",
        body: "done",
        level: "warning",
        when: "background",
      },
    ]);

    fake.set("always");
    fake.show({ title: "Saved" });
    fake.set("never");
    fake.show({ title: "Not sent" });
    fake.set("loud");
    fake.show({ title: "Default" });
    await settle();
    expect(fake.posts.slice(2).map((p) => [p.title, p.when])).toEqual([
      ["Saved", "always"],
      ["Default", "background"],
    ]);
  });

  it("holds back what do not disturb holds back", async () => {
    const fake = host("always");
    followSystemNotices(fake.host);
    fake.show({ title: "Held", held: true });
    fake.show({ title: "Allowed", level: "error" });
    await settle();
    expect(fake.posts.map((p) => p.title)).toEqual(["Allowed"]);
  });

  it("an activation runs the notice's action or opens it", async () => {
    const fake = host();
    const stop = followSystemNotices(fake.host);
    await settle();
    fake.click({ id: "desk-1", action: true });
    fake.click({ id: "n1", action: false });
    fake.click({ action: true });
    expect(fake.activate.mock.calls).toEqual([
      ["desk-1", true],
      ["n1", false],
    ]);
    stop();
    await settle();
    fake.click({ id: "n2", action: false });
    fake.show({ title: "After" });
    await settle();
    expect(fake.activate).toHaveBeenCalledTimes(2);
    expect(fake.posts).toEqual([]);
  });
});

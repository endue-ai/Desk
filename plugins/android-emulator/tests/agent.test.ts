import { expect, it, vi } from "vitest";
import { installAgentTools } from "../ui/agent.js";

it("holds agent operations for review, then uses the exact active emulator session", async () => {
  const handlers = new Map<string, (args: unknown, caller?: unknown) => unknown>();
  const signal = new AbortController().signal;
  const session = { id: "checked-session", serial: "emulator-5554", label: "Fixture", signal };
  const state = () => ({ session, phase: "connected" });
  const operate = vi.fn(async (run: (selected: typeof session) => unknown, id: string) => {
    if (id !== session.id) throw new Error("That emulator session changed.");
    return run(session);
  });
  const key = vi.fn(async () => {});
  const gesture = vi.fn(async () => {});
  const setPaused = vi.fn();
  installAgentTools(
    {
      on: (name: string, handler: (args: unknown, caller?: unknown) => unknown) =>
        handlers.set(name, handler),
    },
    {
      state,
      operate,
      android: { key, gesture },
      display: { setPaused, state: () => ({ drawn: true, width: 100, height: 200 }) },
      tools: {},
      disconnect: vi.fn(),
    },
  );
  const command = (name: string) => {
    const handler = handlers.get(`endue.android-emulator.${name}`);
    if (!handler) throw new Error(`Missing Android command ${name}.`);
    return handler;
  };
  const eris = { caller: "agent:eris", invocationId: "request-1" };
  expect(command("state")({})).toMatchObject({ phase: "connected", session: { id: session.id } });
  await expect(
    command("operate")({ session: session.id, action: "key", key: "Home" }, eris),
  ).rejects.toThrow("review");
  expect(operate).not.toHaveBeenCalled();
  const approved = { ...eris, approved: true };
  await expect(
    command("operate")({ session: "expired", action: "key", key: "Home" }, approved),
  ).rejects.toThrow("session changed");
  expect(key).not.toHaveBeenCalled();
  await command("operate")({ session: session.id, action: "key", key: "Home" }, approved);
  expect(key).toHaveBeenCalledExactlyOnceWith(session.serial, "Home", signal);
  await expect(
    command("operate")({ session: session.id, action: "tap", from: { x: 100, y: 9 } }, approved),
  ).rejects.toThrow("inside the current Android preview");
  expect(gesture).not.toHaveBeenCalled();
  command("pause-preview")({ session: session.id }, eris);
  expect(setPaused).toHaveBeenCalledExactlyOnceWith(true);
});

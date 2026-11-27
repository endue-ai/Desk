import { afterEach, expect, it, vi } from "vitest";
import { createConnection } from "../ui/connection.js";

const other = { serial: "emulator-5554", state: "device", avd: "Other" };
const wanted = { serial: "emulator-5556", state: "device", avd: "Pixel" };
it("requires a fresh selection when a serial has been reused by another AVD", async () => {
  const android = { devices: vi.fn().mockResolvedValue([other]), booted: vi.fn() };
  const changed = vi.fn();
  await createConnection(android, changed).open({ serial: other.serial, avd: "Old" });
  expect(changed.mock.lastCall?.[0]).toMatchObject({
    phase: "idle",
    message: expect.stringMatching(/another emulator/i),
  });
  expect(android.booted).not.toHaveBeenCalled();
});
afterEach(() => {
  vi.useRealTimers();
});

it("attaches to the AVD it launched even when another emulator appears first", async () => {
  vi.useFakeTimers();
  const child = { done: new Promise(() => {}), stop: vi.fn() };
  const android = {
    devices: vi.fn().mockResolvedValueOnce([other]).mockResolvedValue([other, wanted]),
    booted: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
    launch: vi.fn().mockResolvedValue(child),
  };
  const changed = vi.fn();
  const connection = createConnection(android, changed);
  const opening = connection.open({ avd: "Pixel" });
  await vi.advanceTimersByTimeAsync(2100);
  await opening;
  expect(android.launch).toHaveBeenCalledTimes(1);
  expect(android.booted.mock.calls.map((c) => c[0])).toEqual([wanted.serial, wanted.serial]);
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: "connected", serial: wanted.serial }),
  );
  const signal = changed.mock.lastCall?.[0].signal;
  connection.disconnect();
  expect(signal.aborted).toBe(true);
  expect(child.stop).not.toHaveBeenCalled();
});

it("cancels an unfinished launch, including a process handle that arrives late", async () => {
  let spawned!: (handle: unknown) => void;
  const reply = new Promise((resolve) => {
    spawned = resolve;
  });
  const launched = { done: Promise.resolve(), stop: vi.fn() };
  const android = { devices: vi.fn().mockResolvedValue([]), launch: vi.fn(() => reply) };
  const changed = vi.fn();
  const connection = createConnection(android, changed);
  const opening = connection.open({ avd: "Pixel" });
  await vi.waitFor(() => expect(android.launch).toHaveBeenCalledOnce());
  connection.disconnect();
  spawned(launched);
  await opening;
  expect(launched.stop).toHaveBeenCalledOnce();
  expect(changed.mock.lastCall?.[0].phase).toBe("idle");
});

it("attaches to an existing device without ever owning its emulator process", async () => {
  const android = {
    devices: vi.fn().mockResolvedValue([other]),
    booted: vi.fn().mockResolvedValue(true),
    launch: vi.fn(),
  };
  const changed = vi.fn();
  const connection = createConnection(android, changed);
  await connection.open({ serial: other.serial });
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ serial: other.serial }));
  connection.disconnect();
  expect(android.launch).not.toHaveBeenCalled();
});

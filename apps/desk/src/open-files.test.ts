import { beforeEach, describe, expect, it, vi } from "vitest";
import { installOpenedFiles } from "./open-files";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let signal: () => void;
const off = vi.fn();
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const host = () => ({
  ready: Promise.resolve(),
  commands: { run: vi.fn(async () => {}) },
  report: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  native.invoke.mockResolvedValue([]);
  native.listen.mockImplementation(async (_event, next) => {
    signal = next;
    return off;
  });
});

describe("OS file delivery", () => {
  it("attaches its listener before the first drain and waits for runtime readiness", async () => {
    const ready = deferred<void>();
    const registered = deferred<() => void>();
    native.listen.mockImplementation((_event, next) => {
      signal = next;
      return registered.promise;
    });
    native.invoke.mockResolvedValueOnce(["/cold/한 글.pdf"]);
    const h = { ...host(), ready: ready.promise };
    const dispose = installOpenedFiles(h);
    expect(native.listen).toHaveBeenCalledWith("desk://open-files", expect.any(Function));
    signal();
    ready.resolve();
    await Promise.resolve();
    expect(native.invoke).not.toHaveBeenCalled();
    registered.resolve(off);
    await vi.waitFor(() => expect(h.commands.run).toHaveBeenCalledOnce());
    expect(native.invoke).toHaveBeenCalledWith("take_open_files");
    expect(h.commands.run).toHaveBeenCalledWith("desk.files.open", { path: "/cold/한 글.pdf" });
    dispose();
  });

  it("drains arrivals during a pending read and during a file open once, in order", async () => {
    const first = deferred<string[]>();
    const opening = deferred<void>();
    const h = host();
    h.commands.run.mockImplementationOnce(() => opening.promise);
    native.invoke
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(["C:/Docs/two words.png"])
      .mockResolvedValueOnce([]);
    const dispose = installOpenedFiles(h);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
    signal();
    signal();
    first.resolve(["/one.pdf"]);
    await vi.waitFor(() => expect(h.commands.run).toHaveBeenCalledOnce());
    signal();
    opening.resolve();
    await vi.waitFor(() => expect(h.commands.run).toHaveBeenCalledTimes(2));
    expect(h.commands.run.mock.calls).toEqual([
      ["desk.files.open", { path: "/one.pdf" }],
      ["desk.files.open", { path: "C:/Docs/two words.png" }],
    ]);
    expect(native.invoke).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("reports one failed file and continues with the rest without retrying it", async () => {
    const h = host();
    h.commands.run.mockRejectedValueOnce(new Error("Permission denied"));
    native.invoke.mockResolvedValueOnce(["/denied.pdf", "/next.png"]);
    const dispose = installOpenedFiles(h);
    await vi.waitFor(() => expect(h.commands.run).toHaveBeenCalledTimes(2));
    expect(h.report).toHaveBeenCalledOnce();
    expect(h.commands.run.mock.calls[1]).toEqual(["desk.files.open", { path: "/next.png" }]);
    dispose();
  });

  it("stops delivery after disposal and cleans up a listener registered late", async () => {
    const registered = deferred<() => void>();
    native.listen.mockReturnValueOnce(registered.promise);
    const h = host();
    const dispose = installOpenedFiles(h);
    dispose();
    registered.resolve(off);
    await vi.waitFor(() => expect(off).toHaveBeenCalledOnce());
    expect(native.invoke).not.toHaveBeenCalled();
    expect(h.commands.run).not.toHaveBeenCalled();
  });

  it("does not deliver later paths from an already drained batch after disposal", async () => {
    const opening = deferred<void>();
    const h = host();
    h.commands.run.mockReturnValueOnce(opening.promise);
    native.invoke.mockResolvedValueOnce(["/first.png", "/later.pdf"]);
    const dispose = installOpenedFiles(h);
    await vi.waitFor(() => expect(h.commands.run).toHaveBeenCalledOnce());
    dispose();
    signal();
    opening.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.commands.run).toHaveBeenCalledOnce();
    expect(off).toHaveBeenCalledOnce();
  });

  it("reports a drain failure and can handle a later notification", async () => {
    native.invoke
      .mockRejectedValueOnce(new Error("IPC unavailable"))
      .mockResolvedValueOnce(["/later.pdf"]);
    const h = host();
    const dispose = installOpenedFiles(h);
    await vi.waitFor(() => expect(h.report).toHaveBeenCalledOnce());
    signal();
    await vi.waitFor(() => expect(h.commands.run).toHaveBeenCalledOnce());
    dispose();
  });
});

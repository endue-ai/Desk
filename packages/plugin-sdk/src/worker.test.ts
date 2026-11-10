import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorker } from "./index";
import { trampoline } from "./worker";

/** A Worker that records how it was made, and the blobs URL.createObjectURL was given. */
function fakeWorkers() {
  const made: Array<{ url: string; options: WorkerOptions | undefined }> = [];
  const blobs = new Map<string, Blob>();
  const revoked: string[] = [];
  class FakeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      made.push({ url: String(url), options });
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  let next = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    next += 1;
    const url = `blob:null/trampoline-${next}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revoked.push(url);
  });
  return { FakeWorker, made, blobs, revoked };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("startWorker", () => {
  it("starts a classic worker from a blob: trampoline that imports the absolute URL", async () => {
    const { FakeWorker, made, blobs } = fakeWorkers();
    const url = "desk-plugin://localhost/test.files/ui/worker.js";

    const worker = startWorker(new URL(url));

    expect(worker).toBeInstanceOf(FakeWorker);
    expect(made).toHaveLength(1);
    const [{ url: started = "", options } = { url: "", options: undefined }] = made;
    expect(started).toMatch(/^blob:/);
    // Chromium refuses a module worker from an opaque frame's blob: a classic one, always.
    expect(options).toEqual({});
    const blob = blobs.get(started);
    expect(blob?.type).toBe("text/javascript");
    expect(await blob?.text()).toBe(trampoline(url));
    expect(await blob?.text()).toContain(`import(${JSON.stringify(url)})`);
  });

  it("resolves a relative URL against the frame's location, and passes the name on", async () => {
    const { made, blobs } = fakeWorkers();
    vi.stubGlobal("location", { href: "desk-plugin://localhost/test.files/ui/index.html" });

    startWorker("./parse.js", { name: "parser" });

    const [{ url = "", options } = { url: "", options: undefined }] = made;
    expect(options).toEqual({ name: "parser" });
    expect(await blobs.get(url)?.text()).toContain(
      `import("desk-plugin://localhost/test.files/ui/parse.js")`,
    );
  });

  it("gives the trampoline URL back a minute later, once the worker surely holds it", () => {
    vi.useFakeTimers();
    try {
      const { made, revoked } = fakeWorkers();
      startWorker("desk-plugin://localhost/test.files/ui/worker.js");
      expect(revoked).toEqual([]);
      vi.advanceTimersByTime(60_000);
      expect(revoked).toEqual([made[0]?.url]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the trampoline", () => {
  /** Run the trampoline in a fake worker scope whose dynamic import is `load`. */
  function run(load: (url: string) => Promise<unknown>) {
    const scope = new EventTarget();
    const code = trampoline("desk-plugin://localhost/p.q/ui/worker.js").replace("import(", "load(");
    new Function("self", "load", code)(scope, load);
    return scope;
  }

  it("keeps messages that come before the module ran and hands them to it, in order", async () => {
    let ready: (value: unknown) => void = () => {};
    const scope = run(() => new Promise((resolve) => (ready = resolve)));
    scope.dispatchEvent(new MessageEvent("message", { data: 1 }));
    scope.dispatchEvent(new MessageEvent("message", { data: 2 }));
    const heard: unknown[] = [];
    // The module runs and listens, as a plugin's worker module does.
    scope.addEventListener("message", (event) => heard.push((event as MessageEvent).data));
    ready(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).toEqual([1, 2]);
    scope.dispatchEvent(new MessageEvent("message", { data: 3 }));
    expect(heard).toEqual([1, 2, 3]);
  });

  it("hands a message once to a module that listens before it has finished running", async () => {
    let ready: (value: unknown) => void = () => {};
    const scope = run(() => new Promise((resolve) => (ready = resolve)));
    const heard: unknown[] = [];
    scope.addEventListener("message", (event) => heard.push((event as MessageEvent).data));
    scope.dispatchEvent(new MessageEvent("message", { data: "early" }));
    expect(heard).toEqual([]);
    ready(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).toEqual(["early"]);
  });
});

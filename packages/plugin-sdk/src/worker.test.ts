import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorker } from "./index";

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
  it("starts a module worker from a blob: trampoline that imports the absolute URL", async () => {
    const { FakeWorker, made, blobs } = fakeWorkers();
    const url = "desk-plugin://localhost/test.files/ui/worker.js";

    const worker = startWorker(new URL(url));

    expect(worker).toBeInstanceOf(FakeWorker);
    expect(made).toHaveLength(1);
    const [{ url: started = "", options } = { url: "", options: undefined }] = made;
    expect(started).toMatch(/^blob:/);
    expect(options).toMatchObject({ type: "module" });
    const blob = blobs.get(started);
    expect(blob?.type).toBe("text/javascript");
    expect(await blob?.text()).toBe(`import ${JSON.stringify(url)};\n`);
  });

  it("resolves a relative URL against the frame's location, and passes the name on", async () => {
    const { made, blobs } = fakeWorkers();
    vi.stubGlobal("location", { href: "desk-plugin://localhost/test.files/ui/index.html" });

    startWorker("./parse.js", { name: "parser" });

    const [{ url = "", options } = { url: "", options: undefined }] = made;
    expect(options).toEqual({ name: "parser", type: "module" });
    expect(await blobs.get(url)?.text()).toBe(
      `import "desk-plugin://localhost/test.files/ui/parse.js";\n`,
    );
  });

  it("gives the trampoline URL back once the worker holds it", () => {
    const { made, revoked } = fakeWorkers();
    startWorker("desk-plugin://localhost/test.files/ui/worker.js");
    expect(revoked).toEqual([made[0]?.url]);
  });
});

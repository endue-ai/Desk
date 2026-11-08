// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { openFile } from "../ui/formats.js";
import { createView } from "../ui/view.js";
import { openWorker } from "../ui/worker-client.js";
import { loadPage } from "./harness";
import { workerHarness } from "./worker-harness";

it("worker rows support keyboard navigation, Reveal/Hide, search and raw-line selection", async () => {
  loadPage();
  const worker = workerHarness();
  const text = '{\n "title": "Desk",\n "password": "fixture-private",\n "items": [1, 2, 3]\n}';
  const opened = await openWorker("sample.json", new TextEncoder().encode(text), worker.start, {
    maskKeys: true,
  });
  const view = createView(document, { validateWith() {}, cancel() {} });
  try {
    view.show({
      buffer: "fixture",
      path: "~/sample.json",
      name: "sample.json",
      size: text.length,
      opened,
      maskKeys: true,
      schema: { state: "none", errors: [] },
    });
    await vi.waitFor(() => expect(document.querySelectorAll("#tree .row").length).toBe(4));
    expect(document.body.textContent).not.toContain("fixture-private");
    const tree = document.querySelector("#tree");
    tree?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector("#pointer")?.textContent).toBe("/title"));
    tree?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await vi.waitFor(() =>
      expect(document.querySelector("#pointer")?.textContent).toBe("/password"),
    );
    (document.querySelector("#reveal") as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.querySelector("#tree")?.textContent).toContain("fixture-private"),
    );
    (document.querySelector("#reveal") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("fixture-private"));
    const search = document.querySelector("#search") as HTMLInputElement;
    search.value = "Desk";
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() =>
      expect(document.querySelector("#search-count")?.textContent).toContain("1 of 1"),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#raw .current")?.getAttribute("data-line")).toBe("2"),
    );
    if (!opened.remote) throw new Error("Missing worker");
    const request = vi.spyOn(opened.remote, "request");
    request.mockRejectedValueOnce(new Error("The data worker stopped."));
    search.value = "missing";
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() =>
      expect(document.querySelector("#status")?.textContent).toBe("The data worker stopped."),
    );
    request.mockRejectedValueOnce(new DOMException("Opening was cancelled.", "AbortError"));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#status")?.textContent).toBe("The data worker stopped.");
    view.show(null);
    expect(document.querySelectorAll("#tree .row")).toHaveLength(0);
  } finally {
    opened.remote?.close();
    worker.close();
  }
});

it("hides a revealed worker value before requesting any lines when its buffer returns", async () => {
  loadPage();
  const worker = workerHarness();
  const secret = "fixture-previously-revealed";
  const opened = await openWorker(
    "private.json",
    new TextEncoder().encode(`{"password":"${secret}"}`),
    worker.start,
  );
  const view = createView(document, { validateWith() {} });
  const model = {
    buffer: "private",
    path: "~/private.json",
    name: "private.json",
    size: 100,
    opened,
    maskKeys: true,
    schema: { state: "none" as const, errors: [] },
  };
  try {
    view.show(model);
    await vi.waitFor(() => expect(document.querySelector("#tree .reveal")).not.toBeNull());
    (document.querySelector("#tree .reveal") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector("#raw")?.textContent).toContain(secret));
    await opened.remote?.request("rows", { count: 0 });
    view.show(null);
    worker.messages.splice(0);
    view.show(model);
    await vi.waitFor(() => expect(document.querySelector("#tree .reveal")).not.toBeNull());
    await vi.waitFor(() => expect(document.querySelector("#raw .line")).not.toBeNull());
    expect(document.body.textContent).not.toContain(secret);
    expect(JSON.stringify(worker.messages)).not.toContain(secret);
  } finally {
    opened.remote?.close();
    worker.close();
  }
});

it("ignores a delayed Reveal selection after the person switches buffers", async () => {
  loadPage();
  const worker = workerHarness();
  const bytes = (text: string) => new TextEncoder().encode(text);
  const opened = await openWorker("first.json", bytes('{"password":"first-secret"}'), worker.start);
  const view = createView(document, { validateWith() {} });
  const model = {
    buffer: "first",
    path: "~/first.json",
    name: "first.json",
    size: 100,
    opened,
    maskKeys: true,
    schema: { state: "none" as const, errors: [] },
  };
  try {
    view.show(model);
    await vi.waitFor(() => expect(document.querySelector("#tree .reveal")).not.toBeNull());
    if (!opened.remote) throw new Error("Missing worker");
    const original = opened.remote.request.bind(opened.remote);
    let finish: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    let selecting = false;
    vi.spyOn(opened.remote, "request").mockImplementation((method, args) => {
      if (method === "tree" && args.action === "select") {
        selecting = true;
        return pending;
      }
      return original(method, args);
    });
    (document.querySelector("#tree .reveal") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(selecting).toBe(true));
    view.show({
      ...model,
      buffer: "second",
      name: "second.json",
      opened: openFile("second.json", bytes('{"password":"second-secret"}')),
    });
    finish(await original("tree", { action: "select", key: "0/0" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).not.toContain("second-secret");
    expect(document.querySelector("#status")?.textContent).not.toContain("Showing the value");
  } finally {
    opened.remote?.close();
    worker.close();
  }
});

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createManager } from "../ui/manage.js";
import { createView } from "../ui/view.js";

const html = readFileSync("plugins/database/ui/index.html", "utf8");

function setup(
  execute: () => Promise<unknown> = async () => {
    throw new Error("not used");
  },
) {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  const confirm = vi.fn(async () => false);
  let cancel: (...args: unknown[]) => unknown = () => {};
  let test: (...args: unknown[]) => unknown = () => {};
  const view = createView(document, (action, ...args) => {
    if (action === "formCancel") return cancel(...args);
    if (action === "formTest") return test(...args);
  });
  const manager = createManager({
    view,
    confirm,
    bridge: { call: async () => ({}) },
    pick: async () => undefined,
    execute,
    forget: async () => {},
    renamed: async () => {},
    changed: () => {},
  } as never);
  cancel = (...args) => Reflect.apply(manager.cancelForm, manager, args);
  test = (...args) => Reflect.apply(manager.test, manager, args);
  manager.create();
  return { confirm, manager };
}

function input(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

function pressEscape(element: HTMLElement) {
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
}

describe("connection form Escape", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("asks before discarding edited fields and keeps them when declined", async () => {
    const { confirm, manager } = setup();
    input("f-name").value = "Orders";
    input("f-host").value = "db.example";
    input("f-user").value = "alice";
    input("f-database").value = "store";
    pressEscape(input("f-database"));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(manager.formOpen()).toBe(true);
    expect((document.getElementById("form") as HTMLFormElement).hidden).toBe(false);
    expect(["name", "host", "user", "database"].map((name) => input(`f-${name}`).value)).toEqual([
      "Orders",
      "db.example",
      "alice",
      "store",
    ]);
  });

  it("closes an untouched form without asking and focuses the connection list", async () => {
    const { confirm, manager } = setup();
    pressEscape(input("f-name"));
    await vi.waitFor(() => expect(manager.formOpen()).toBe(false));
    expect(confirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById("tree"));
  });

  it("lets an open select handle Escape without closing the form", () => {
    const { confirm, manager } = setup();
    const select = document.getElementById("f-engine") as HTMLSelectElement;
    select.focus();
    select.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    pressEscape(select);
    expect(manager.formOpen()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("preserves typed fields while a connection test runs and when its result arrives", async () => {
    let finish: (value: unknown) => void = () => {};
    const running = new Promise((resolve) => {
      finish = resolve;
    });
    const { confirm, manager } = setup(() => running);
    input("f-name").value = "Orders";
    input("f-host").value = "db.example";
    input("f-port").value = "05432";
    input("f-user").value = "alice";
    input("f-database").value = "store";
    document.getElementById("form-test")?.click();
    expect(input("f-host").value).toBe("db.example");
    expect(input("f-port").value).toBe("05432");
    input("f-user").value = "bob";
    finish({ result: { ms: 1, statements: [{ sets: [{ rows: [["PostgreSQL"]] }] }] } });
    await vi.waitFor(() =>
      expect(document.getElementById("form-note")?.textContent).toContain("Connected"),
    );
    expect(input("f-user").value).toBe("bob");
    pressEscape(input("f-user"));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(manager.formOpen()).toBe(true);
    expect(input("f-user").value).toBe("bob");
  });
});

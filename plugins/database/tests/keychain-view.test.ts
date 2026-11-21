// @vitest-environment jsdom
// The keychain choice on the page (#443): the form shows it for PostgreSQL only and hands it back with
// the fields; the password prompt shows it when the manager offers it and hands it back with the
// password, which leaves the DOM at once; nothing changed is not a change to ask about.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blank } from "../ui/connections.js";
import { createForms } from "../ui/view-form.js";

const html = readFileSync("plugins/database/ui/index.html", "utf8");
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setup() {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  const act = vi.fn();
  return { act, forms: createForms(document, act) };
}

describe("the keychain choice on the page", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the form's choice for PostgreSQL only and hands it back with the fields", () => {
    const { act, forms } = setup();
    const fields = { ...blank("postgresql"), id: "c-1", name: "Shop", keychain: true };
    forms.form({ mode: "edit", fields, error: "", note: "" });
    const box = byId<HTMLInputElement>("f-keychain");
    expect(box.closest("label")?.hidden).toBe(false);
    expect(box.checked).toBe(true);
    const engine = byId<HTMLSelectElement>("f-engine");
    engine.value = "mysql";
    engine.dispatchEvent(new Event("change"));
    expect(box.closest("label")?.hidden).toBe(true);
    engine.value = "postgresql";
    engine.dispatchEvent(new Event("change"));
    box.checked = false;
    byId<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(act).toHaveBeenLastCalledWith("formSave", expect.objectContaining({ keychain: false }));
  });

  it("shows the prompt's choice when offered and hands it back with the password", () => {
    const { act, forms } = setup();
    const box = byId<HTMLInputElement>("password-keychain");
    forms.password({ connection: "Notes", message: "asks" });
    expect(box.closest("label")?.hidden).toBe(true);
    forms.password({ connection: "Shop", message: "no password supplied", remember: true });
    expect(box.closest("label")?.hidden).toBe(false);
    expect(box.checked).toBe(true);
    const secret = byId<HTMLInputElement>("password-value");
    secret.value = "fixture-keychain-password";
    byId<HTMLFormElement>("password").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(act).toHaveBeenLastCalledWith("password", "fixture-keychain-password", true);
    expect(secret.value).toBe("");
    forms.password({ connection: "Shop", message: "asks", remember: false });
    expect(box.checked).toBe(false);
  });
});

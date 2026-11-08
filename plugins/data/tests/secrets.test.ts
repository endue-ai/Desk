// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isSecretKey } from "../ui/secrets.js";
import { disk, file, mountPage } from "./harness";

const ENV = file("~/data/.env");
const JSON_FILE = file("~/data/config.json");
const FILES = {
  [ENV.path]: "# local\nDB_PASSWORD=hunter2\nexport USER_NAME=example\n",
  [JSON_FILE.path]: `{
  "db": { "user": "example", "password": "hunter2" },
  "api-key": "xxxx",
  "Private_Key": { "pem": "hunter2" },
  "max_tokens": 100
}
`,
};

const html = () => document.body.innerHTML;
const count = (text: string, needle: string) => text.split(needle).length - 1;
const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const click = (selector: string) => $(selector).click();
const rowOf = (key: string) => {
  const row = [...document.querySelectorAll<HTMLElement>("[role=treeitem]")].find(
    (r) => r.querySelector(".key")?.textContent === key,
  );
  if (!row) throw new Error(`no row ${key}`);
  return row;
};
const search = (query: string) => {
  const input = $("#search") as HTMLInputElement;
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
};

describe("the key rule", () => {
  it("matches the secret words case-insensitively, with - and _ alike", () => {
    for (const key of [
      "password",
      "DB_PASSWORD",
      "passwd",
      "client-secret",
      "clientSecret",
      "access_token",
      "api_key",
      "x-api-key",
      "APIKEY",
      "apiKey",
      "private_key",
      "Private-Key",
      "@password",
    ])
      expect(isSecretKey(key), key).toBe(true);
    for (const key of [
      "max_tokens",
      "tokenizer",
      "keyboard",
      "public_key",
      "user",
      "api",
      "secretary",
    ])
      expect(isSecretKey(key), key).toBe(false);
  });
});

describe("secrets stay masked", () => {
  it("every dotenv value shows as dots in the tree and the raw view", async () => {
    const { host } = await mountPage({ handlers: disk(FILES) });
    await host.command("desk.files.visit", ENV);
    click("#expand-all");
    expect(rowOf("DB_PASSWORD").textContent).toContain("•");
    expect(html()).not.toContain("hunter2");
    expect(html()).not.toContain("example");
    expect($("#raw").textContent).toContain("DB_PASSWORD=");
  });

  it("values under secret-looking keys are masked in the tree, the raw view and search", async () => {
    const { host } = await mountPage({ handlers: disk(FILES) });
    await host.command("desk.files.visit", JSON_FILE);
    click("#expand-all");
    expect(rowOf("password").textContent).toContain("•");
    expect(rowOf("pem").textContent).toContain("•");
    expect(html()).not.toContain("hunter2");
    expect(html()).not.toContain("xxxx");
    expect(html()).toContain("example");
    expect(rowOf("max_tokens").textContent).toContain("100");
    expect($("#raw").textContent).toContain('"password": ');

    search("password");
    expect($("#search-count").textContent).toMatch(/1 of 1/);
    expect(rowOf("password").getAttribute("aria-selected")).toBe("true");
    expect(html()).not.toContain("hunter2");
    search("hunter2");
    expect($("#search-count").textContent).toMatch(/No matches/);
  });

  it("reveal shows one value at a time, and showing the file again masks it", async () => {
    const { host } = await mountPage({ handlers: disk(FILES) });
    await host.command("desk.files.visit", JSON_FILE);
    click("#expand-all");
    rowOf("password").click();
    const reveal = $("#reveal") as HTMLButtonElement;
    expect(reveal.hidden).toBe(false);
    expect(reveal.textContent).toBe("Reveal value");
    reveal.click();
    expect(rowOf("password").textContent).toContain("hunter2");
    expect(count($("#tree").innerHTML, "hunter2")).toBe(1);
    expect(html()).not.toContain("xxxx");

    rowOf("api-key").click();
    click("#reveal");
    expect(rowOf("api-key").textContent).toContain("xxxx");
    expect(html()).not.toContain("hunter2");

    await host.command("desk.buffers.show", JSON_FILE);
    expect(html()).not.toContain("xxxx");
    expect(html()).not.toContain("hunter2");

    rowOf("user").click();
    expect(($("#reveal") as HTMLButtonElement).hidden).toBe(true);
  });

  it("the setting turns the key rule off, and dotenv values stay masked", async () => {
    const { host, settle } = await mountPage({
      handlers: disk(FILES),
      settings: { "mask-secrets": false },
    });
    await host.command("desk.files.visit", JSON_FILE);
    click("#expand-all");
    expect(rowOf("password").textContent).toContain("hunter2");
    expect(html()).toContain("xxxx");

    await host.call("settings.set", { key: "mask-secrets", value: true }, "endue.data");
    await settle();
    expect(html()).not.toContain("hunter2");

    await host.call("settings.set", { key: "mask-secrets", value: false }, "endue.data");
    await settle();
    await host.command("desk.files.visit", ENV);
    click("#expand-all");
    expect(html()).not.toContain("hunter2");
  });
});

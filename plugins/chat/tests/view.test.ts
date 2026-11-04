// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createView } from "../ui/view.js";
import { at, chat, SLACK, sample } from "./chat-fixtures";
import { type MountOptions, mount } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const $ = <T extends Element = HTMLElement>(selector: string) => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const key = (target: EventTarget, init: KeyboardEventInit & { keyCode?: number }) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: init.keyCode });
  target.dispatchEvent(event);
  return event;
};

async function drawn(options: MountOptions = {}) {
  return mount({
    ...options,
    dom: (app) =>
      createView(document, {
        command: (id, args) =>
          app()
            ?.command(id, args ?? {})
            .catch(() => {}),
        open: (k) =>
          app()
            ?.openConversation(k)
            .catch(() => {}),
        activate: (k) =>
          app()
            ?.activate(k)
            .catch(() => {}),
        select: (k) => app()?.select(k),
        key: (name, where) => app()?.key(name, where) ?? false,
        more: (where) => app()?.more(where),
        type: (target, text) => app()?.type(target, text),
        cancelEdit: () => app()?.cancelEdit() ?? false,
        closeThread: () => app()?.closeThread() ?? false,
        retry: (k) => app()?.retry(k),
        discard: (k) => app()?.discard(k),
        link: (url) => app()?.link(url),
      }),
  });
}

// A fresh body for every test, so no view of an earlier test still listens.
beforeEach(() => {
  const body = document.createElement("body");
  body.innerHTML =
    /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "";
  document.documentElement.replaceChild(body, document.body);
});

describe("the page", () => {
  it("draws the services, filters and conversations, and opens one on a click", async () => {
    const { settle } = await drawn();
    expect(all("#platforms .chip .name").map((n) => n.textContent)).toEqual([
      "All",
      "Discord",
      "Microsoft Teams",
      "Slack",
    ]);
    expect(all("#filters button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "All",
      "Unread, 5",
      "Mentions, 1",
      "Direct, 1",
      "Saved",
    ]);
    expect(all("#groups .group-title").map((g) => g.textContent)).toEqual([
      "DiGamers",
      "SlAcme",
      "Direct messages",
    ]);
    $('[role=option][data-conv="acme.slack/work@C1"]').click();
    await settle();
    expect($("#main .pane-head h2").textContent).toBe("#general");
    expect($('[role=option][data-conv="acme.slack/work@C1"]').getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(all("#main article.msg .author").map((a) => a.textContent)).toEqual([
      "Mina",
      "Jun",
      "Mina",
    ]);
    expect($("#main .new-line").textContent).toBe("New");
    expect($("#main strong").textContent).toBe("10");
    expect($("#main .text a").getAttribute("href")).toBe("https://ci.example.com/1042");
    expect($("#main .replies").textContent).toBe("2 replies");
  });

  it("never draws a message's text as HTML", async () => {
    const evil = chat(SLACK, {
      id: "evil",
      receivedAt: at(30, "08:59"),
      body: "<img src=x onerror=alert(1)><script>alert(2)</script> [x](javascript:alert(3))",
      raw: { workspace: "Acme", channel: "C1", channelName: "general<b>" },
    });
    const { app, settle } = await drawn({ items: [...sample(), evil] });
    await app.openConversation("acme.slack/work@C1");
    await settle();
    expect(document.querySelector("#main img, #main script, #main b")).toBeNull();
    expect(all("#main a").every((a) => /^https?:/.test(a.getAttribute("href") ?? ""))).toBe(true);
    expect($("#main article.msg:last-of-type .text").textContent).toContain(
      "<script>alert(2)</script>",
    );
  });

  it("Enter sends, Shift+Enter does not, and Enter while an IME composes does not", async () => {
    const { app, ran, settle } = await drawn();
    await app.openConversation("acme.discord/default@G1");
    await settle();
    const box = $<HTMLTextAreaElement>("#main .composer textarea");
    box.value = "안녕";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    key(box, { key: "Enter", isComposing: true });
    key(box, { key: "Enter", keyCode: 229 });
    key(box, { key: "Enter", shiftKey: true });
    await settle();
    expect(ran("acme.discord.chat.send")).toEqual([]);
    key(box, { key: "Enter" });
    await settle();
    expect(ran("acme.discord.chat.send")).toEqual([
      { instance: "default", channel: "G1", text: "안녕" },
    ]);
    expect($<HTMLTextAreaElement>("#main .composer textarea").value).toBe("");
  });

  it("letters switch layouts, move through messages and act on the selected one", async () => {
    const { app, store, settle } = await drawn();
    await app.openConversation("acme.slack/work@C1");
    await settle();
    key(document.body, { key: "j" });
    await settle();
    expect($("#main article.msg.selected .author").textContent).toBe("Mina");
    key(document.body, { key: "s" });
    await settle();
    expect(store.saved).toEqual(["acme.slack/work#s-1"]);
    key(document.body, { key: "3" });
    await settle();
    expect(document.body.dataset.layout).toBe("timeline");
    expect(all("#main .where").length).toBeGreaterThan(0);
    // A chord is the desk's: the plugin leaves it alone.
    expect(key(document.body, { key: "3", metaKey: true }).defaultPrevented).toBe(false);
    key(document.body, { key: "2" });
    await settle();
    // #general was read when it opened, so it has no card.
    expect(all("#main .pane.card h3").map((h) => h.textContent)).toEqual([
      "Mina",
      "#design",
      "#raids",
    ]);
  });

  it("a reaction chip toggles the person's reaction; a link opens through the desk", async () => {
    const { app, ran, params, settle } = await drawn();
    await app.openConversation("acme.discord/default@G1");
    await settle();
    all("#main .reaction")
      .find((b) => b.getAttribute("aria-label") === "🔥 1")
      ?.click();
    await settle();
    expect(ran("acme.discord.chat.react")).toEqual([
      { instance: "default", channel: "G1", id: "d-2", emoji: "🔥", on: true },
    ]);
    expect($("#main .reaction.mine .count").textContent).toBeTruthy();
    await app.openConversation("acme.slack/work@C1");
    await settle();
    $("#main .text a").click();
    await settle();
    expect(params("shell.open")).toEqual([
      {
        target: "https://ci.example.com/1042",
        scope: { permission: "shell:open", schemes: ["http", "https", "mailto"] },
      },
    ]);
  });

  it("the thread opens beside the conversation and Escape closes it", async () => {
    const { settle } = await drawn();
    $('[role=option][data-conv="acme.slack/work@C1"]').click();
    await settle();
    $("#main .replies").click();
    await settle();
    expect($("#thread").hidden).toBe(false);
    expect(document.body.dataset.thread).toBe("open");
    expect(all("#thread article.msg .author").map((a) => a.textContent)).toEqual([
      "Mina",
      "Jun",
      "Me",
    ]);
    key(document.body, { key: "Escape" });
    await settle();
    expect($("#thread").hidden).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { LATEST_ARGS, MAX_LATEST } from "../ui/latest.js";
import { mount } from "./harness";

const manifest = () =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8")) as PluginManifest;

describe("endue.mail.latest, Eris's tool (ADR 0089)", () => {
  it("is offered to agents, only reads, and declares the args the command reads (ADR 0088)", () => {
    const latest = manifest().contributes?.commands?.find((c) => c.id === "endue.mail.latest");
    expect(latest?.description).toMatch(/newest messages/);
    expect(latest?.args).toEqual(LATEST_ARGS);
    expect(latest?.agent).toBe(true);
    expect(latest?.readOnly).toBe(true);
    expect(latest?.irreversible).toBeUndefined();
  });

  it("answers the inbox's newest messages with a line for people, and leaves the screen alone", async () => {
    const { view, host } = await mount();
    const before = view.shown();
    const answer = (await host.command("endue.mail.latest", { limit: 2 })) as {
      mailbox: string;
      messages: { from: string; subject: string; unread: boolean }[];
      text: string;
    };
    expect(answer.mailbox).toBe("inbox");
    expect(answer.messages.map((m) => m.subject)).toEqual([
      "Lunch today?",
      "Invitation: Design review",
    ]);
    expect(answer.messages[0]).toMatchObject({ from: "Mina", unread: true });
    expect(answer.text).toBe(
      "The newest 2 messages in Inbox (2 unread): Mina: Lunch today?; Mina: Invitation: Design review.",
    );
    expect(view.shown()).toEqual(before);
    expect(view.navs.at(-1)?.current).toBe("inbox");
  });

  it("reads another mailbox, only unread mail, and caps how many", async () => {
    const { host } = await mount();
    const sent = (await host.command("endue.mail.latest", { mailbox: "sent" })) as {
      text: string;
    };
    expect(sent.text).toBe(
      "The newest 1 message in Sent (0 unread): me@example.com: Re: Offsite ideas.",
    );
    const unread = (await host.command("endue.mail.latest", { unread: true, limit: 99 })) as {
      messages: { unread: boolean }[];
    };
    expect(unread.messages.length).toBeLessThanOrEqual(MAX_LATEST);
    expect(unread.messages.every((m) => m.unread)).toBe(true);
    await expect(host.command("endue.mail.latest", { mailbox: "spam" })).rejects.toThrow(
      "spam is not a mailbox.",
    );
  });
});

// A draft is kept only while it holds something the person or an agent wrote (#160, QA draft 06 #22):
// opening and closing an empty new message leaves no draft behind, nor does one that holds only the
// signature the plugin put there, and a draft emptied by hand leaves the store at its next save.
import { describe, expect, it } from "vitest";
import { blank, newDraft } from "../ui/compose.js";
import { mount } from "./harness";

const draftsCount = (mounted: Awaited<ReturnType<typeof mount>>) =>
  mounted.view.navs.at(-1)?.mailboxes.find((b) => b.id === "drafts")?.count;

describe("empty drafts", () => {
  it("an empty new message closed by Close or Escape leaves no draft", async () => {
    const mounted = await mount();
    const { host, app, view, store, settle } = mounted;
    await host.command("endue.mail.compose", {});
    expect(view.draft()).not.toBeNull();
    app.writing.close();
    await settle();
    expect(view.draft()).toBeNull();
    expect(store.drafts ?? []).toEqual([]);
    expect(draftsCount(mounted)).toBeUndefined();
  });

  it("a message that holds only the signature is empty too", async () => {
    const mounted = await mount({ settings: { signature: "-- me" } });
    await mounted.host.command("endue.mail.compose", {});
    expect(mounted.view.draft()?.body).toBe("\n\n-- me");
    mounted.app.writing.close();
    await mounted.settle();
    expect(mounted.store.drafts ?? []).toEqual([]);
    expect(draftsCount(mounted)).toBeUndefined();
  });

  it("a written draft is kept, and goes from the store once the person empties it", async () => {
    const mounted = await mount();
    const { host, app, store, settle } = mounted;
    await host.command("endue.mail.compose", {});
    app.writing.edit({ subject: "Lunch" });
    await new Promise((resolve) => setTimeout(resolve, 320));
    await settle();
    expect(store.drafts).toMatchObject([{ subject: "Lunch" }]);
    expect(draftsCount(mounted)).toBe("1");
    app.writing.edit({ subject: "" });
    app.writing.close();
    await settle();
    expect(store.drafts).toEqual([]);
    expect(draftsCount(mounted)).toBeUndefined();
  });

  it("a command's arguments are kept at once, as the agent wrote them", async () => {
    const { host, store, settle } = await mount();
    await host.command("endue.mail.compose", { subject: "Report" });
    await settle();
    expect(store.drafts).toMatchObject([{ subject: "Report" }]);
  });

  it("empty drafts an earlier version kept are not shown", async () => {
    const kept = newDraft({ subject: "Later", now: "2026-10-29T00:00:00Z" });
    const empty = newDraft({ now: "2026-10-29T00:00:00Z" });
    const mounted = await mount({ store: { drafts: [kept, empty] } });
    expect(draftsCount(mounted)).toBe("1");
    await mounted.app.setMailbox("drafts");
    expect(mounted.view.shown()).toHaveLength(1);
  });

  it("blank() reads the recipients, the subject and the text, less the signature", () => {
    expect(blank(newDraft())).toBe(true);
    expect(blank({ ...newDraft(), to: " ", body: "\n\n" })).toBe(true);
    expect(blank(newDraft({ signature: "-- me" }), "-- me")).toBe(true);
    expect(blank(newDraft({ signature: "-- me" }))).toBe(false);
    expect(blank(newDraft({ body: "Hi", signature: "-- me" }), "-- me")).toBe(false);
    for (const field of ["to", "cc", "bcc", "subject"])
      expect(blank({ ...newDraft(), [field]: "x" })).toBe(false);
  });
});

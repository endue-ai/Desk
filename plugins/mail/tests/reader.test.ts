// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { messageOf } from "../ui/model.js";
import { createReader } from "../ui/reader.js";
import { sample } from "./mail-fixtures";

it.each(["archive", "trash"])("returns the displayed %s message to Inbox", (mailbox) => {
  const item = sample()[0];
  if (!item) throw new Error("No sample message.");
  const message = messageOf({ ...item, raw: { ...item.raw, mailbox } });
  const root = document.createElement("section");
  const command = vi.fn();
  const reader = createReader(document, root, { command, openMessage: vi.fn() });
  reader.show({ message, earlier: [], actions: ["move"] });
  const button = [...root.querySelectorAll("button")].find(
    (b) => b.textContent === "Move to Inbox",
  );
  expect(button?.disabled).toBe(false);
  button?.click();
  expect(command).toHaveBeenCalledWith("endue.mail.move", {
    source: message.source,
    id: message.id,
    mailbox: "inbox",
  });
  reader.show({ message, earlier: [], actions: [] });
  expect(
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Move to Inbox")?.disabled,
  ).toBe(true);
});

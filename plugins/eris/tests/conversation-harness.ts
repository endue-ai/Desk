import { readFileSync } from "node:fs";
import { vi } from "vitest";
import { REDUCED } from "../ui/soul-text.js";
import { Talk } from "../ui/talk.js";

export function mounted(
  options: {
    saved?: unknown;
    files?: Array<{ path?: string; name?: string; modified?: boolean }>;
    pick?: string | null;
    read?: (params: Record<string, unknown>) => unknown;
    granted?: boolean;
    failSend?: boolean;
  } = {},
) {
  const doc = document;
  doc.documentElement.innerHTML = readFileSync("plugins/eris/ui/index.html", "utf8");
  Element.prototype.animate = vi.fn(() => ({}) as Animation);
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let listen = (_event: unknown) => {};
  let saved = options.saved;
  let turn = 0;
  const bridge = {
    onEvent: (fn: typeof listen) => {
      listen = fn;
      return () => {};
    },
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "brain.say") {
        if (options.failSend) throw new Error("offline");
        return { turnId: `t${++turn}` };
      }
      if (method === "perm.request") return { granted: options.granted ?? true };
      if (method === "fs.read")
        return (
          options.read?.(params) ?? {
            content: "hello from the file",
            encoding: "utf8",
            size: 19,
          }
        );
      throw new Error(`Unexpected call ${method}`);
    },
  };
  const commands = {
    run: vi.fn(async (name: string) =>
      name === "desk.buffers.list"
        ? (options.files ?? [{ path: "~/notes.txt", name: "notes.txt" }])
        : options.pick === null
          ? undefined
          : (options.pick ?? "~/notes.txt"),
    ),
  };
  const state = {
    get: () => saved,
    set: (value: unknown) => {
      saved = value;
    },
  };
  const app = new Talk({
    doc,
    bridge,
    commands,
    state,
    show: vi.fn(),
    reduced: true,
    style: REDUCED,
    timeline: { time: 0, add: vi.fn(), at: vi.fn() },
  });
  app.start();
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const emit = (kind: string, text?: string) =>
    listen({
      event: "brain.turn",
      data: { turnId: `t${turn}`, kind, ...(text === undefined ? {} : { text }) },
    });
  const input = doc.getElementById("say-text") as HTMLInputElement;
  const send = async (text: string) => {
    input.value = text;
    await app.send(text);
  };
  const click = async (id: string) => {
    const button = doc.getElementById(id);
    if (!button) throw new Error(`Missing control: ${id}`);
    button.click();
    await settle();
  };
  const text = () => doc.getElementById("conversation")?.textContent ?? "";
  return { app, doc, input, calls, commands, send, emit, click, text, settle, saved: () => saved };
}

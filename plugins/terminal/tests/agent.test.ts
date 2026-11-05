import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { plainText } from "../ui/agent.js";
import { mount, scope } from "./harness";

const manifest = () =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8")) as PluginManifest;

const output = (data: string, encoding: "utf8" | "base64" = "utf8") => ({
  event: "proc.output" as const,
  data: { procId: "p1", stream: "pty" as const, data, encoding },
});

describe("the terminal for agents (ADR 0088)", () => {
  it("lists the sessions with their program and which one is on screen", async () => {
    const { host } = await mount();
    const sessions = (await host.command("endue.terminal.sessions")) as Array<
      Record<string, unknown>
    >;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ session: "t-1", running: true, shown: true });
    expect(typeof sessions[0]?.command).toBe("string");
  });

  it("answers what the program printed last, as plain text", async () => {
    const { host, settle } = await mount();
    host.emit(output("\x1b[1;32m~/repo\x1b[0m $ ls\r\n"));
    host.emit(output(btoa("a.txt  b.txt\r\n"), "base64"));
    host.emit(output("\x1b]0;title\x07progress 10%\rprogress 99%\r\n", "utf8"));
    await settle();
    const read = await host.command("endue.terminal.output", {});
    expect(read).toEqual({
      session: "t-1",
      text: "~/repo $ ls\na.txt  b.txt\nprogress 99%\n",
      truncated: false,
      running: true,
    });
    const tail = (await host.command("endue.terminal.output", { chars: 4 })) as { text: string };
    expect(tail).toMatchObject({ text: "99%\n", truncated: true });
    await expect(host.command("endue.terminal.output", { session: "t-9" })).rejects.toThrow(
      "No terminal t-9.",
    );
  });

  it("types text into the program under the shell's scope, Enter unless asked not to", async () => {
    const { host, params, settle } = await mount();
    await host.command("endue.terminal.send", { text: "git status" });
    await host.command("endue.terminal.send", { session: "t-1", text: "q", enter: false });
    await settle();
    const writes = params("proc.write") as Array<{ data: string; scope: unknown }>;
    expect(writes.map((w) => w.data)).toEqual(["git status\r", "q"]);
    const shell = (writes[0]?.scope as { commands: string[] } | undefined)?.commands[0] ?? "";
    expect(writes[0]?.scope).toEqual(scope(shell));
    await expect(host.command("endue.terminal.send", {})).rejects.toThrow("Say what to type");
  });

  it("offers agents reads, actions and the two that run programs as irreversible", () => {
    const commands = manifest().contributes?.commands ?? [];
    const flags = Object.fromEntries(
      commands
        .filter((c) => c.agent)
        .map((c) => [c.id, c.readOnly ? "reads" : c.irreversible ? "irreversible" : "acts"]),
    );
    expect(flags).toEqual({
      "endue.terminal.new": "acts",
      "endue.terminal.close": "acts",
      "endue.terminal.interrupt": "acts",
      "endue.terminal.run": "irreversible",
      "endue.terminal.sessions": "reads",
      "endue.terminal.output": "reads",
      "endue.terminal.send": "irreversible",
    });
  });

  it("keeps a line as its last carriage return left it", () => {
    expect(plainText([{ data: "50%\r100%\r\nok\r\n", encoding: "utf8" }])).toBe("100%\nok\n");
  });
});

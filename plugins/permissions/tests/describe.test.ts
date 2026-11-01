import { describe, expect, it } from "vitest";
import type { Permission } from "../../../packages/bridge/src/index";
import {
  broadWarning,
  describeCaller,
  describePermission,
  durationLabel,
  fileManagerOf,
} from "../ui/describe.js";
import { plugin } from "./harness";

describe("permissions in words", () => {
  it("puts every permission and its scope in words", () => {
    const cases: Array<[Permission, string, string]> = [
      [
        { permission: "fs:read", paths: ["~/Notes/**", "/srv/shared"] },
        "Read files",
        "~/Notes/**, /srv/shared",
      ],
      [{ permission: "fs:write", paths: ["~/Notes/**"] }, "Write files", "~/Notes/**"],
      [{ permission: "proc:spawn", commands: ["git"] }, "Run programs", "git"],
      [
        { permission: "proc:spawn", commands: ["git", "npm"], pty: true },
        "Run programs",
        "git, npm, in a terminal",
      ],
      [
        { permission: "net:fetch", hosts: ["api.example.com"] },
        "Use the network",
        "api.example.com",
      ],
      [{ permission: "audio:capture" }, "Use the microphone", ""],
      [{ permission: "audio:capture", wakeWord: true }, "Use the microphone", "with the wake word"],
      [{ permission: "ui:surface" }, "Open its surfaces", ""],
      [{ permission: "ui:notify" }, "Show notifications", ""],
      [{ permission: "plugin:manage" }, "Manage plugins", ""],
      [{ permission: "brain:converse" }, "Talk to the brain", ""],
      [{ permission: "cmd:invoke", ids: ["eris.*"] }, "Run commands", "eris.*"],
      [{ permission: "cmd:advise" }, "Hook into commands", ""],
      [
        { permission: "settings:read", keys: ["endue.eris/voice"] },
        "Read settings",
        "endue.eris/voice",
      ],
      [{ permission: "log:read" }, "Read the logs", ""],
      [
        { permission: "events:subscribe", names: ["perm.changed"] },
        "Watch desk events",
        "perm.changed",
      ],
      [{ permission: "perm:manage" }, "Manage permissions", ""],
    ];
    for (const [permission, label, scope] of cases) {
      expect(describePermission(permission), permission.permission).toEqual({ label, scope });
    }
    const unknown = { permission: "camera:capture" } as unknown as Permission;
    expect(describePermission(unknown)).toEqual({ label: "camera:capture", scope: "" });
  });

  it("puts shell:open in words: links in the browser, files in the platform's file manager", () => {
    const links: Permission = { permission: "shell:open", schemes: ["https", "mailto"] };
    const files: Permission = { permission: "shell:open", paths: ["~/Downloads/**"] };
    const both: Permission = { permission: "shell:open", schemes: ["https"], paths: ["~/Desk/**"] };
    expect(describePermission(links, "Finder")).toEqual({
      label: "Open links (https, mailto) in your browser",
      scope: "",
    });
    expect(describePermission(files, "Finder")).toEqual({
      label: "Show files in Finder",
      scope: "~/Downloads/**",
    });
    expect(describePermission(files, "Explorer").label).toBe("Show files in Explorer");
    expect(describePermission(both, "the file manager")).toEqual({
      label: "Open links (https) in your browser and show files in the file manager",
      scope: "~/Desk/**",
    });
    expect(fileManagerOf("MacIntel")).toBe("Finder");
    expect(fileManagerOf("Win32")).toBe("Explorer");
    expect(fileManagerOf("Linux x86_64")).toBe("the file manager");
    expect(describePermission(files).label).toBe(
      `Show files in ${fileManagerOf(globalThis.navigator?.platform ?? "")}`,
    );
  });

  it("names the three durations", () => {
    expect(durationLabel("once")).toBe("Once");
    expect(durationLabel("session")).toBe("This session");
    expect(durationLabel("always")).toBe("Always");
  });
});

describe("broad requests", () => {
  it("warns about broad scopes", () => {
    const broad: Permission[] = [
      { permission: "proc:spawn", commands: ["git", "bash"] },
      { permission: "proc:spawn", commands: ["/usr/bin/python3"] },
      { permission: "proc:spawn", commands: ["C:/Windows/System32/cmd.exe"] },
      { permission: "net:fetch", hosts: ["api.example.com", "*.com"] },
      { permission: "fs:read", paths: ["/**"] },
      { permission: "fs:read", paths: ["~/**"] },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: ${home} is a literal path root
      { permission: "fs:write", paths: ["${home}"] },
      { permission: "fs:write", paths: ["C:/"] },
      { permission: "cmd:invoke", ids: ["*"] },
      { permission: "settings:read", keys: ["*/*"] },
      { permission: "perm:manage" },
    ];
    for (const permission of broad) {
      expect(broadWarning(permission), JSON.stringify(permission)).toMatch(/^It can .+\.$/);
    }
    expect(broadWarning({ permission: "proc:spawn", commands: ["bash"] })).toBe(
      "It can run any program through bash.",
    );
    expect(broadWarning({ permission: "net:fetch", hosts: ["*.com"] })).toBe(
      "It can reach every site under .com.",
    );
    expect(broadWarning({ permission: "fs:read", paths: ["~/**"] })).toBe(
      "It can read every file in your home folder.",
    );
    expect(broadWarning({ permission: "fs:write", paths: ["/"] })).toBe(
      "It can change every file on the disk.",
    );
  });

  it("keeps narrow scopes calm", () => {
    const narrow: Permission[] = [
      { permission: "fs:read", paths: ["~/Notes/**"] },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: ${plugin} is a literal path root
      { permission: "fs:write", paths: ["${plugin}/cache/**"] },
      { permission: "proc:spawn", commands: ["git"], pty: true },
      { permission: "net:fetch", hosts: ["api.example.com", "*.example.com"] },
      { permission: "cmd:invoke", ids: ["eris.*"] },
      { permission: "settings:read", keys: ["endue.eris/*"] },
      { permission: "ui:notify" },
    ];
    for (const permission of narrow) {
      expect(broadWarning(permission), JSON.stringify(permission)).toBeNull();
    }
  });
});

describe("callers", () => {
  it("names callers and their kind", () => {
    const plugins = [
      plugin("example.notes", "Notes", "ui"),
      plugin("example.indexer", "Indexer", "logic"),
      plugin("example.git", "Git tools", "tool"),
    ];
    expect(describeCaller("example.notes", plugins)).toEqual({
      id: "example.notes",
      name: "Notes",
      kind: "UI plugin",
    });
    expect(describeCaller("example.indexer", plugins).kind).toBe("Logic plugin");
    expect(describeCaller("example.git", plugins).kind).toBe("Tool plugin");
    expect(describeCaller("desk", plugins)).toEqual({ id: "desk", name: "Desk", kind: "Runtime" });
    expect(describeCaller("core", plugins)).toEqual({ id: "core", name: "Desk", kind: "Core" });
    expect(describeCaller("example.gone", plugins)).toEqual({
      id: "example.gone",
      name: "example.gone",
      kind: "Plugin",
    });
    expect(describeCaller("cli", [])).toEqual({ id: "cli", name: "cli", kind: "Desk" });
  });
});

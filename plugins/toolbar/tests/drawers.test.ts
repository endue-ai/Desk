import { describe, expect, it } from "vitest";
import { accessDrawer, drawers, pluginsDrawer } from "../ui/drawers.js";

type Info = {
  id: string;
  status: "ready" | "failed";
  enabled: boolean;
  builtIn: boolean;
  revision: number;
  manifest?: Record<string, unknown>;
  error?: string;
};

const plugin = (
  id: string,
  name: string,
  permissions: Record<string, unknown>[] = [],
  extra: Partial<Info> = {},
): Info => ({
  id,
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  manifest: { id, name, version: "0.1.0", kind: "ui", entry: "ui/index.html", permissions },
  ...extra,
});

describe("the Plugins drawer", () => {
  it("counts plugins on, off and failed, and lists the failed ones first with their reasons", () => {
    const drawer = pluginsDrawer([
      plugin("endue.eris", "Eris"),
      plugin("endue.dock", "Dock"),
      plugin("example.quiet", "Quiet", [], { enabled: false }),
      plugin("example.broken", "Broken", [], { status: "failed", error: "entry is missing" }),
    ]);
    expect(drawer).toMatchObject({
      id: "plugins",
      title: "Plugins",
      summary: "2 on · 1 off · 1 failed",
      warning: true,
    });
    expect(drawer.rows).toEqual([
      { label: "Broken", detail: "entry is missing", warning: true },
      { label: "Quiet", detail: "Off" },
    ]);
  });

  it("is calm when every plugin is on", () => {
    const drawer = pluginsDrawer([plugin("endue.eris", "Eris"), plugin("endue.dock", "Dock")]);
    expect(drawer).toMatchObject({ summary: "2 on", warning: false, rows: [] });
  });

  it("names a failed plugin without a manifest by its id", () => {
    const drawer = pluginsDrawer([
      { id: "example.gone", status: "failed", enabled: true, builtIn: false, revision: 1 },
    ]);
    expect(drawer.summary).toBe("0 on · 1 failed");
    expect(drawer.rows).toEqual([{ label: "example.gone", detail: "failed", warning: true }]);
  });
});

describe("the Access drawer", () => {
  it("groups what enabled plugins may ask for by permission, naming the plugins", () => {
    const drawer = accessDrawer([
      plugin("endue.eris", "Eris", [{ permission: "brain:converse" }]),
      plugin("endue.onboarding", "Welcome", [{ permission: "audio:capture", wakeWord: true }]),
      plugin("endue.sidebar", "Plugins", [{ permission: "plugin:manage" }]),
      plugin("endue.dock", "Dock", [{ permission: "plugin:manage" }]),
      plugin("example.notes", "Notes", [
        { permission: "ui:surface" },
        { permission: "ui:notify" },
        { permission: "net:fetch", hosts: ["api.example.com", "*.example.org"] },
        { permission: "proc:spawn", commands: ["git"], pty: true },
        { permission: "fs:write", paths: ["~/Notes/**"] },
        { permission: "fs:read", paths: ["~/Notes/**", "/srv/shared"] },
      ]),
      plugin("example.quiet", "Quiet", [{ permission: "audio:capture" }], { enabled: false }),
      plugin("example.broken", "Broken", [{ permission: "net:fetch", hosts: ["x.io"] }], {
        status: "failed",
      }),
    ]);
    expect(drawer).toMatchObject({ id: "access", title: "Access", summary: "9 permissions" });
    expect(drawer.warning).toBe(false);
    expect(drawer.rows).toEqual([
      { label: "Microphone", detail: "Welcome (wake word)" },
      { label: "Read files", detail: "Notes (~/Notes/**, /srv/shared)" },
      { label: "Write files", detail: "Notes (~/Notes/**)" },
      { label: "Run programs", detail: "Notes (git, in a terminal)" },
      { label: "Network", detail: "Notes (api.example.com, *.example.org)" },
      { label: "Talk to the brain", detail: "Eris" },
      { label: "Notifications", detail: "Notes" },
      { label: "Open surfaces", detail: "Notes" },
      { label: "Manage plugins", detail: "Plugins, Dock" },
    ]);
  });

  it("is empty when no enabled plugin asks for anything", () => {
    const drawer = accessDrawer([
      plugin("example.plain", "Plain"),
      plugin("example.quiet", "Quiet", [{ permission: "ui:notify" }], { enabled: false }),
    ]);
    expect(drawer).toMatchObject({ summary: "None", rows: [] });
  });
});

describe("the drawer list", () => {
  it("shows Plugins, then Access", () => {
    expect(drawers([plugin("endue.eris", "Eris")]).map((d) => d.id)).toEqual(["plugins", "access"]);
  });
});

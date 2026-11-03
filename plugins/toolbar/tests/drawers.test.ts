import { readFileSync } from "node:fs";
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
      { label: "Manage plugins", detail: "Plugins, Dock" },
      { label: "Run programs", detail: "Notes (git, in a terminal)" },
      { label: "Read files", detail: "Notes (~/Notes/**, /srv/shared)" },
      { label: "Write files", detail: "Notes (~/Notes/**)" },
      { label: "Network", detail: "Notes (api.example.com, *.example.org)" },
      { label: "Microphone", detail: "Welcome (wake word)" },
      { label: "Talk to the brain", detail: "Eris" },
      { label: "Notifications", detail: "Notes" },
      { label: "Open surfaces", detail: "Notes" },
    ]);
  });

  it("shows sensitive and unknown permissions, with scopes and a matching count", () => {
    const drawer = accessDrawer([
      plugin("example.manager", "Manager", [
        { permission: "perm:manage" },
        { permission: "shell:open", schemes: ["https"], paths: ["~/Documents/**"] },
        { permission: "x:y" },
      ]),
    ]);
    expect(drawer.summary).toBe("3 permissions");
    expect(drawer.rows).toHaveLength(3);
    expect(drawer.rows[0]).toEqual({ label: "Manage permissions", detail: "Manager" });
    expect(drawer.rows[1]?.label).toBe("Open links and show files");
    expect(drawer.rows[1]?.detail).toContain("https");
    expect(drawer.rows[1]?.detail).toContain("~/Documents/**");
    expect(drawer.rows[2]).toEqual({ label: "x:y", detail: "Manager" });
  });

  it("has a plain-words label for every permission in the schema", () => {
    const schema = JSON.parse(
      readFileSync(
        new URL("../../../specs/plugin/v0/permission.schema.json", import.meta.url),
        "utf8",
      ),
    );
    const ids: string[] = schema.$defs.Permission.oneOf.map(({ $ref }: { $ref: string }) => {
      const name = $ref.slice($ref.lastIndexOf("/") + 1);
      return schema.$defs[name].properties.permission.const;
    });
    expect(ids.length).toBeGreaterThan(0);
    for (const permission of ids) {
      const drawer = accessDrawer([
        plugin("example.all", "All", [
          {
            permission,
            paths: ["~/test"],
            commands: ["git"],
            hosts: ["example.com"],
            ids: ["example.*"],
            keys: ["example/*"],
            names: ["plugin.changed"],
            kinds: ["document"],
            sources: ["example.*"],
            schemes: ["https"],
          },
        ]),
      ]);
      expect(drawer.rows, permission).toHaveLength(1);
      expect(drawer.rows[0]?.label, permission).not.toBe(permission);
      expect(drawer.rows[0]?.label, permission).toBeTruthy();
    }
  });

  it("shows the scopes declared for other scoped permissions", () => {
    const drawer = accessDrawer([
      plugin("example.scoped", "Scoped", [
        { permission: "cmd:invoke", ids: ["example.*"] },
        { permission: "settings:read", keys: ["example/*"] },
        { permission: "events:subscribe", names: ["plugin.changed"] },
        { permission: "data:read", kinds: ["document"], sources: ["example.connector"] },
      ]),
    ]);
    expect(drawer.summary).toBe("4 permissions");
    const details = drawer.rows.map((row) => row.detail).join(" ");
    for (const scope of [
      "example.*",
      "example/*",
      "plugin.changed",
      "document",
      "example.connector",
    ]) {
      expect(details).toContain(scope);
    }
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

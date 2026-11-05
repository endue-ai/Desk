/**
 * desk.design (ADR 0090, docs/ko/design-system-requirements.md DH-05, DE): which design system is in
 * force, previews and drafts of others, and the commands people and agents change it with. The theme
 * engine (policies/theme.ts) lays the state's component tokens over the theme's and sends both to the
 * shell and every frame. Saving, sharing and markets go through the theme pipeline (ADR 0091).
 */
import type { DesignSystemPackage, ThemeMarketTheme } from "@endue-ai/bridge";
import { type DesignRecipe, mergeRecipe, trimRecipe } from "@endue-ai/ui/design";
import { type DesignState, DRAFT_DESIGN, type InstalledDesign, resolveDesign } from "../design";
import type { DeskContext } from "./context";
import { designCommands } from "./design-commands";

/** The design systems as the main UI and agents drive them. */
export interface RuntimeDesigns {
  /** The design system in force, or the one previewed. */
  state(): DesignState;
  /** The installed design systems, in layer order. */
  installed(): InstalledDesign[];
  /** The design system desk.design.active names; empty for the endue design system. */
  active(): string;
  /** Show a design system on the whole desk without choosing it; undefined ends it. */
  preview(id: string | undefined): void;
  previewing(): string | undefined;
  /** Choose a design system (`""` the endue one): desk.design.active, kept with the session. */
  apply(id: string): void;
  /** What the components would be made of with `id`. */
  resolve(id: string): DesignState;
  /** Preview a design system that is not installed (the editor, Describe, a market card). */
  previewDraft(design: DesignSystemPackage | undefined): void;
  /** Hear when the design system in force, the preview or the installed ones change. */
  onChange(listener: () => void): () => void;
  io(): DesignIo;
  market(): DesignMarket;
  /**
   * Change the components of the design system in force (DE-02): the person's own (`local.`) is
   * changed in place; any other is copied into a new `local.` one, which is chosen. Its id.
   */
  change(components: DesignRecipe, name?: string): Promise<string>;
}

/** theme.* for design systems: save, export, import and remove (theme:manage, ADR 0091). */
export interface DesignIo {
  save(entry: {
    id: string;
    name: string;
    description?: string;
    designSystem: DesignSystemPackage;
  }): Promise<void>;
  /** Write a `.desk-design` (to `path`, or to Downloads); the file's path. */
  exportDesign(id: string, path?: string): Promise<string>;
  importBundle(bundle: unknown): Promise<string>;
  importPath(path: string): Promise<string>;
  remove(id: string): Promise<void>;
}

/** The look markets' design systems (theme.market.*, entries of kind design-system). */
export interface DesignMarket {
  list(): Promise<{ designs: ThemeMarketTheme[]; problems: string[] }>;
  fetch(url: string, sha256: string): Promise<DesignSystemPackage>;
  install(entry: { url: string; sha256: string; market: string }): Promise<string>;
}

export interface DesignPolicy extends RuntimeDesigns {
  dispose(): void;
}

const USER = /^(local|market)\./;

/** What the session keeps of a setting the person chose: its session layer's value. */
interface Keeper {
  keep(
    name: string,
    part: {
      save(): unknown;
      restore(value: unknown): void;
      onChange(listener: () => void): () => void;
    },
  ): () => void;
}

/** The theme and the design system the person chose come back with the session. */
export function keepLooks(session: Keeper, settings: DeskContext["hub"]["settings"]): void {
  for (const [name, key] of [
    ["theme", "desk.theme.active"],
    ["design", "desk.design.active"],
  ] as const) {
    session.keep(name, {
      save: () => settings.layer("session")[key] ?? null,
      restore: (value) => {
        if (typeof value === "string") settings.set(key, value);
      },
      onChange: (listener) => settings.onChange((changed) => changed.includes(key) && listener()),
    });
  }
}

/** A `local.` id from a name that none of `taken` holds: `Square caps` is `local.square-caps`. */
export function localDesignId(name: string, taken: (id: string) => boolean): string {
  const slug = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("-")
    .slice(0, 48);
  const base = `local.${slug && /^[a-z]/.test(slug) ? slug : `design-${slug || "custom"}`}`;
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

export function installDesign(ctx: Pick<DeskContext, "hub" | "bridge">): DesignPolicy {
  const { hub } = ctx;
  const { settings } = hub;
  const listeners = new Set<() => void>();
  let previewed: string | undefined;
  let draft: InstalledDesign | undefined;
  const installed = (): InstalledDesign[] =>
    hub.policy.installedDesigns.map(({ revision: _, ...design }) => design);
  const withDraft = () => (draft ? [...installed(), draft] : installed());
  const known = (id: string) => id === "" || withDraft().some((d) => d.id === id);
  const active = () => settings.get("desk.design.active", "");
  const resolve = (id: string) => resolveDesign(withDraft(), id);
  let state = resolve(active());
  const notify = () => {
    if (previewed !== undefined && !known(previewed)) previewed = undefined;
    state = resolve(previewed ?? active());
    for (const listener of [...listeners]) listener();
  };
  const offs = [
    hub.onPolicy(notify),
    settings.onChange((keys) => keys.includes("desk.design.active") && notify()),
  ];
  const io = designIo(ctx);
  const apply = (id: string) => {
    previewed = undefined;
    // One just saved or imported is chosen before plugin.list has caught up with it.
    const next = known(id) || USER.test(id) ? id : "";
    if (next === active()) notify();
    else settings.set("desk.design.active", next);
  };

  const designs: RuntimeDesigns = {
    state: () => state,
    installed,
    active,
    preview(id) {
      const next = id !== undefined && known(id) ? id : undefined;
      if (next === previewed) return;
      previewed = next;
      notify();
    },
    previewing: () => previewed,
    apply,
    resolve,
    previewDraft(design) {
      draft = design ? { id: DRAFT_DESIGN, name: "Draft", designSystem: design } : undefined;
      previewed = design ? DRAFT_DESIGN : previewed === DRAFT_DESIGN ? undefined : previewed;
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    io: () => io,
    market: () => designMarket(ctx),
    async change(components, name) {
      const from = active();
      const current = installed().find((d) => d.id === from);
      const merged = mergeRecipe(resolve(from).recipe, components);
      const own = from.startsWith("local.") && current !== undefined;
      const title = name ?? (current ? `${current.name} (custom)` : "My design system");
      const id = own ? from : localDesignId(title, (taken) => known(taken));
      await io.save({
        id,
        name: own && current ? current.name : title,
        ...(current?.description ? { description: current.description } : {}),
        designSystem: {
          ...(own ? current?.designSystem : {}),
          ...(!own && from ? { origin: { base: from } } : {}),
          components: trimRecipe(merged),
        },
      });
      apply(id);
      return id;
    },
  };
  const offCommands = designCommands(hub.commands, designs);
  return {
    ...designs,
    dispose() {
      offCommands();
      for (const off of offs) off();
      listeners.clear();
    },
  };
}

const SCOPE = { permission: "theme:manage" } as const;

function designIo(ctx: Pick<DeskContext, "bridge">): DesignIo {
  return {
    async save(entry) {
      const manifest = {
        id: entry.id,
        name: entry.name,
        version: "1.0.0",
        kind: "design-system" as const,
        ...(entry.description ? { description: entry.description } : {}),
        designSystem: entry.designSystem,
      };
      await ctx.bridge.call("theme.save", { manifest, scope: SCOPE });
    },
    async exportDesign(id, path) {
      const result = await ctx.bridge.call("theme.export", {
        theme: id,
        ...(path ? { path } : {}),
        scope: SCOPE,
      });
      return result.path ?? id;
    },
    async importBundle(bundle) {
      return (await ctx.bridge.call("theme.import", { bundle: bundle as never, scope: SCOPE }))
        .plugin.id;
    },
    async importPath(path) {
      return (await ctx.bridge.call("theme.import", { path, scope: SCOPE })).plugin.id;
    },
    async remove(id) {
      await ctx.bridge.call("theme.remove", { theme: id, scope: SCOPE });
    },
  };
}

function designMarket(ctx: Pick<DeskContext, "bridge">): DesignMarket {
  return {
    async list() {
      const listed = await ctx.bridge.call("theme.market.list", { scope: SCOPE });
      return {
        designs: listed.themes.filter((entry) => entry.theme.kind === "design-system"),
        problems: listed.problems.map((problem) => `${problem.market}: ${problem.message}`),
      };
    },
    async fetch(url, sha256) {
      const { bundle } = await ctx.bridge.call("theme.market.fetch", { url, sha256, scope: SCOPE });
      const design = bundle.manifest.designSystem;
      if (bundle.manifest.kind !== "design-system" || !design)
        throw new Error(`${bundle.manifest.id} is not a design system`);
      return design;
    },
    install: async ({ url, sha256, market }) =>
      (await ctx.bridge.call("theme.import", { url, sha256, market, scope: SCOPE })).plugin.id,
  };
}

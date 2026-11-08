/**
 * desk.describe.open, the runtime's describe command (RT-06, ADR 0075): "Describe…" in the palette
 * and Mod+Shift+/ in the core's keys. Without arguments it offers a picker over commands, settings, plugins
 * and grants (desk.palette.pick) and waits for one chord at the same time: a chord pressed first is
 * described and the picker goes, a pick is described otherwise; Escape gives up on both. With
 * `{ kind, name }` it describes that thing and answers the description; `show: false` only answers,
 * which is how the CLI asks (`desk describe`). The desk provides it (`desk`), with no plugin on.
 */
import type { CallerGrant } from "@endue-ai/bridge";
import type { NoticeInput } from "../notify";
import { type DeskContext, disposer, type Installed } from "../policies/context";
import type { KeysPolicy } from "../policies/keys";
import { explain } from "./describe";
import { describeView } from "./view";
import { type DescribeKind, type Description, type Facts, KINDS } from "./words";

export interface DescribeDeps {
  keys: Pick<KeysPolicy, "contributed" | "personal">;
  /** The profile in force. */
  profile(): string | undefined;
  notify?(input: NoticeInput): void;
}

export interface DescribePolicy extends Installed {
  /** The answer the surface shows now. */
  shown(): Description | undefined;
}

const ID = "desk.describe.open";
const MANAGE = { permission: "perm:manage" } as const;

const isKind = (kind: unknown): kind is DescribeKind => KINDS.includes(kind as DescribeKind);

/** Whether `caller` may see every grant: the person (no caller) or a perm:manage holder. */
const mayList = (caller: string | undefined, grants: CallerGrant[]) =>
  caller === undefined ||
  grants.some((g) => g.caller === caller && g.grant.permission.permission === "perm:manage");

/** What the picker offers, each id `<kind>:<name>`. */
function choices(f: Facts) {
  const settings = new Set([
    ...Object.keys(f.declared),
    ...Object.values(f.layers).flatMap((values) => Object.keys(values)),
  ]);
  return [
    ...f.commands.map((c) => ({
      id: `command:${c.id}`,
      label: c.title,
      detail: `command · ${c.id}`,
    })),
    ...[...settings].sort().map((key) => ({ id: `setting:${key}`, label: key, detail: "setting" })),
    ...f.plugins.map((p) => ({
      id: `plugin:${p.id}`,
      label: p.manifest?.name ?? p.id,
      detail: `plugin · ${p.id}`,
    })),
    ...(f.grants ?? []).map((g) => ({
      id: `grant:${g.grant.grantId}`,
      label: `${g.caller}: ${g.grant.permission.permission}`,
      detail: `grant · ${g.grant.grantId}`,
    })),
  ];
}

export function installDescribe(ctx: DeskContext, deps: DescribeDeps): DescribePolicy {
  const { hub, bridge, shortcuts, root, win } = ctx;
  const { commands, settings } = hub;
  const offs = disposer();

  const copy = async (text: string) => {
    try {
      await win.navigator.clipboard.writeText(text);
      return true;
    } catch {
      // No clipboard API here (or it refused): copy a selection the old way.
      const doc = root.ownerDocument;
      const area = doc.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      doc.body.append(area);
      area.select();
      try {
        return doc.execCommand("copy");
      } catch {
        return false;
      } finally {
        area.remove();
      }
    }
  };
  const view = describeView(root, {
    reveal: async (file) => {
      const scope = { permission: "shell:open" as const, paths: [file] };
      await bridge.call("shell.open", { target: file, reveal: true, scope });
    },
    copy,
  });
  offs.add(() => view.close());

  /** What the desk knows now; grants only when `caller` may list them itself. */
  const gather = async (caller?: string): Promise<Facts> => {
    const [listed, init, grants] = await Promise.all([
      bridge.call("cmd.list", { scope: { permission: "cmd:invoke", ids: ["*"] } }).then(
        (r) => r.commands,
        () => [],
      ),
      bridge.call("init.get", {}).catch(() => undefined),
      bridge.call("perm.list", { scope: MANAGE }).then(
        (r) => r.grants,
        () => undefined,
      ),
    ]);
    const shown = grants && mayList(caller, grants) ? grants : undefined;
    return {
      platform: shortcuts.platform,
      commands: listed,
      keys: [
        ...deps.keys.contributed(),
        ...deps.keys.personal().map((b) => ({ ...b, owner: "person" })),
      ],
      plugins: [...hub.plugins],
      declared: hub.policy.settings,
      layers: {
        init: settings.layer("init"),
        profile: settings.layer("profile"),
        session: settings.layer("session"),
      },
      ...(deps.profile() ? { profile: deps.profile() } : {}),
      ...(init?.file ? { initFile: init.file } : {}),
      ...(shown ? { grants: shown } : { asker: caller ?? "the desk" }),
    };
  };

  const present = (kind: DescribeKind, name: string) =>
    gather()
      .then((facts) => view.show(explain(kind, name, facts)))
      .catch((error) => {
        const body = error instanceof Error ? error.message : String(error);
        deps.notify?.({ caller: "desk", title: "Nothing to describe", body, level: "warning" });
      });

  /** The picker and the chord, whichever answers first; the other is called off. */
  let waiting: (() => void) | undefined;
  const ask = () => {
    waiting?.();
    let done = false;
    const finish = () => {
      if (done) return false;
      done = true;
      stopKey();
      if (waiting === stop) waiting = undefined;
      return true;
    };
    const stop = () => void finish();
    waiting = stop;
    const stopKey = shortcuts.captureNext((combo) => {
      if (!finish()) return;
      if (commands.has("desk.palette.cancel"))
        void commands.run("desk.palette.cancel").catch(() => {});
      if (combo !== "Escape") void present("key", combo);
    });
    if (!commands.has("desk.palette.pick")) {
      deps.notify?.({ caller: "desk", title: "Press a key to describe it", level: "info" });
      return;
    }
    void gather()
      .then((facts) =>
        commands.run("desk.palette.pick", {
          title: "Describe: press a key, or pick one",
          placeholder: "Commands, settings, plugins and grants",
          items: choices(facts),
        }),
      )
      .then(
        (picked) => {
          if (!finish()) return;
          const [kind = "", ...rest] = String(picked).split(":");
          if (isKind(kind)) void present(kind, rest.join(":"));
        },
        () => void finish(),
      );
  };
  offs.add(() => waiting?.());

  offs.add(
    commands.define(ID, {
      title: "Describe…",
      keywords: ["describe", "help", "what is", "describe-key", "describe-variable", "explain"],
      owner: "desk",
      run: async (args, from) => {
        const { kind, name, show } = (args ?? {}) as {
          kind?: unknown;
          name?: unknown;
          show?: unknown;
        };
        if (kind === undefined && name === undefined) {
          // The picker waits for the person; the answer does not (the palette waits on it).
          ask();
          return;
        }
        if (!isKind(kind) || typeof name !== "string" || name === "")
          throw new Error(`Name a kind (${KINDS.join(", ")}) and what to describe`);
        const description = explain(kind, name, await gather(from.caller));
        if (show !== false) view.show(description);
        return description;
      },
    }),
  );

  return { shown: () => view.shown(), dispose: offs.dispose };
}

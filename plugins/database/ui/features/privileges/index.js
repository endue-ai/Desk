// Roles, memberships and privileges (PG-54): a panel per PostgreSQL connection with its roles
// (attributes, members, memberships; never a password), an object's matrix of grantees and
// privileges with grant options and grantors, a table's row security policies, what a role may do
// and why, and the default privileges per owner and schema. Every change shows its exact script
// first and runs it only on the person's answer (ADR 0312); a new password goes only as its
// SCRAM-SHA-256 verifier and is never kept, logged or written to the history (ADR 0330). Agents get
// the reads and every change as commands that fill the dialog. No DOM here.

import { createChanges } from "./changes.js";
import { createPrivileges, TYPE } from "./controller.js";
import { privilegesDialog } from "./dialog.js";
import { DIALOG } from "./models.js";
import { privilegesPanel } from "./panel.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("./controller.js").PrivState} PrivState
 */

/** One controller per plugin, shared by the feature's commands and actions. */
const made = new WeakMap();
const of = (/** @type {Deps} */ deps) => {
  let both = made.get(deps);
  if (!both) {
    const ctl = createPrivileges(deps);
    both = { ctl, changes: createChanges(deps, ctl) };
    made.set(deps, both);
  }
  return /** @type {{ ctl: ReturnType<typeof createPrivileges>, changes: ReturnType<typeof createChanges> }} */ (
    both
  );
};

/** What an object's read answers an agent. */
const objectAnswer = (/** @type {PrivState} */ s) => ({
  object: s.target,
  error: s.object?.error || undefined,
  owner: s.object?.acl?.owner,
  defaults: s.object?.acl?.defaults,
  grants: s.object?.acl?.entries ?? [],
  rowSecurity: s.object?.security ?? undefined,
});

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "privileges",
  commands: (deps) => {
    const { ctl, changes } = of(deps);
    const conn = (/** @type {Record<string, unknown>} */ args) => ctl.choose(args.connection);
    return {
      "endue.database.privileges": async (args) =>
        ctl.rolesAnswer((await ctl.show(await conn(args), { tab: "roles" })).state),
      "endue.database.object-privileges": async (args) => {
        const c = await conn(args);
        return objectAnswer((await ctl.showObject(c, await ctl.targetOf(c, args))).state);
      },
      "endue.database.role-privileges": async (args) => {
        const c = await conn(args);
        const role =
          typeof args.role === "string"
            ? args.role
            : await deps.pick(
                "Database: what may which role do?",
                ((await ctl.show(c, {})).state.roles?.roles ?? []).map((r) => ({
                  id: r.name,
                  label: r.name,
                })),
              );
        if (!role) throw deps.cancelled("Nothing picked.");
        const { state } = await ctl.showRole(c, role);
        if (state.view?.error) throw new Error(state.view.error);
        return state.view?.view;
      },
      "endue.database.default-privileges": async (args) => {
        const { state } = await ctl.show(await conn(args), { tab: "defaults" });
        return {
          error: state.defaults?.error || undefined,
          defaults: state.defaults?.entries ?? [],
        };
      },
      "endue.database.change-privileges": async (args) => {
        const c = await conn(args);
        const { id } = await ctl.showObject(c, await ctl.targetOf(c, args));
        const grantee = typeof args.grantee === "string" ? args.grantee : "";
        if (!grantee) throw new Error("Name the grantee: a role or PUBLIC.");
        const column = typeof args.column === "string" ? args.column : "";
        ctl.addGrantee(id, grantee, column);
        ctl.plan(id, grantee, column, args);
        return changes.reviewObject(id, args);
      },
      "endue.database.change-default-privileges": async (args) =>
        changes.newDefault(await conn(args), args),
      "endue.database.create-role": async (args) => changes.role(await conn(args), undefined, args),
      "endue.database.alter-role": async (args) => {
        if (typeof args.role !== "string") throw new Error("Name the role to change.");
        return changes.role(await conn(args), args.role, args);
      },
      "endue.database.change-membership": async (args) =>
        changes.membership(await conn(args), args),
      "endue.database.policy": async (args) => changes.policy(await conn(args), args),
      "endue.database.drop-policy": async (args) => changes.dropPolicy(await conn(args), args),
      "endue.database.row-security": async (args) => changes.rowSecurity(await conn(args), args),
    };
  },
  actions: (deps) => {
    const { ctl, changes } = of(deps);
    const tableArgs = (/** @type {string} */ id) => {
      const t = ctl.stateOf(id)?.target;
      return { schema: t?.schema, table: t?.name };
    };
    return {
      privileges: (/** @type {import("../../explorer.js").Node} */ node) => ctl.fromNode(node),
      privilegesTab: (/** @type {string} */ id, /** @type {any} */ tab) => ctl.tab(id, tab),
      privilegesRefresh: (/** @type {string} */ id) => ctl.read(id),
      privilegesPress: (/** @type {string} */ id, /** @type {any} */ cell) => ctl.press(id, cell),
      privilegesAdd: (
        /** @type {string} */ id,
        /** @type {string} */ who,
        /** @type {string} */ column,
      ) => ctl.addGrantee(id, who, column),
      privilegesDiscard: (/** @type {string} */ id, /** @type {any} */ which) =>
        ctl.discard(id, which),
      privilegesReview: (/** @type {string} */ id) => changes.reviewObject(id),
      privilegesReviewDefaults: (/** @type {string} */ id) => changes.reviewDefaults(id),
      privilegesShowRole: (/** @type {string} */ id, /** @type {string} */ role) =>
        ctl.showRole(ctl.connOf(id), role),
      privilegesPick: async (/** @type {string} */ id) => {
        const c = ctl.connOf(id);
        return ctl.showObject(c, await ctl.targetOf(c, {}));
      },
      privilegesDatabase: (/** @type {string} */ id) => {
        const c = ctl.connOf(id);
        return ctl.showObject(c, { kind: "database", schema: "", name: c.database ?? "" });
      },
      privilegesRole: (/** @type {string} */ id, /** @type {string | undefined} */ role) =>
        changes.role(ctl.connOf(id), role, {}),
      privilegesMembership: (
        /** @type {string} */ id,
        /** @type {Record<string, unknown>} */ given,
      ) => changes.membership(ctl.connOf(id), given ?? {}),
      privilegesPolicy: (/** @type {string} */ id, /** @type {string | undefined} */ name) =>
        changes.policy(ctl.connOf(id), { ...tableArgs(id), name }),
      privilegesDropPolicy: (/** @type {string} */ id, /** @type {string} */ name) =>
        changes.dropPolicy(ctl.connOf(id), { ...tableArgs(id), name }),
      privilegesRowSecurity: (/** @type {string} */ id) =>
        changes.rowSecurity(ctl.connOf(id), tableArgs(id)),
      privilegesNewDefault: (/** @type {string} */ id) => changes.newDefault(ctl.connOf(id), {}),
    };
  },
  panels: { [TYPE]: { label: "Roles and privileges", render: privilegesPanel } },
  dialogs: { [DIALOG]: { label: "Change privileges", render: privilegesDialog } },
  styles: [new URL("./privileges.css", import.meta.url).href],
};

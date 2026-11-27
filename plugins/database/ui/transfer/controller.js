// Database: copy tables and Database: copy the query's result into a table (PG-63). The form asks
// where to (another connection, database or schema, a name) and what (structure, data or both,
// foreign keys); both sides are read and compared, and the copy's panel shows the report and the
// target's script before anything runs. Start runs it (production asks first, naming the target),
// the panel follows each table's bytes and rows, and Cancel rolls the target back. One copy per
// panel at a time. No DOM.

import { formatCount, formatDuration } from "../format.js";
import { t } from "../strings/index.js";
import { createChooser, targetOf } from "./choose.js";
import { keyOf } from "./ddl.js";
import { planQuery, planTables, scriptOf } from "./plan.js";
import { describeQuery, readTable, readTarget, readVersion } from "./read.js";
import { runTransfer } from "./run.js";
import { stateOf } from "./state.js";

/**
 * @typedef {import("../feature-host.js").Deps} Deps
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("./plan.js").Plan} Plan
 * @typedef {import("./state.js").TransferState} TransferState
 * @typedef {{
 *   source: Connection, target: Connection, plan: Plan, state: TransferState,
 *   remake?(mapping: Record<string, string>): Plan, mapping?: Record<string, string>,
 *   control?: AbortController,
 * }} Job
 */

export const TYPE = "transfer";
const textOf = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** @param {Deps} deps */
export function createTransfers(deps) {
  const choose = createChooser(deps);
  /** @type {Map<string, Job>} by panel id */
  const jobs = new Map();
  const draw = (/** @type {string} */ id, /** @type {Partial<TransferState>} */ change) => {
    const job = jobs.get(id);
    if (!job) return;
    job.state = { ...job.state, ...change };
    deps.consoles.updatePanel(id, job.state);
  };
  const connections = () =>
    deps.manager
      .list()
      .filter((c) => c.engine === "postgresql")
      .map((c) => ({ id: c.id, name: c.name, database: c.database, readOnly: c.readOnly }));

  /** Open the panel checking, read with `prepare`, and show the plan or why it failed. */
  const open = async (
    /** @type {Connection} */ source,
    /** @type {Connection} */ target,
    /** @type {Omit<TransferState, "status" | "problems" | "notes" | "script" | "steps" | "mapping" | "result">} */ head,
    /** @type {() => Promise<Pick<Job, "plan" | "remake" | "mapping"> & { choices?: string[] }>} */ prepare,
  ) => {
    const state = stateOf(head);
    const name = `copy: ${head.title}`;
    const busy = deps.consoles
      .list()
      .some((b) => b.kind === TYPE && b.name === name && jobs.get(b.id)?.control);
    if (busy) throw new Error(t("transfer.controller.thisCopyIsRunningCancelIt"));
    const panel = await deps.consoles.openPanel(source, TYPE, name, state);
    jobs.set(panel.id, { source, target, plan: /** @type {any} */ (null), state });
    deps.consoles.updatePanel(panel.id, state);
    try {
      const ready = await prepare();
      const job = /** @type {Job} */ (jobs.get(panel.id));
      Object.assign(job, ready);
      draw(panel.id, planned(ready.plan, ready.mapping, ready.choices));
    } catch (error) {
      draw(panel.id, { status: "failed", result: textOf(error) });
    }
    return { panel: panel.id };
  };

  /** Database: copy tables. */
  const tables = async (/** @type {Record<string, unknown>} */ args) => {
    const source = await choose.source(args.connection);
    if (!source) return undefined;
    const names = await choose.tables(source, args);
    if (!names) return undefined;
    const one = names.length === 1 ? names[0] : undefined;
    const answer = /** @type {Record<string, unknown> | undefined} */ (
      await deps.dialog(TYPE, {
        kind: "tables",
        source: source.name,
        what: one ? `${one.schema}.${one.name}` : `${names.length} tables of ${names[0]?.schema}`,
        connections: connections(),
        target:
          String(args.to ?? "") || (connections().find((c) => c.id !== source.id) ?? source).id,
        database: String(args.database ?? ""),
        schema: String(args.toSchema ?? names[0]?.schema ?? "public"),
        name: one ? String(args.name ?? one.name) : "",
        content: String(args.content ?? "both"),
        foreignKeys: args.foreignKeys !== false,
      })
    );
    if (!answer) throw deps.cancelled(t("transfer.controller.notCopied"));
    const target = targetOf(deps, answer);
    const schema = String(answer.schema ?? "").trim() || "public";
    const content = /** @type {import("./compare.js").Content} */ (
      String(answer.content ?? "both")
    );
    const choice = {
      schema,
      name: String(answer.name ?? "").trim(),
      content,
      foreignKeys: answer.foreignKeys !== false,
    };
    const into = one ? `${schema}.${choice.name || one.name}` : schema;
    return open(
      source,
      target,
      {
        title: t("transfer.controller.to", {
          value: String(
            one
              ? `${one.schema}.${one.name}`
              : t("transfer.controller.tables", { length: String(names.length) }),
          ),
          name: String(target.name),
        }),
        from: `${source.name} · ${source.database}`,
        to: `${target.name} · ${target.database} · ${into}`,
      },
      async () => {
        const defs = [];
        for (const name of names) defs.push(await readTable(deps.execute, source, name));
        const types = [...new Set(defs.flatMap((d) => d.columns.map((r) => r[1] ?? "")))];
        const targets = defs.map((d) => ({
          schema,
          name: one && choice.name ? choice.name : d.name,
        }));
        const facts = await readTarget(deps.execute, target, {
          types,
          schemas: [schema],
          tables: targets,
        });
        return {
          plan: planTables(defs, choice, {
            source: await readVersion(deps.execute, source),
            target: facts,
          }),
        };
      },
    );
  };

  /** Database: copy the query's result into a table. */
  const query = async (/** @type {Record<string, unknown>} */ args) => {
    const { conn: source, sql } = choose.statement();
    const answer = /** @type {Record<string, unknown> | undefined} */ (
      await deps.dialog(TYPE, {
        kind: "query",
        source: source.name,
        what: sql.trim().split("\n")[0] ?? "",
        connections: connections(),
        target: String(args.to ?? source.id),
        database: String(args.database ?? ""),
        schema: String(args.toSchema ?? "public"),
        name: String(args.name ?? "query_result"),
        append: args.append === true,
      })
    );
    if (!answer) throw deps.cancelled(t("transfer.controller.notCopied"));
    const target = targetOf(deps, answer);
    const schema = String(answer.schema ?? "").trim() || "public";
    const name = String(answer.name ?? "").trim();
    if (!name) throw new Error(t("transfer.controller.nameTheTableTheResultGoes"));
    const append = answer.append === true;
    return open(
      source,
      target,
      {
        title: t("transfer.controller.queryTo", { name: String(target.name) }),
        from: `${source.name} · the query`,
        to: `${target.name} · ${target.database} · ${schema}.${name}${append ? " (append)" : ""}`,
      },
      async () => {
        const described = await describeQuery(deps.execute, source, sql);
        const facts = await readTarget(deps.execute, target, {
          types: described.map((c) => c.type),
          schemas: [schema],
          tables: [{ schema, name }],
        });
        const version = await readVersion(deps.execute, source);
        const remake = (/** @type {Record<string, string>} */ mapping) =>
          planQuery(
            sql,
            described,
            { schema, name, append, mapping },
            { source: version, target: facts },
          );
        const choices = (facts.tables.get(keyOf(schema, name)) ?? [])
          .filter((c) => !c.generated)
          .map((c) => c.name);
        const mapping = append
          ? Object.fromEntries(
              described.map((c) => [c.name, choices.includes(c.name) ? c.name : ""]),
            )
          : undefined;
        return { plan: remake(mapping ?? {}), remake, ...(mapping ? { mapping, choices } : {}) };
      },
    );
  };

  /** What the panel shows of a plan. */
  const planned = (
    /** @type {Plan} */ plan,
    /** @type {Record<string, string> | undefined} */ mapping,
    /** @type {string[] | undefined} */ choices,
  ) => ({
    status: /** @type {const} */ (plan.report.problems.length ? "held" : "ready"),
    problems: plan.report.problems,
    notes: plan.report.notes,
    script: scriptOf(plan),
    steps: plan.steps.map((s) => ({
      source: s.source,
      target: s.target,
      bytes: 0,
      rows: null,
      state: /** @type {const} */ ("waiting"),
    })),
    mapping: mapping
      ? Object.entries(mapping).map(([source, target]) => ({
          source,
          target,
          choices: choices ?? [],
        }))
      : null,
  });

  /** A result column of an append goes into another target column ("" leaves it out). */
  const map = (
    /** @type {string} */ id,
    /** @type {string} */ column,
    /** @type {string} */ into,
  ) => {
    const job = jobs.get(id);
    if (!job?.remake || !job.mapping || job.control) return;
    job.mapping = { ...job.mapping, [column]: into };
    job.plan = job.remake(job.mapping);
    draw(id, planned(job.plan, job.mapping, job.state.mapping?.[0]?.choices));
  };

  /** Start the copy on screen, else the panel named. */
  const start = async (/** @type {unknown} */ ref) => {
    const id = typeof ref === "string" ? ref : deps.consoles.current()?.id;
    const job = id ? jobs.get(id) : undefined;
    if (!id || !job) throw new Error(t("transfer.controller.showTheCopyToStartFirst"));
    if (job.control) throw new Error(t("transfer.controller.thisCopyIsRunning"));
    if (job.state.status !== "ready")
      throw new Error(job.state.problems[0] ?? t("transfer.controller.readTheCopyAgainFirst"));
    const { target, plan } = job;
    if (target.tag === "production" && deps.settings().confirm) {
      const into = plan.steps.map((s) => s.target);
      const yes = await deps.confirm(
        t("transfer.controller.copyInto", { name: String(target.name) }),
        [t("transfer.controller.isTaggedProduction", { name: String(target.name) }), ...into],
      );
      if (!yes) throw deps.cancelled(t("transfer.controller.notCopied"));
    }
    const control = new AbortController();
    job.control = control;
    const began = Date.now();
    const steps = job.state.steps.map((s) => ({ ...s }));
    draw(id, { status: "running", result: "", steps });
    const change = (
      /** @type {number} */ i,
      /** @type {Partial<TransferState["steps"][number]>} */ part,
    ) => {
      steps[i] = { .../** @type {TransferState["steps"][number]} */ (steps[i]), ...part };
      draw(id, { steps: [...steps] });
    };
    try {
      const rows = await runTransfer(
        { execute: deps.execute, forget: (owner) => deps.consoles.sessions?.forget(owner) },
        {
          source: job.source,
          target,
          plan,
          id,
          signal: control.signal,
          step: (i) => {
            if (i > 0) change(i - 1, { state: "done" });
            change(i, { state: "copying" });
          },
          progress: (i, bytes) => change(i, { bytes }),
        },
      );
      rows.forEach((n, i) => {
        steps[i] = {
          .../** @type {TransferState["steps"][number]} */ (steps[i]),
          rows: n,
          state: "done",
        };
      });
      const total = rows.reduce((a, b) => a + b, 0);
      const said = t("transfer.controller.copiedRowsIntoIn", {
        value: String(formatCount(total)),
        name: String(target.name),
        value2: String(formatDuration(Date.now() - began)),
      });
      draw(id, { status: "done", steps: [...steps], result: said });
      deps.say(said);
      return { copied: total };
    } catch (error) {
      const cancelled = control.signal.aborted;
      const result = cancelled
        ? t("transfer.controller.cancelledNothingWasCopied")
        : t("transfer.controller.notCopiedNothingWasChangedOn", {
            value: String(textOf(error)),
            name: String(target.name),
          });
      draw(id, { status: cancelled ? "cancelled" : "failed", result });
      throw cancelled ? deps.cancelled(result) : new Error(result);
    } finally {
      job.control = undefined;
    }
  };

  /** Cancel the copy on screen, else the only one running. */
  const cancel = (/** @type {unknown} */ ref) => {
    const running = [...jobs].filter(([, j]) => j.control);
    const shown = deps.consoles.current()?.id;
    const id =
      typeof ref === "string"
        ? ref
        : (running.find(([k]) => k === shown)?.[0] ??
          (running.length === 1 ? running[0]?.[0] : undefined));
    const job = id ? jobs.get(id) : undefined;
    if (!job?.control)
      throw new Error(
        running.length
          ? t("transfer.controller.showTheCopyToCancelFirst")
          : t("transfer.controller.noCopyIsRunning"),
      );
    job.control.abort();
    deps.say(t("transfer.controller.cancellingTheCopy"));
    return { cancelled: id };
  };

  return { tables, query, start, cancel, map };
}

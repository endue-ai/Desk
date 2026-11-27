// Two schemas compared and the migration between them written (PG-53, ADR 0338): any two of a schema
// of a connection, a schema of another connection (or database), a folder of DDL files and a saved
// snapshot; the objects on one side only and the ones that differ, with their DDL side by side; the
// script for the direction and objects the person chooses, ordered by what each needs, destructive
// steps marked, run only on Run through the plugin's guards. A schema is also dumped to a folder,
// one file per object, or saved as a snapshot. controller.js keeps the panel, read.js / folder.js /
// snapshot.js read the sides, diff.js compares, migrate.js writes the script, run.js runs it.

import { t } from "../../strings/index.js";
import { createSchemaCompare, summaryOf, TYPE } from "./controller.js";
import { dumpOf } from "./dump.js";
import { pickFolder, saveSnapshot, writeFolder } from "./files.js";
import { schemaComparePanel } from "./panel.js";
import { readSchema } from "./read.js";
import { schemaSide, sideOf } from "./sides.js";
import { snapshotText } from "./snapshot.js";

/** @typedef {import("../../feature-host.js").Deps} Deps */

const controllers = new WeakMap();
const of = (/** @type {Deps} */ deps) => {
  let made = controllers.get(deps);
  if (!made) {
    made = createSchemaCompare(deps);
    controllers.set(deps, made);
  }
  return /** @type {ReturnType<typeof createSchemaCompare>} */ (made);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "compareSchema",
  commands: (deps) => {
    const c = of(deps);
    return {
      "endue.database.compare-schemas": async (args) => {
        const left = await sideOf(deps, args.left, "left");
        const right = await sideOf(deps, args.right, "right");
        return c.open(left, right);
      },
      "endue.database.dump-schema": async (args) => {
        const { conn, schema } = await schemaSide(deps, args);
        const folder =
          typeof args.folder === "string"
            ? args.folder
            : await pickFolder(
                deps,
                t("features.compareSchema.index.dumpIntoWhichFolder", { schema: String(schema) }),
              );
        const { model } = await readSchema(deps, conn, schema);
        const files = dumpOf(model);
        const done = await writeFolder(deps, folder, files);
        const gone = done.trashed.length ? `; ${done.trashed.length} stale moved to the trash` : "";
        deps.say(
          t("features.compareSchema.index.dumpedOfFilesIn", {
            schema: String(schema),
            name: String(conn.name),
            length: String(files.length),
            folder: String(folder),
            gone: String(gone),
          }),
        );
        return { folder, files: files.map((f) => f.path), trashed: done.trashed };
      },
      "endue.database.save-schema-snapshot": async (args) => {
        const { conn, schema } = await schemaSide(deps, args);
        const { model } = await readSchema(deps, conn, schema);
        const path = await saveSnapshot(
          deps,
          schema,
          snapshotText(model, { from: conn.name, at: new Date() }),
        );
        deps.say(
          t("features.compareSchema.index.savedOfObjectsTo", {
            schema: String(schema),
            name: String(conn.name),
            length: String(model.objects.length),
            path: String(path),
          }),
        );
        return { path, objects: model.objects.length };
      },
      "endue.database.schema-compare-refresh": async () => {
        const id = c.shown();
        await c.compare(id);
        return summaryOf(/** @type {any} */ (c.stateOf(id)));
      },
      "endue.database.schema-compare-cancel": () => c.cancel(c.shown()),
      "endue.database.schema-compare-run": () => c.run(c.shown()),
      "endue.database.schema-compare-dry-run": () => c.run(c.shown(), true),
      "endue.database.schema-compare-console": () => c.toConsole(c.shown()),
    };
  },
  actions: (deps) => {
    const c = of(deps);
    return {
      schemaCompareRefresh: (/** @type {string} */ id) => c.compare(id),
      schemaCompareCancel: (/** @type {string} */ id) => c.cancel(id),
      schemaCompareChoose: (
        /** @type {string} */ id,
        /** @type {string[]} */ keys,
        /** @type {boolean} */ on,
      ) => c.choose(id, keys, on),
      schemaCompareSelect: (/** @type {string} */ id, /** @type {string} */ key) =>
        c.select(id, key),
      schemaCompareDirection: (/** @type {string} */ id) => c.direction(id),
      schemaCompareRun: (/** @type {string} */ id) => c.run(id),
      schemaCompareDryRun: (/** @type {string} */ id) => c.run(id, true),
      schemaCompareConsole: (/** @type {string} */ id) => c.toConsole(id),
    };
  },
  panels: {
    [TYPE]: {
      label: t("features.compareSchema.index.schemaComparison"),
      render: schemaComparePanel,
      keep: (/** @type {any} */ s) => ({
        ...s,
        status: "cancelled",
        error: t("features.compareSchema.index.compareAgainToSeeTheDifference"),
        items: [],
        script: null,
        run: null,
        notes: [],
        progress: { done: 0, total: 1, what: "" },
      }),
    },
  },
  styles: [new URL("./compare-schema.css", import.meta.url).href],
};

// Extraction: the selection or everything, to a folder the person picks in the palette, after one
// question, perm.request for fs:write on it (#162 finding 15). Names that would land outside are
// refused and listed; where Archives may read the folder an existing file asks once for the run
// (overwrite, skip or stop), where it may not one is replaced and named (existing.js); "Allow once"
// lets one file through. The progress element counts files and bytes, and stop() (its Cancel, or
// Escape) ends the run between files and stops the entry being read.
import { formatSize, toBase64 } from "./bytes.js";
import { createExisting } from "./existing.js";
import { codeOf, scopeUnder } from "./files.js";
import { safeTarget } from "./safety.js";

/**
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {import("./formats/archive.js").Entry} Entry
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {ReturnType<typeof import("./files.js").createFiles>} Files
 * @typedef {ReturnType<typeof import("./jobs.js").createJobs>} Jobs
 */

/** The most one entry may hold to be read whole into memory (an archive opened one level down). */
export const MEMORY_LIMIT = 512 * 1024 * 1024;
/**
 * The most one extracted file may hold: fs.write carries it whole, as base64, and in the desk's
 * webview a write of 64 MiB takes seconds while one of 128 MiB never reaches the core.
 */
export const EXTRACT_LIMIT = 64 * 1024 * 1024;

const STOP = Symbol("stop");
const aborted = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "AbortError";
const plural = (/** @type {number} */ n, /** @type {string} */ word) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** "x.tar.gz" -> "x": the folder name an archive extracts to. @param {string} name */
export function stem(name) {
  const m = /^(.+?)(\.tar)?\.[^.]+$/i.exec(name);
  return m?.[1] ?? `${name} contents`;
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {Files} files
 * @param {{ say(text: string): void, changed(): void, jobs: Jobs }} out
 */
export function createExtractor({ bridge, commands }, files, out) {
  let stopping = false;
  let running = false;

  /** One answer from the palette; undefined when cancelled. @param {object} args */
  const pick = (args) =>
    commands.run("desk.palette.pick", args).then(
      (answer) => (typeof answer === "string" && answer.trim() ? answer.trim() : undefined),
      () => undefined,
    );

  /**
   * @param {Archive} archive
   * @param {Entry[]} chosen files and links, in the archive's order
   * @param {{ name: string, beside: string }} what the archive's name and the file's folder
   */
  const extract = async (archive, chosen, what) => {
    if (running) return out.say("An extraction is already running.");
    if (archive.refusal) return out.say(archive.refusal);
    if (chosen.length === 0) return out.say("Nothing to extract.");
    const fallback = `${what.beside}/${stem(what.name)}`;
    const answer = await pick({
      title: `Extract ${what.name} to`,
      items: [{ id: fallback, label: fallback, detail: "A new folder beside the archive" }],
      free: true,
      placeholder: fallback,
    });
    if (!answer) return out.say("Nothing was extracted.");
    const target = answer.replace(/\/+$/, "");
    const write = scopeUnder("fs:write", target);
    const allowed = await files.request(write, `To extract ${what.name} to ${target}`);
    if (!allowed.granted) return out.say(`Not allowed to write ${target}.`);

    /** @type {Array<{ entry: Entry, path: string }>} */
    const plan = [];
    /** @type {string[]} */
    const refused = [];
    /** @type {string[]} */
    const locked = [];
    /** @type {string[]} */
    const links = [];
    /** @type {string[]} */
    const unread = [];
    /** @type {string[]} */
    const large = [];
    for (const entry of chosen) {
      const safe = safeTarget(
        target,
        entry.path,
        entry.kind === "link" ? (entry.link ?? "") : undefined,
      );
      if ("refused" in safe) refused.push(entry.path);
      else if (entry.encrypted) locked.push(entry.path);
      else if (entry.kind === "link") links.push(entry.path);
      else if (entry.refusal) unread.push(entry.path);
      else if (entry.size > EXTRACT_LIMIT) large.push(entry.path);
      else plan.push({ entry, path: safe.path });
    }
    // A once grant is spent by the first call it allows: it writes one file, and is given back when
    // it would write none or could not write them all.
    if (allowed.once && plan.length !== 1) await files.giveBack(allowed.grantId);
    if (allowed.once && plan.length > 1) {
      return out.say(
        `Nothing was extracted: "Allow once" lets Archives write one file, and ${what.name} has ${plan.length} to write. Extract again and allow it for this session.`,
      );
    }
    const total = plan.reduce((n, p) => n + Math.max(0, p.entry.size), 0);
    let done = 0;
    let bytes = 0;
    let skipped = 0;
    /** Files a write replaced where Archives could not see them first. @type {string[]} */
    const replaced = [];
    /** @type {"overwrite" | "skip" | undefined} */
    let existing;
    const there = createExisting(bridge, target);
    const counts = () =>
      `${done} of ${plural(plan.length, "file")}, ${formatSize(bytes)} of ${formatSize(total)}`;
    /** @type {import("./jobs.js").Running["report"]} */
    let report = () => {};
    const tell = () =>
      total > 0 ? report(bytes, total, counts()) : report(done, plan.length, counts());

    /** @param {{ entry: Entry, path: string }} item @param {Uint8Array} data */
    const put = async (item, data) => {
      if (stopping) throw STOP;
      if (await there.has(item.path)) {
        if (!existing) {
          const choice = await pick({
            title: `${item.path.slice(target.length + 1)} already exists in ${target}`,
            items: [
              {
                id: "overwrite",
                label: "Overwrite existing files",
                detail: "For the rest of this extraction",
              },
              { id: "skip", label: "Skip existing files", detail: "Keep what is there" },
              { id: "stop", label: "Stop", detail: "Extract nothing more" },
            ],
          });
          if (choice !== "overwrite" && choice !== "skip") throw STOP;
          existing = choice;
        }
        if (existing === "skip") {
          skipped++;
          return;
        }
      }
      try {
        const { version } = await bridge.call("fs.write", {
          path: item.path,
          content: toBase64(data),
          encoding: "base64",
          createDirs: true,
          scope: write,
        });
        if (version && there.blind) replaced.push(item.path.slice(target.length + 1));
      } catch (error) {
        if (codeOf(error) === "permission_denied")
          throw new Error(`Not allowed to write ${target}.`);
        throw new Error(`Could not write ${item.path}: ${codeOf(error)}.`);
      }
      done++;
      bytes += data.length;
      tell();
      if (stopping) throw STOP;
    };

    running = true;
    stopping = false;
    out.changed();
    out.say(`Extracting ${plural(plan.length, "file")} to ${target}.`);
    /** @type {string} */
    let ending;
    try {
      await out.jobs.run(
        `Extracting ${what.name}`,
        counts(),
        async (job) => {
          report = job.report;
          tell();
          const read = { signal: job.signal };
          const byEntry = new Map(plan.map((p) => [p.entry, p]));
          if (archive.each)
            await archive.each(
              plan.map((p) => p.entry),
              (entry, data) => put(/** @type {any} */ (byEntry.get(entry)), data),
              read,
            );
          else
            for (const item of plan) {
              if (stopping) throw STOP;
              await put(item, await archive.read(item.entry, undefined, read));
            }
        },
        { cancel: () => stop() },
      );
      ending = `Extracted ${plural(done, "file")} (${formatSize(bytes)}) to ${target}.`;
    } catch (error) {
      ending =
        error === STOP || (stopping && aborted(error))
          ? `Stopped after ${done} of ${plural(plan.length, "file")}.`
          : `${error instanceof Error ? error.message : String(error)} Stopped after ${done} of ${plural(plan.length, "file")}.`;
    } finally {
      running = false;
      stopping = false;
      out.changed();
    }
    if (skipped) ending += ` Skipped ${skipped} that already existed.`;
    if (replaced.length) {
      const one = replaced.length === 1;
      const named = replaced.slice(0, 10).join(", ");
      const more = replaced.length > 10 ? ` and ${replaced.length - 10} more` : "";
      ending += ` Replaced ${plural(replaced.length, "file")} that ${one ? "was" : "were"} already there: ${named}${more}; the desk keeps what ${one ? "it" : "they"} held in ${one ? "its" : "their"} history.`;
    }
    if (refused.length)
      ending += ` Refused ${refused.length} outside the folder: ${refused.join(", ")}.`;
    if (locked.length) ending += ` Encrypted, not extracted: ${locked.join(", ")}.`;
    if (links.length) ending += ` Links are not created: ${links.join(", ")}.`;
    if (unread.length) ending += ` Not readable here: ${unread.join(", ")}.`;
    if (large.length)
      ending += ` Larger than ${formatSize(EXTRACT_LIMIT)}, which the desk cannot write in one piece yet: ${large.join(", ")}.`;
    out.say(ending);
  };

  const stop = () => {
    if (running) stopping = true;
  };

  return {
    extract,
    stop,
    get running() {
      return running;
    },
  };
}

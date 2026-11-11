// What went wrong reading a view's source, in a sentence a person reads: where the source is and
// what happened, never the bridge's "method: code: " text or the system's own error words.

/**
 * @typedef {import("../../../packages/bridge/src/index").UniversalSource} UniversalSource
 * @typedef {{ code?: string, name?: string, message?: string }} Failure
 */

/** @param {string} url */
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * The source as a person names it, and how its failures are said.
 * @param {UniversalSource | undefined} source
 */
function placeOf(source) {
  if (source && "file" in source)
    return {
      where: source.file,
      missing: `There is no file at ${source.file}.`,
      failed: `${source.file} could not be read.`,
    };
  if (source && "url" in source) {
    const host = hostOf(source.url);
    return {
      where: host,
      missing: `${host} has nothing at that address.`,
      failed: `${host} could not be reached.`,
    };
  }
  if (source && "command" in source)
    return {
      where: "The plugin behind this view",
      missing: "No plugin answers for this view any more.",
      failed: "The plugin behind this view did not answer.",
    };
  const where = source && "items" in source ? "Your items" : "This view's data";
  return { where, missing: `${where} could not be found.`, failed: `${where} could not be read.` };
}

/**
 * Why a source could not be read, for the person.
 * @param {unknown} error what the load threw
 * @param {UniversalSource | undefined} source
 */
export function failureText(error, source) {
  const failure = /** @type {Failure} */ (error ?? {});
  const { where, missing, failed } = placeOf(source);
  switch (failure.code) {
    case "permission_denied":
      return "Desk needs your permission to read this source.";
    case "not_found":
      return missing;
    case "timeout":
      return `${where} took too long to answer.`;
    case "offline":
      return `${where} cannot be reached: this computer is offline.`;
    case "unsupported":
      return "This desk cannot read this kind of source.";
    default:
      break;
  }
  if (failure.name !== "UniversalError") return failed;
  const said = String(failure.message ?? "");
  const status = /^(\d{3}) /.exec(said);
  if (status) return `${where} answered ${status[1]}: there is nothing to show.`;
  if (said.startsWith("Not YAML")) return `${where} is not YAML or JSON.`;
  if (said.includes("larger than")) return `${where} is larger than 8 MiB, more than a view reads.`;
  return `${where} holds no entries a view can show.`;
}

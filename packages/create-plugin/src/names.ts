// Ids and display names for a new plugin folder.

/** `PluginId` in specs/plugin/v0/plugin.schema.json. */
const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const ID_MAX_LENGTH = 128;

/**
 * `local.<folder>`, lowercased and dashed: the id Desk gives a folder whose manifest has none
 * (desk-core `fallback_id`), so a scaffolded plugin keeps the id it would have had anyway.
 */
export function defaultId(folder: string): string {
  const body = folder
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (body === "") return "local.plugin";
  return /^[0-9]/.test(body) ? `local.p${body}` : `local.${body}`;
}

/** The folder name as words, first one capitalised: `my-plugin` becomes `My plugin`. */
export function defaultName(folder: string): string {
  const words = folder
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");
  if (words === "") return "Plugin";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Why the manifest schema would refuse `id`, or null when it accepts it. */
export function checkId(id: string): string | null {
  if (id.length > ID_MAX_LENGTH) return `id is longer than ${ID_MAX_LENGTH} characters`;
  if (!ID_PATTERN.test(id)) {
    return `id ${id} is not lowercase reverse-domain with a dot, like example.my-plugin`;
  }
  return null;
}

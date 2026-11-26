// Use the failed load's source to name its read scope.
import { scopeOf } from "./open.js";

/**
 * @param {unknown} error
 * @param {import("@endue-ai/bridge").UniversalSource | undefined} source
 * @returns {import("@endue-ai/bridge").Permission | undefined}
 */
export function missingAccess(error, source) {
  const refused =
    /** @type {{ code?: string, permission?: import("@endue-ai/bridge").Permission } | null} */ (
      error
    );
  if (refused?.code !== "permission_denied") return undefined;
  let permission;
  try {
    permission = scopeOf(source) ?? refused.permission;
  } catch {
    return undefined;
  }
  if (permission?.permission === "fs:read" && permission.paths.some((path) => /[*?\\]/.test(path)))
    return undefined;
  if (permission?.permission === "cmd:invoke" && permission.ids.some((id) => id.includes("*")))
    return undefined;
  return permission;
}

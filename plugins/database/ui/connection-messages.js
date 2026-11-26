// The message for a closed connection includes its session and remembered-password state.
import { t } from "./strings/index.js";

/** @param {import("./engines/common.js").Connection} conn @param {boolean} remembered */
export function disconnectedMessage(conn, remembered) {
  return t("manage.disconnectedItsPasswordIsForgotten", {
    name: conn.name,
    closed: conn.engine === "postgresql" ? t("manage.disconnectedSessions") : "",
    kept: remembered ? t("manage.disconnectedKeptPassword") : "",
  });
}

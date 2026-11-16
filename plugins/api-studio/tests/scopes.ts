// Scopes for the tests: an environment whose `key` is a secret holding the first value given,
// with any other names as plain variables.
import { scope } from "../ui/vars.js";

export function scopesIn(secrets: string[], plain: Record<string, string> = {}) {
  const values: Record<string, string> = { ...plain };
  if (secrets[0]) values.key = secrets[0];
  return [scope("env", "Env", values, new Set(secrets[0] ? ["key"] : []))];
}

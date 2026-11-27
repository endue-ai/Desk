// What keeps a request from carrying more than the person meant: which collections' scripts may
// run (trust.js), which local files curl may send (file-guard.js), and secrets typed into what is
// saved as files (literal-secrets.js). Installed after the collections and environments, whose
// save they wrap.

import { installFileGuard } from "./file-guard.js";
import { installLiteralSecrets } from "./literal-secrets.js";
import { installTrust } from "./trust.js";

/** @param {import("./studio.js").Studio} S */
export function installGuards(S) {
  installTrust(S);
  installFileGuard(S);
  installLiteralSecrets(S);
}

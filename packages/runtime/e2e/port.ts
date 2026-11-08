import { fileURLToPath } from "node:url";

// Parallel agents run the runtime tests from several worktrees at once. Each checkout gets its own
// fixture port, derived from its path, so a run never talks to another worktree's server. CI keeps 4173.
// DESK_E2E_PORT overrides both.
function checkoutPort(): number {
  if (process.env.DESK_E2E_PORT) return Number(process.env.DESK_E2E_PORT);
  if (process.env.CI) return 4173;
  const path = fileURLToPath(new URL("../../../", import.meta.url));
  let hash = 2166136261;
  for (const char of path) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return 4200 + (hash % 800);
}

export const port = checkoutPort();
export const baseURL = `http://127.0.0.1:${port}`;

// The fixture server: started fresh for every run (never reused, so a busy port fails instead of
// testing someone else's code) and told its port through the environment.
export const webServer = {
  command: "pnpm exec vite --config e2e/vite.config.ts",
  url: baseURL,
  reuseExistingServer: false,
  env: { DESK_E2E_PORT: String(port) },
};

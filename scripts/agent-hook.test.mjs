import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { blockReason, hook } from "./agent-hook.mjs";

const mac = { platform: "darwin", cwd: process.cwd() };

test("direct Playwright runs are blocked on macOS", () => {
  for (const command of [
    "pnpm --filter @endue-ai/runtime exec playwright test",
    "pnpm exec playwright test e2e/eris.spec.ts --repeat-each=10 --workers=12",
    "npx playwright test",
    "cd packages/runtime && pnpm exec playwright test --config playwright.chromium-local.config.ts",
    "node_modules/.bin/playwright test",
    "pnpm playwright test",
    "pnpm exec playwright codegen http://127.0.0.1:4173",
    "bash -c 'pnpm exec playwright test'",
    "timeout 600 npx playwright test",
    "npx -y playwright@1.64.1 test",
    "pnpm dlx @playwright/test@latest test",
    `node -e "require('playwright').webkit.launch()"`,
    "FOO=1 pnpm exec playwright test 2>&1 | tail -30",
  ]) {
    assert.match(blockReason(command, mac) ?? "", /just test-e2e/, command);
  }
});

test("a script that imports Playwright is blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-hook-"));
  writeFileSync(
    join(dir, "probe.mjs"),
    'import { webkit } from "playwright";\nawait webkit.launch();\n',
  );
  writeFileSync(join(dir, "plain.mjs"), "console.log(1);\n");
  assert.ok(blockReason("node probe.mjs", { ...mac, cwd: dir }));
  assert.equal(blockReason("node plain.mjs", { ...mac, cwd: dir }), null);
});

test("the runner, installs, reports and reading the configs pass", () => {
  for (const command of [
    "just test-e2e",
    "just test-e2e --update-snapshots e2e/eris.spec.ts",
    "just perf-opening record",
    "node scripts/e2e.mjs test",
    "pnpm --filter @endue-ai/runtime e2e",
    "grep -rn playwright packages/runtime",
    "pnpm add -D playwright",
    "npm view playwright version",
    "pnpm --filter @endue-ai/runtime exec playwright install webkit",
    "pnpm exec playwright --version",
    "pnpm exec playwright show-report",
    "pnpm exec playwright show-trace test-results/trace.zip",
    "cat packages/runtime/playwright.config.ts",
    "git diff -- packages/runtime/playwright.config.ts",
    "gh issue create --body 'do not run pnpm exec playwright test'",
    "cat > notes.md <<'EOF'\npnpm exec playwright test\nEOF",
  ]) {
    assert.equal(blockReason(command, mac), null, command);
  }
});

test("other platforms are left alone", () => {
  assert.equal(blockReason("pnpm exec playwright test", { ...mac, platform: "linux" }), null);
});

test("the hook blocks with exit code 2 and passes other tools through", () => {
  const blocked = hook({ tool_name: "Bash", tool_input: { command: "npx playwright test" } }, mac);
  assert.equal(blocked.code, 2);
  assert.match(blocked.message, /ADR 0018/);
  const read = hook({ tool_name: "Read", tool_input: { file_path: "x" } }, mac);
  assert.deepEqual(read, { code: 0, message: "" });
  assert.deepEqual(hook({}, mac), { code: 0, message: "" });
});

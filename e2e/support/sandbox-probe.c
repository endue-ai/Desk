// The app e2e's sandbox probe (macOS): asks the kernel about another process's sandbox without
// running anything inside it. For one pid it prints a JSON line saying whether the process has a
// sandbox at all and, for each path after `read` or `write`, whether that process may read or write
// it ("denied" or "allowed"). It is sandbox_check(3), the call Activity Monitor's Sandbox column and
// Chromium's own checks make, with SANDBOX_CHECK_NO_REPORT so a query leaves no denial in the log.
// The kernel answers "denied" for a path that does not exist, sandbox or not, so such a path is
// "missing" here; the path is resolved first (/tmp is /private/tmp), as the kernel matches it.
// e2e/support/sandbox.ts builds it with cc into e2e/test-results.
//   sandbox-probe <pid> [read <path>...] [write <path>...]
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// libsystem_sandbox exports these; the SDK's sandbox.h does not declare them.
enum sandbox_filter_type { SANDBOX_FILTER_NONE = 0, SANDBOX_FILTER_PATH = 1 };
extern const enum sandbox_filter_type SANDBOX_CHECK_NO_REPORT;
extern int sandbox_check(pid_t pid, const char *operation, enum sandbox_filter_type type, ...);

static void print_string(const char *text) {
  putchar('"');
  for (const char *c = text; *c; c++) {
    if (*c == '"' || *c == '\\') putchar('\\');
    putchar(*c);
  }
  putchar('"');
}

// What the process may do to `path`: "denied", "allowed", "missing" or "unknown".
static const char *answer(pid_t pid, const char *operation, const char *path) {
  char real[PATH_MAX];
  if (!realpath(path, real)) return "missing";
  int denied = sandbox_check(pid, operation, SANDBOX_FILTER_PATH | SANDBOX_CHECK_NO_REPORT, real);
  return denied == 1 ? "denied" : denied == 0 ? "allowed" : "unknown";
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: sandbox-probe <pid> [read <path>...] [write <path>...]\n");
    return 2;
  }
  pid_t pid = (pid_t)strtol(argv[1], NULL, 10);
  int sandboxed = sandbox_check(pid, NULL, SANDBOX_FILTER_NONE);
  if (sandboxed < 0) {
    fprintf(stderr, "sandbox-probe: no answer for pid %d\n", (int)pid);
    return 1;
  }
  printf("{\"pid\":%d,\"sandboxed\":%s", (int)pid, sandboxed ? "true" : "false");
  const char *operation = NULL;
  const char *key = NULL;
  int first = 1;
  for (int i = 2; i < argc; i++) {
    if (strcmp(argv[i], "read") == 0 || strcmp(argv[i], "write") == 0) {
      int read = argv[i][0] == 'r';
      if (key) printf("}");
      operation = read ? "file-read-data" : "file-write-data";
      key = read ? "read" : "write";
      printf(",\"%s\":{", key);
      first = 1;
      continue;
    }
    if (!operation) {
      fprintf(stderr, "sandbox-probe: a path before read or write\n");
      return 2;
    }
    if (!first) putchar(',');
    first = 0;
    print_string(argv[i]);
    printf(":\"%s\"", answer(pid, operation, argv[i]));
  }
  if (key) printf("}");
  printf("}\n");
  return 0;
}

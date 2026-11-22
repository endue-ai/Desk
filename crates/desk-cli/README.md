# endue CLI

The public `desk-cli` crate builds `endue` and its compatibility command `desk` from the same implementation and release. Both accept the same arguments, socket protocol, overrides and exit codes. The `desk` entry point stays available throughout the current major release line (ADR 0333).

## Installation

Desktop packages include both commands in their own `cli` directory. On macOS use the installed app's `Contents/Resources/cli`. A Debian installation uses `/usr/lib/endue-desk/cli`. On Windows use `cli` inside the installed app directory. Run the packaged executable directly at any time.

On macOS and Linux run the packaged `cli/activate` to link both commands into `~/.local/bin`, or pass your preferred bin directory and put it on PATH. On Windows run the packaged `cli/activate.ps1` in PowerShell to use both commands in that session. Activation checks both names before making changes. If another program owns either name, use the packaged CLI's absolute path. Repeating activation recognizes the existing installation.

## Commands

```sh
endue --help                              # complete command reference
endue --version                           # tagged release version
endue plugin validate <dir>               # check plugin.json and declared files locally
endue plugin test <dir>                   # run the plugin's tests
endue doctor [--data <dir>]               # inspect local state; --last-crash or --trace <file>
endue export <dir|file.zip> [--with-data] # export a profile; import restores it
endue plugin list --lock                  # read ~/.desk/plugins.lock locally
endue ping                                # round trip to the running app
endue cmd list                            # list the app's commands
endue cmd run <id> [--args <json>]        # invoke an existing command and print its result
endue mcp [--agent <id>] [--plugin <id>]  # serve the running app over stdio
endue open <path|endue://v1/…>            # open in the app, starting it if needed
```

Live commands use the app's socket as `cli`; `DESK_SOCKET` selects another socket. `DESK_APP` selects an absolute app executable for `open`. MCP acts as its client agent. For JavaScript plugin tests with an installed binary, point `DESK_REPO` at the SDK checkout where you ran `pnpm install`. `--json` returns the documented machine-readable command result. Both executables exit 0 on success, 1 on a failed check or call, and 2 for usage errors.

## Testing

Run `cargo test -p desk-cli` for local files, scripted replies and live commands against a real core and socket. `cargo run -p desk-cli -- --help` runs the canonical entry point from source.

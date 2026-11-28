# desk-sessions

The agent programs' session transcripts on this computer, read-only, as agent-session items (ADR 0403):
Claude Code (`~/.claude/projects/<project>/<id>.jsonl`, subagents in `<id>/subagents/`) and Codex
(`~/.codex/sessions/**`, `archived_sessions/**`, `.jsonl.zst` decompressed as read, thread names in
`session_index.jsonl`), in the folders the core's local agents use (ADR 0110). Each transcript
becomes one `record` item of `specs/item/v0/agent-session.schema.json`: who ran it, where, its parent,
and its links (files, memory notes, tickets, pull requests, issues, ADRs, branch, repository). The body
keeps what the person asked and the last answer, injected context removed and secrets masked. desk-core's
built-in connector `desk.agent-sessions` calls `sync` and writes the changes to the index.

Layer: Rust core (see `docs/architecture.md`).

## Public API

- `Roots { home, claude, codex }`, or `Roots::new(home)`: `$CLAUDE_CONFIG_DIR` and `$CODEX_HOME`, else
  `~/.claude` and `~/.codex`. desk-core passes its local agents' folders.
- `sync(&roots, &mut seen) -> Changes { upserted, removed }`: reads the transcripts that are new, grew,
  changed or were renamed since `seen`, on up to eight threads, and updates `seen`.
- `Seen::load(path)`, `seen.save(path)`, `Seen::fresh()`: what the last sync read, as JSON.
- `read_one(&transcript, &titles, &paths)`: one transcript as an item.
- `redact`, `strip_injected`, `MASK`: the text rules, for anyone keeping session text.
- `CONNECTOR`, `INSTANCE`, `SCHEMA`: the item source and schema `$id`.

Lines that are tool output, attachments, request copies or reasoning are skipped by their type before
parsing; a line over 8 MiB is skipped. Symbolic links are never followed.

## Testing

```bash
cargo test -p desk-sessions
```

`src/*` hold unit tests for text, links and times; `tests/sync.rs` writes Claude and Codex transcripts
into a temporary home and checks the items, what is left out, and incremental syncs.

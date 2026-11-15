# desk-link

`endue://` links (ADR 0244): the v1 grammar that opens a file, a plugin or a command in the desk,
parsed and formatted with no I/O and no dependencies. The shell reads the links the OS hands it
(`apps/desk/shell/src/open_files.rs`), and `desk open` checks one before it starts the desk.

```text
endue://v1/open?path=<percent-encoded absolute path>   open a file or folder, as a double-click does
endue://v1/plugin/<plugin-id>[?surface=<surface-id>]   bring a plugin up
endue://v1/command/<command-id>                         run a command, once the person says yes
```

The scheme, version and verb are case-insensitive. `auth` and `install` are reserved and refused;
an unknown version, verb or query key, a repeated key, a fragment, a user or port, a relative or
`..` path, a NUL and a link over 8 KiB are refused whole, each with a sentence for the notice.

## Public API

- `parse(text) -> Result<Link, Refused>`; `Link::{Open, Plugin, Command}`; `Refused(sentence)`.
- `Link`'s `Display` is the canonical form: lowercase scheme, version and verb, the path encoded.
- `is_link(arg)`: whether an argument is meant as a link (`endue:` in any case), not a path.
- `encode` and `decode`: the links' percent-encoding.

## Testing

`cargo test -p desk-link` (`tests/links.rs`).

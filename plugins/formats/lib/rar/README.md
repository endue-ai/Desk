# lib/rar

RAR 4 (RAR 2.9 and later) and RAR 5 archives, listed and decoded in plain JavaScript over a
`Source` (`{ size, read(offset, length) }`). No SDK, no DOM: it runs in a plugin frame, a worker or
Node. Written from RARLAB's RAR 5.0 technote and libarchive's BSD-licensed readers (`NOTICE`,
ADR 0051).

## API

```js
import { openRar } from "@endue-ai/formats/rar/index.js";

const archive = await openRar(source, { signal, maxWindow });
archive.entries; // { path, kind, size, packed, date, method, encrypted?, link?, refusal? }
await archive.read(entry, limit); // one entry's bytes (the first `limit` of them)
await archive.each(entries, visit); // several in one pass through a solid archive
```

`openRar` answers the `Archive` shape of `plugins/archives/ui/formats/archive.js`. Entries that
cannot be read carry a `refusal` sentence (exported: `ENCRYPTED`, `SPLIT`, `OLD_METHOD`, ...);
damage rejects with a sentence (`DAMAGED`, `TRUNCATED`, `BAD_HEADER_CRC`, a CRC mismatch). Decoding
yields to the event loop every few milliseconds and stops with an `AbortError` when `signal` fires.
`maxWindow` caps the dictionary memory (1 GiB by default).

What it decodes: RAR 5's LZ method with every v0 dictionary size and its delta, E8, E8E9 and ARM
filters; RAR 2.9's LZ, PPMd variant H and the standard VM filters (E8, E8E9, delta, RGB, audio);
stored and solid archives; CRC32 checked, BLAKE2sp reported as not checked. Refused with a
sentence: encryption, entries split across volumes, RAR 1.5 and 2.0 compression, other VM code,
RAR 7's method for dictionaries over 4 GB.

## Tests

`pnpm exec vitest run plugins/formats/tests/rar`. The fixtures come from
`tests/rar/make-fixtures.sh` (RARLAB's rar in Docker); `node tests/rar/bench.mjs <archive>` times a
large decode.

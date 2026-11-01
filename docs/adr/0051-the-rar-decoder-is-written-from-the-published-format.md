---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# The RAR decoder is written from the published format, never from unRAR

## Context and Problem Statement

`endue.archives` lists RAR archives but could not extract compressed entries, and `endue.reader`
cannot open CBR comics: RAR's own decoder is published only as the unRAR source, whose licence
forbids using it to re-create the RAR compression algorithm, and the desk is Apache-2.0. The RAR 4
and RAR 5 methods (LZ with Huffman codes, PPMd variant H, filters) are needed in `endue.formats`
(`plugins/formats/lib/rar/`) for both plugins. Where may that code come from?

## Decision Drivers

* Real RAR files open and extract, RAR 4 and RAR 5, solid or not, at a speed that suits 200 MB files
* Nothing derived from unRAR or from GPL or LGPL code; the repository stays Apache-2.0
* No native code or WebAssembly to build and ship per platform; it runs in a plugin frame and Node
* Every source that was followed is named and credited

## Considered Options

* Write it in JavaScript from RARLAB's RAR 5.0 technote, libarchive's BSD-licensed RAR readers and
  the public-domain PPMd var.H (Shkarin, Pavlov's LZMA SDK), testing against archives RARLAB's rar
  writes
* Port unRAR, or 7-Zip's RAR code (LGPL with the unRAR restriction)
* Compile libarchive to WebAssembly and vendor it
* Leave RAR as listing only

## Decision Outcome

Chosen option: "write it from the published format and libarchive", because it is the only option
that both decodes RAR and keeps the licence clean.

* `lib/rar/NOTICE` names every source and carries libarchive's BSD licence. Nobody working on this
  code reads unRAR's source or 7-Zip's `Rar*` files.
* Behaviour none of the sources covers (how a solid RAR 4 stream carries its tables, PPMd model and
  escape symbol from file to file) is found by decoding archives rar wrote, never by reading a
  decoder that is not permissive.
* The fixtures are made by `tests/rar/make-fixtures.sh` with RARLAB's trial rar for Linux, pinned
  by version and SHA-256 and run in Docker; only small archives and the originals' hashes are
  committed, never the tool.
* RAR 1.5 and 2.0 compression, the RAR VM beyond its standard filters, encryption and RAR 7's method
  for dictionaries over 4 GB are refused with a sentence rather than guessed at.

### Consequences

* Good, because RAR and CBR files open in the desk, and community plugins can import the decoder.
* Good, because it is plain JavaScript: 140 MB/s (RAR 5) and 105 MB/s (RAR 4) on 200 MB in Node,
  12 MB/s for PPMd text.
* Bad, because RAR's own description of its methods is the source we may not use: a change in a
  future RAR version has to be found again from libarchive or from rar's output.
* Bad, because the parts no permissive source covers are known only as far as the fixtures test them.

## More Information

`plugins/formats/lib/rar/README.md`, `plugins/formats/lib/rar/NOTICE`, RARLAB's technote
(https://www.rarlab.com/technote.htm), libarchive (https://github.com/libarchive/libarchive),
ADR 0049 (library plugins share format readers).

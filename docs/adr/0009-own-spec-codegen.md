---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# Generate Rust and TypeScript types from specs/ with our own small generator

## Context and Problem Statement

`specs/` is the single source of truth for the bridge, plugin and brain types (design rule 2). Both Rust
and TypeScript need types generated from JSON Schema (bridge, plugin) and OpenAPI 3.1 (brain), committed,
readable without a build, and checked for drift in CI. Which generator?

## Decision Drivers

* Byte-for-byte deterministic output, so `codegen-check` can diff it
* The same shapes on both sides: a tagged union in TypeScript must be the same union in Rust
* Readable output with the spec's descriptions as doc comments
* Few dependencies, and no network or external service at generation time

## Considered Options

* Our own generator in `scripts/codegen/` for the JSON Schema subset the specs use
* quicktype for both languages
* typify (Rust) plus json-schema-to-typescript and openapi-typescript (TypeScript)

## Decision Outcome

Chosen option: "our own generator", because it is about 400 lines, produces the same model for both
languages, and fails loudly on any schema shape it does not understand instead of guessing. Output goes
through rustfmt and biome, so formatting is deterministic and matches the rest of the code.

The supported subset: objects with properties (structs), string enums, `oneOf` of `$ref`s (unions, untagged
in Rust and discriminated by a `const` field), arrays, maps, `$ref` across files, string and boolean
`const` fields, and free JSON values. Validation-only keywords (patterns, bounds, `if`/`then`) are left to
the JSON Schema validators (Ajv and the `jsonschema` crate), which the contract tests run on both sides.

### Consequences

* Good, because generated files are small, documented and stable across runs.
* Good, because every spec file is also linted (Ajv strict mode, spectral) and tested against shared vectors.
* Bad, because new schema features need generator work; the generator rejects them until then.
* Bad, because Rust unions are untagged, so deserialisation errors name no variant. Validators give the
  precise reason.

## More Information

`scripts/codegen.mjs`, `scripts/codegen/`, `just codegen`, the `codegen-check` CI job. Issue #6.

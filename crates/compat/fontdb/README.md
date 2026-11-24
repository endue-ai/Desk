# Font discovery for cosmic-text

Cosmic-text 0.19 selects fontdb 0.23. This package forwards the public API and feature selections to the complete fontdb 0.24 registry implementation. Font discovery and parsing use that implementation and its font reader.

Upstream cosmic-text made this dependency change in commit `59089955e1c8698c6b83b2e6ab6ebceff825ff96`. Remove this package when a published cosmic-text version accepts fontdb 0.24. Run `cargo test -p desk-compositor` and `just perf-motion`.

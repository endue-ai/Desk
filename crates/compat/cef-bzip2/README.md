# CEF archive decoder

The registry release of download-cef 3.0 uses `bzip2::bufread::BzDecoder::new` to read a distribution archive. This build-time adapter routes that call to the independent crabz2 streaming decoder. The original CEF downloader continues to verify the archive digest, unpack the tar archive and select the platform layout.

The dependency graph test verifies that download-cef is the only consumer of this adapter. Remove this package when the registry downloader selects a backend accepted by the release policy. Run `cargo test -p bzip2@0.6.1` and `just check-shell`; building the shell exercises the original downloader.

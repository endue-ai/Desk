//! Stream decoding for the archive reader used by download-cef.
pub mod bufread {
    pub use crabz2::Crabz2Reader as BzDecoder;
}

#[cfg(test)]
mod tests {
    use super::bufread::BzDecoder;
    use std::io::{BufReader, Read};

    // A reference bzip2 stream containing "endue" followed by a newline.
    const SAMPLE: &[u8] = &[
        66, 90, 104, 57, 49, 65, 89, 38, 83, 89, 52, 49, 57, 179, 0, 0, 1, 193, 128, 0, 16, 6, 1,
        2, 0, 32, 0, 48, 205, 0, 195, 69, 48, 110, 46, 228, 138, 112, 161, 32, 104, 98, 115, 102,
    ];

    #[test]
    fn decodes_the_reference_stream_in_small_reads() {
        let mut reader = BzDecoder::new(BufReader::new(SAMPLE));
        let mut output = Vec::new();
        let mut chunk = [0; 2];
        loop {
            let count = reader.read(&mut chunk).unwrap();
            if count == 0 {
                break;
            }
            output.extend_from_slice(&chunk[..count]);
        }
        assert_eq!(output, b"endue\n");
    }

    #[test]
    fn rejects_an_invalid_header() {
        let mut reader = BzDecoder::new(BufReader::new(&b"endue"[..]));
        assert!(reader.read_to_end(&mut Vec::new()).is_err());
    }
}

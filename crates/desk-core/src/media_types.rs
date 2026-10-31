//! The media type a file is served with, from its extension: what fs.url answers as `type` and the
//! app's `desk-plugin` scheme sends as `Content-Type` (ADR 0041). Common audio, video, image and
//! document types; anything else is `application/octet-stream`, which no frame renders as a page.

/// The media type for a file name or path, by its extension in any case.
pub fn media_type(name: &str) -> &'static str {
    let file = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let Some((_, extension)) = file.rsplit_once('.') else {
        return OCTET_STREAM;
    };
    let extension = extension.to_ascii_lowercase();
    TYPES
        .iter()
        .find(|(ext, _)| *ext == extension)
        .map_or(OCTET_STREAM, |(_, kind)| kind)
}

const OCTET_STREAM: &str = "application/octet-stream";

const TYPES: &[(&str, &str)] = &[
    // Video
    ("mp4", "video/mp4"),
    ("m4v", "video/x-m4v"),
    ("mov", "video/quicktime"),
    ("webm", "video/webm"),
    ("mkv", "video/x-matroska"),
    ("ogv", "video/ogg"),
    ("3gp", "video/3gpp"),
    ("3g2", "video/3gpp2"),
    ("mpg", "video/mpeg"),
    ("mpeg", "video/mpeg"),
    ("avi", "video/x-msvideo"),
    // Audio
    ("mp3", "audio/mpeg"),
    ("m4a", "audio/mp4"),
    ("m4b", "audio/mp4"),
    ("aac", "audio/aac"),
    ("wav", "audio/wav"),
    ("aif", "audio/aiff"),
    ("aiff", "audio/aiff"),
    ("flac", "audio/flac"),
    ("ogg", "audio/ogg"),
    ("oga", "audio/ogg"),
    ("opus", "audio/ogg"),
    ("caf", "audio/x-caf"),
    ("weba", "audio/webm"),
    ("mka", "audio/x-matroska"),
    // Images
    ("png", "image/png"),
    ("apng", "image/apng"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("jfif", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("avif", "image/avif"),
    ("heic", "image/heic"),
    ("heif", "image/heif"),
    ("jxl", "image/jxl"),
    ("tif", "image/tiff"),
    ("tiff", "image/tiff"),
    ("bmp", "image/bmp"),
    ("ico", "image/vnd.microsoft.icon"),
    ("svg", "image/svg+xml"),
    // Documents, and subtitles for <track>
    ("pdf", "application/pdf"),
    ("vtt", "text/vtt"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_come_from_the_extension_in_any_case() {
        assert_eq!(media_type("~/Movies/Holiday 2026.mp4"), "video/mp4");
        assert_eq!(media_type("IMG_0001.JPG"), "image/jpeg");
        assert_eq!(media_type("C:\\Music\\song.Flac"), "audio/flac");
        assert_eq!(media_type("~/notes.md"), "application/octet-stream");
        assert_eq!(media_type("~/page.html"), "application/octet-stream");
        assert_eq!(media_type("~/Makefile"), "application/octet-stream");
        assert_eq!(media_type("~/.mp4/clip"), "application/octet-stream");
    }

    #[test]
    fn the_table_covers_the_common_media() {
        let names = "mp4 m4v mov webm mkv ogv 3gp mp3 m4a m4b aac wav aif aiff flac ogg oga opus \
                     caf weba png jpg jpeg gif webp avif heic heif tif tiff bmp ico svg pdf";
        for extension in names.split_whitespace() {
            let kind = media_type(&format!("a.{extension}"));
            assert_ne!(kind, OCTET_STREAM, "{extension}");
        }
    }
}

use std::io::Cursor;

use desk_image_studio::{Document, Image, Operation};

#[test]
fn edits_keep_alpha_and_png_round_trips_the_result() {
    let pixels = vec![255, 0, 0, 255, 0, 0, 255, 0];
    let original = Image::new(2, 1, pixels).unwrap();
    let mut document = Document::new(original.clone());
    document
        .apply(&[
            Operation::Resize {
                width: 1,
                height: 1,
            },
            Operation::Invert,
        ])
        .unwrap();
    assert_eq!(document.image().pixels(), [0, 255, 255, 128]);
    let png = document.image().png().unwrap();
    let mut decoder = png::Decoder::new(Cursor::new(png)).read_info().unwrap();
    let mut bytes = vec![0; decoder.output_buffer_size().unwrap()];
    decoder.next_frame(&mut bytes).unwrap();
    assert_eq!(bytes, document.image().pixels());
    document.undo().unwrap();
    assert_eq!(document.image(), &original);
    document.redo().unwrap();
    assert_eq!(document.image().pixels(), [0, 255, 255, 128]);
}

#[test]
fn filter_batches_are_atomic_and_blur_ignores_fully_transparent_colors() {
    let mut doc = Document::new(Image::new(2, 1, vec![255, 0, 0, 255, 0, 0, 255, 0]).unwrap());
    assert!(
        doc.apply(&[Operation::Invert, Operation::Blur { radius: 0 }])
            .is_err()
    );
    assert!(doc.undo().is_err());
    doc.apply(&[Operation::Blur { radius: 1 }]).unwrap();
    assert_eq!(doc.image().pixels(), [255, 0, 0, 170, 255, 0, 0, 85]);
}

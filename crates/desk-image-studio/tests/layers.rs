use desk_image_studio::{Document, Image, Operation, Point, StrokeMode};

fn pixel(document: &Document, x: usize, y: usize) -> &[u8] {
    let image = document.image();
    let start = (y * image.size().0 + x) * 4;
    &image.pixels()[start..start + 4]
}

fn shade(mode: StrokeMode, strength: u8, points: Vec<Point>) -> Operation {
    Operation::Stroke {
        layer: 2,
        mode,
        radius: 1,
        strength,
        color: Some([255, 0, 0]),
        points,
    }
}

#[test]
fn overlapping_brush_segments_are_composited_once_and_masks_are_reversible() {
    let mut document = Document::new(Image::new(8, 7, [0, 0, 255, 255].repeat(56)).unwrap());
    document
        .apply(&[
            Operation::AddLayer {
                name: "Paint".into(),
            },
            shade(
                StrokeMode::Paint,
                50,
                vec![
                    Point { x: 1, y: 3 },
                    Point { x: 6, y: 3 },
                    Point { x: 1, y: 3 },
                ],
            ),
        ])
        .unwrap();
    assert_eq!(pixel(&document, 4, 3), [128, 0, 127, 255]);
    assert_eq!(pixel(&document, 4, 1), [0, 0, 255, 255]);
    document
        .apply(&[
            shade(StrokeMode::MaskHide, 100, vec![Point { x: 4, y: 3 }]),
            Operation::Rotate { degrees: 90 },
        ])
        .unwrap();
    assert_eq!(document.image().size(), (7, 8));
    assert_eq!(pixel(&document, 3, 4), [0, 0, 255, 255]);
    assert_eq!(pixel(&document, 3, 1), [128, 0, 127, 255]);
    document
        .apply(&[shade(
            StrokeMode::MaskReveal,
            100,
            vec![Point { x: 3, y: 4 }],
        )])
        .unwrap();
    assert_eq!(pixel(&document, 3, 4), [128, 0, 127, 255]);
    document.undo().unwrap();
    assert_eq!(pixel(&document, 3, 4), [0, 0, 255, 255]);
    document.redo().unwrap();
    assert_eq!(pixel(&document, 3, 4), [128, 0, 127, 255]);
}

#[test]
fn layer_reordering_and_layer_edits_are_atomic() {
    let mut document = Document::new(Image::new(2, 2, [0, 0, 255, 255].repeat(4)).unwrap());
    document
        .apply(&[
            Operation::DuplicateLayer {
                layer: 1,
                name: None,
            },
            Operation::Invert { layer: Some(2) },
            Operation::SetLayer {
                layer: 2,
                name: None,
                opacity: Some(50),
                visible: None,
            },
        ])
        .unwrap();
    assert_eq!(pixel(&document, 0, 0), [128, 128, 127, 255]);
    let edited = document.image().clone();
    assert!(
        document
            .apply(&[
                Operation::MoveLayer { layer: 2, index: 0 },
                Operation::RemoveLayer { layer: 9 },
            ])
            .is_err()
    );
    assert_eq!(document.image(), &edited);
    document
        .apply(&[Operation::MoveLayer { layer: 2, index: 0 }])
        .unwrap();
    assert_eq!(pixel(&document, 0, 0), [0, 0, 255, 255]);
    document.undo().unwrap();
    assert_eq!(document.image(), &edited);
}

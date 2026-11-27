//! The canvas map's size: the person resizes its box from its left edge, its top one or the corner
//! between them, in `MAP`'s proportions, between `MAP_LEAST` and `MAP_MOST` wide.

use desk_wm::{MAP, MAP_LEAST, MAP_MOST, MapEdges, Size, map_resized, map_size};

const LEFT: MapEdges = MapEdges {
    left: true,
    top: false,
};
const TOP: MapEdges = MapEdges {
    left: false,
    top: true,
};
const CORNER: MapEdges = MapEdges {
    left: true,
    top: true,
};

#[test]
fn a_size_keeps_the_maps_proportions_within_its_bounds() {
    assert_eq!(map_size(MAP.w), MAP);
    assert_eq!(map_size(288.0), Size { w: 288.0, h: 180.0 });
    assert_eq!(map_size(10.0).w, MAP_LEAST);
    assert_eq!(map_size(5000.0).w, MAP_MOST);
    assert_eq!(map_size(MAP_MOST).h, 300.0);
    assert_eq!(map_size(250.4).w, 250.0, "whole pixels");
    assert_eq!(map_size(f64::NAN), MAP);
    assert_eq!(map_size(f64::INFINITY), MAP);
}

#[test]
fn the_left_edge_grows_it_leftward_and_the_top_one_upward() {
    // 48 to the left: 48 wider. 30 down: 30 shorter, 48 narrower.
    assert_eq!(map_resized(MAP.w, LEFT, -48.0, 500.0).w, 240.0);
    assert_eq!(map_resized(MAP.w, TOP, 500.0, 30.0).w, 144.0);
    assert_eq!(
        map_resized(MAP.w, TOP, 0.0, -60.0),
        Size { w: 288.0, h: 180.0 }
    );
}

#[test]
fn at_the_corner_the_edge_that_grows_it_more_wins() {
    assert_eq!(map_resized(MAP.w, CORNER, -48.0, -60.0).w, 288.0);
    assert_eq!(map_resized(MAP.w, CORNER, -96.0, -30.0).w, 288.0);
    assert_eq!(map_resized(MAP.w, CORNER, 24.0, 15.0).w, 168.0);
    assert_eq!(map_resized(MAP.w, CORNER, -2000.0, 0.0).w, MAP_MOST);
}

#[test]
fn no_edge_or_no_number_leaves_it_as_it_was() {
    let none = MapEdges {
        left: false,
        top: false,
    };
    assert_eq!(map_resized(300.0, none, -50.0, -50.0).w, 300.0);
    assert_eq!(map_resized(f64::NAN, LEFT, 0.0, 0.0), MAP);
}

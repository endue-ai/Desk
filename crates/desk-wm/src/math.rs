//! Rounding as the runtime rounds, so the port gives the same pixels: JavaScript's `Math.round`
//! sends halves up (towards +∞), where Rust's `f64::round` sends them away from zero.

/// `Math.round(v)`: the nearest integer, a half going up (`-2.5` gives `-2`). Never `-0`.
pub(crate) fn round(v: f64) -> f64 {
    let floor = v.floor();
    let r = if v - floor >= 0.5 { floor + 1.0 } else { floor };
    // Adding zero turns -0 into 0, so snapshots never read "-0".
    r + 0.0
}

/// `Math.round(v * 10^digits) / 10^digits`: deterministic numbers in poses and snapshots.
pub(crate) fn round_to(v: f64, digits: i32) -> f64 {
    let k = 10f64.powi(digits);
    round(v * k) / k + 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halves_go_up_as_in_javascript() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(-0.5), 0.0);
        assert!(round(-0.4).is_sign_positive());
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(round(-7.6), -8.0);
    }

    #[test]
    fn rounds_to_decimals() {
        assert_eq!(round_to(1.005, 2), 1.0);
        assert_eq!(round_to(12.3456, 2), 12.35);
        assert_eq!(round_to(-0.001, 2), 0.0);
        assert!(round_to(-0.001, 2).is_sign_positive());
        assert_eq!(round_to(0.123_456, 4), 0.1235);
    }
}

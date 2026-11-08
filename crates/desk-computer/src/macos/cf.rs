//! Reading Core Foundation values: strings, numbers, booleans and dictionary entries.

use objc2_core_foundation::{
    CFArray, CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType,
};

pub(super) fn string(value: &CFType) -> Option<String> {
    value.downcast_ref::<CFString>().map(|s| s.to_string())
}

pub(super) fn number(value: &CFType) -> Option<f64> {
    value.downcast_ref::<CFNumber>().and_then(CFNumber::as_f64)
}

pub(super) fn boolean(value: &CFType) -> Option<bool> {
    if let Some(b) = value.downcast_ref::<CFBoolean>() {
        return Some(b.as_bool());
    }
    number(value).map(|n| n != 0.0)
}

/// A value as text: strings as they are, booleans as `1` or `0`, numbers in their shortest form.
pub(super) fn text(value: &CFType) -> Option<String> {
    if let Some(s) = string(value) {
        return Some(s);
    }
    if let Some(b) = value.downcast_ref::<CFBoolean>() {
        return Some(if b.as_bool() { "1" } else { "0" }.to_owned());
    }
    number(value).map(|n| n.to_string())
}

/// The entry for `key` of a dictionary with string keys.
pub(super) fn entry(dict: &CFDictionary, key: &CFString) -> Option<CFRetained<CFType>> {
    // SAFETY: the window server's and AX's dictionaries have CFString keys and CFType values.
    let dict = unsafe { dict.cast_unchecked::<CFString, CFType>() };
    dict.get(key)
}

/// The elements of an array of CF objects as `T`, skipping any of another type.
pub(super) fn items<T: objc2_core_foundation::ConcreteType>(array: &CFArray) -> Vec<CFRetained<T>> {
    // SAFETY: every element of a CFArray of CF objects is a CFType.
    let array = unsafe { array.cast_unchecked::<CFType>() };
    array
        .iter()
        .filter_map(|item| item.downcast::<T>().ok())
        .collect()
}

/// Every element of an array of CF objects.
pub(super) fn all(array: &CFArray) -> Vec<CFRetained<CFType>> {
    // SAFETY: every element of a CFArray of CF objects is a CFType.
    let array = unsafe { array.cast_unchecked::<CFType>() };
    array.iter().collect()
}

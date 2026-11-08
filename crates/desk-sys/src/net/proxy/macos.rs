//! The proxy settings of macOS: `SCDynamicStoreCopyProxies`, the merged settings of the network
//! services in use.

// One unsafe call: an exception list's elements come out of CoreFoundation as untyped pointers.
#![allow(unsafe_code)]

use system_configuration::core_foundation::array::CFArray;
use system_configuration::core_foundation::base::{CFType, TCFType};
use system_configuration::core_foundation::dictionary::CFDictionary;
use system_configuration::core_foundation::number::CFNumber;
use system_configuration::core_foundation::string::CFString;
use system_configuration::dynamic_store::SCDynamicStoreBuilder;

use super::Settings;

/// HTTP and HTTPS proxies when enabled, `ExceptionsList`, `ExcludeSimpleHostnames` and the PAC URL
/// when `ProxyAutoConfigEnable` is on. No proxies read as no settings.
pub(super) fn settings() -> Settings {
    let Some(proxies) = SCDynamicStoreBuilder::new("desk-sys")
        .build()
        .and_then(|store| store.get_proxies())
    else {
        return Settings::default();
    };
    let dict = Dict(proxies);
    Settings {
        pac_url: dict
            .on("ProxyAutoConfigEnable")
            .then(|| dict.string("ProxyAutoConfigURLString"))
            .flatten(),
        http: dict.manual("HTTP"),
        https: dict.manual("HTTPS"),
        bypass: dict.strings("ExceptionsList"),
        bypass_simple: dict.on("ExcludeSimpleHostnames"),
    }
}

struct Dict(CFDictionary<CFString, CFType>);

impl Dict {
    fn value(&self, key: &str) -> Option<CFType> {
        self.0.find(CFString::new(key)).map(|value| value.clone())
    }

    fn number(&self, key: &str) -> Option<i64> {
        self.value(key)?.downcast::<CFNumber>()?.to_i64()
    }

    fn on(&self, key: &str) -> bool {
        self.number(key).is_some_and(|value| value != 0)
    }

    fn string(&self, key: &str) -> Option<String> {
        let text = self.value(key)?.downcast::<CFString>()?.to_string();
        Some(text).filter(|text| !text.is_empty())
    }

    /// `<scheme>Enable`, `<scheme>Proxy` and `<scheme>Port` as an http proxy URL.
    fn manual(&self, scheme: &str) -> Option<String> {
        if !self.on(&format!("{scheme}Enable")) {
            return None;
        }
        let host = self.string(&format!("{scheme}Proxy"))?;
        Some(match self.number(&format!("{scheme}Port")) {
            Some(port) => format!("http://{host}:{port}"),
            None => format!("http://{host}"),
        })
    }

    fn strings(&self, key: &str) -> Vec<String> {
        let Some(array) = self
            .value(key)
            .and_then(|value| value.downcast::<CFArray>())
        else {
            return Vec::new();
        };
        array
            .iter()
            .filter_map(|item| {
                // SAFETY: the array holds CF objects and is alive for this call; the get rule
                // retains each one, and `downcast` checks its type.
                let item = unsafe { CFType::wrap_under_get_rule(*item) };
                item.downcast::<CFString>().map(|text| text.to_string())
            })
            .collect()
    }
}

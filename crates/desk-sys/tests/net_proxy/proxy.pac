// The PAC fixture of tests/net_proxy.rs. It never resolves a name: the hosts it sees are .test and
// .example names or IP literals, and only IP literals reach isInNet.
function FindProxyForURL(url, host) {
  if (isPlainHostName(host)) {
    return "DIRECT";
  }
  if (dnsDomainIs(host, ".corp.example")) {
    return "PROXY corp-proxy.test:3128";
  }
  if (/^[0-9.]+$/.test(host) && isInNet(host, "10.0.0.0", "255.0.0.0")) {
    return "PROXY ten-proxy.test:8080";
  }
  if (shExpMatch(host, "*.socks.example")) {
    return "SOCKS5 socks.test:1080";
  }
  if (shExpMatch(url, "https://secure.example/*")) {
    return "HTTPS tls-proxy.test:443";
  }
  if (shExpMatch(url, "http://many.example/*")) {
    return "PROXY first.test:1; SOCKS second.test:2; DIRECT";
  }
  if (dnsDomainLevels(host) == 1 && localHostOrDomainIs(host, "levels.example")) {
    return "SOCKS old-socks.test:1081";
  }
  return "DIRECT";
}

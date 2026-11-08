// biome-ignore-all lint/correctness/noUnusedVariables: these are the globals a PAC file calls.
// The PAC helper functions, written for desk-sys from the PAC format's description (no code from
// browsers). dnsResolve, myIpAddress and shExpMatch are native (pac.rs): the OS resolver, a local
// address found without sending a packet, and a shell expression matcher.

function isPlainHostName(host) {
  return !String(host).includes(".");
}

function dnsDomainIs(host, domain) {
  return String(host).toLowerCase().endsWith(String(domain).toLowerCase());
}

function localHostOrDomainIs(host, hostdom) {
  const name = String(host).toLowerCase();
  const full = String(hostdom).toLowerCase();
  return name === full || (!name.includes(".") && full.startsWith(`${name}.`));
}

function isResolvable(host) {
  return dnsResolve(host) !== null;
}

function dnsDomainLevels(host) {
  return String(host).split(".").length - 1;
}

// The four octets of a dotted IPv4 address, or null.
function deskOctets(text) {
  const parts = String(text).split(".");
  if (parts.length !== 4 || !parts.every((part) => /^[0-9]{1,3}$/.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function isInNet(host, pattern, mask) {
  let address = deskOctets(host);
  if (address === null) {
    const resolved = dnsResolve(host);
    address = resolved === null ? null : deskOctets(resolved);
  }
  const network = deskOctets(pattern);
  const bits = deskOctets(mask);
  if (address === null || network === null || bits === null) {
    return false;
  }
  return address.every((octet, i) => (octet & bits[i]) === (network[i] & bits[i]));
}

// The arguments without a trailing "GMT", and whether it was there.
function deskZone(args) {
  const gmt = args.length > 0 && String(args[args.length - 1]).toUpperCase() === "GMT";
  return { gmt, args: gmt ? args.slice(0, -1) : args };
}

// Whether value is in low..high, inclusive, wrapping around when low is after high.
function deskWithin(value, low, high) {
  return low <= high ? low <= value && value <= high : value >= low || value <= high;
}

function weekdayRange(...given) {
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const { gmt, args } = deskZone(given);
  const now = new Date();
  const today = gmt ? now.getUTCDay() : now.getDay();
  const first = days.indexOf(String(args[0]).toUpperCase());
  const last = args.length > 1 ? days.indexOf(String(args[1]).toUpperCase()) : first;
  return first >= 0 && last >= 0 && deskWithin(today, first, last);
}

const deskMonths = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

// The fields date arguments name: a month name, a year (over 31) or a day of the month, as one
// number (year, then month, then day) and the names of the fields.
function deskDate(values) {
  const date = { year: 0, month: 0, day: 0 };
  const named = [];
  for (const value of values) {
    const month = deskMonths.indexOf(String(value).toUpperCase());
    let field = "day";
    if (month >= 0) {
      field = "month";
    } else if (Number(value) > 31) {
      field = "year";
    }
    date[field] = month >= 0 ? month : Number(value);
    named.push(field);
  }
  return { number: date.year * 10000 + date.month * 100 + date.day, named };
}

function dateRange(...given) {
  const { gmt, args } = deskZone(given);
  if (args.length === 0 || args.length > 6 || (args.length > 1 && args.length % 2 !== 0)) {
    return false;
  }
  const half = args.length === 1 ? 1 : args.length / 2;
  const low = deskDate(args.slice(0, half));
  const high = args.length === 1 ? low : deskDate(args.slice(half));
  const now = new Date();
  const fields = {
    year: gmt ? now.getUTCFullYear() : now.getFullYear(),
    month: gmt ? now.getUTCMonth() : now.getMonth(),
    day: gmt ? now.getUTCDate() : now.getDate(),
  };
  // Today in the fields the arguments name.
  const values = { year: 0, month: 0, day: 0 };
  for (const field of low.named) {
    values[field] = fields[field];
  }
  const today = values.year * 10000 + values.month * 100 + values.day;
  return deskWithin(today, low.number, high.number);
}

function timeRange(...given) {
  const { gmt, args } = deskZone(given);
  const now = new Date();
  const h = gmt ? now.getUTCHours() : now.getHours();
  const m = gmt ? now.getUTCMinutes() : now.getMinutes();
  const s = gmt ? now.getUTCSeconds() : now.getSeconds();
  const n = args.map(Number);
  switch (n.length) {
    case 1:
      return h === n[0];
    case 2:
      return deskWithin(h, n[0], n[1]);
    case 4:
      return deskWithin(h * 60 + m, n[0] * 60 + n[1], n[2] * 60 + n[3]);
    case 6:
      return deskWithin(
        h * 3600 + m * 60 + s,
        n[0] * 3600 + n[1] * 60 + n[2],
        n[3] * 3600 + n[4] * 60 + n[5],
      );
    default:
      return false;
  }
}

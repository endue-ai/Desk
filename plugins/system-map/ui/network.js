import { idFor, msg, node } from "./model.js";

export function interfaces(text) {
  const adapters = [];
  let current;
  for (const line of text.split("\n")) {
    const head = /^(\S+): flags=\w+<([^>]*)> mtu (\d+)/.exec(line);
    if (head) {
      const [, name, flags, mtu] = head;
      current = node(idFor("interface", name), name, { flags, mtu });
      if (/^(utun|tun|tap|ipsec|ppp)\d+$/i.test(name)) current.fields.kind = msg("network.tunnel");
      adapters.push(current);
    } else if (current) {
      const field = /^\s*(inet6?|ether|status:)\s+(\S+)/.exec(line);
      if (!field) continue;
      const key = { inet: "ipv4", inet6: "ipv6", ether: "mac", "status:": "status" }[field[1]];
      current.fields[key] = [current.fields[key], field[2]].filter(Boolean).join(", ");
    }
  }
  return adapters;
}

export function vpn(text) {
  return text.split("\n").flatMap((line) => {
    const m = /^\s*\*?\s*\(([^)]+)\)\s+([\w-]+)\s+(.+?)\s+"(.+)"\s*(?:\[(.*)\])?\s*$/.exec(line);
    return m ? [node(idFor("vpn", m[2]), m[4], { status: m[1], kind: m[3], service: m[5] })] : [];
  });
}

export function peers(text) {
  return text.split("\n").flatMap((line) => {
    const arp = /\(([^)]+)\) at (\S+) on (\S+)/.exec(line);
    const ndp = /^\s*([\da-f:]+(?:%\S+)?)\s+(\S+)\s+(\S+)/i.exec(line);
    const match = arp ?? ndp;
    if (!match || (!arp && !match[1].includes(":"))) return [];
    return [
      node(idFor("peer", match[1], match[3]), match[1], {
        address: match[1],
        mac: match[2],
        interface: match[3],
      }),
    ];
  });
}

// lsof's tagged records start at p (process) and f (file). A TCP status can follow the address.
export function sockets(text) {
  const entries = [];
  let pid, owner, record;
  for (const line of text.split("\n")) {
    const value = line.slice(1);
    switch (line[0]) {
      case "p":
        pid = value;
        owner = undefined;
        record = undefined;
        break;
      case "c":
        owner = value;
        break;
      case "f":
        record = { pid, owner, fd: value };
        entries.push(record);
        break;
      case "P":
        if (record) record.protocol = value;
        break;
      case "n":
        if (record) [record.local, record.remote] = value.split("->");
        break;
      case "T":
        if (record && value.startsWith("ST=")) record.state = value.slice(3);
        break;
    }
  }
  return entries.filter((r) => r.pid && r.local && r.protocol);
}

export function socketNode(s, context) {
  const { local, remote, protocol, state, pid, owner, fd } = s;
  const fields = { protocol, local, remote, status: state, pid, process: owner, fd };
  if (!remote) {
    const host = local.replace(/:\d+$|:\*$/, "").replace(/^\[|\]$/g, "");
    const scope = ["*", "0.0.0.0", "::"].includes(host)
      ? "wildcard"
      : /^(?:127\.|::1$|::ffff:127\.)/i.test(host)
        ? "loopback"
        : "interface";
    fields.binding = msg(`scope.${scope}`);
  }
  return node(
    idFor(context, pid, fd, protocol, local, remote),
    remote ? `${local} → ${remote}` : `${protocol} ${local}`,
    fields,
  );
}

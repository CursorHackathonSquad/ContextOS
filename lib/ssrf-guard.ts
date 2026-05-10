import type { LookupAddress } from "node:dns";
import dns from "node:dns/promises";
import net from "node:net";

/**
 * Blocks SSRF targets: loopback, RFC1918, link-local (incl. cloud metadata), and IPv6 ULA/link-local.
 */
function createSsrfBlockList(): net.BlockList {
  const b = new net.BlockList();
  b.addSubnet("127.0.0.0", 8, "ipv4");
  b.addSubnet("10.0.0.0", 8, "ipv4");
  b.addSubnet("172.16.0.0", 12, "ipv4");
  b.addSubnet("192.168.0.0", 16, "ipv4");
  b.addSubnet("169.254.0.0", 16, "ipv4");
  b.addSubnet("0.0.0.0", 8, "ipv4");
  /** IPv4-mapped IPv6 (::ffff:x.x.x.x); covers SSRF via literals like ::ffff:127.0.0.1 */
  b.addSubnet("::ffff:0.0.0.0", 96, "ipv6");
  b.addAddress("::1", "ipv6");
  b.addSubnet("fe80::", 10, "ipv6");
  b.addSubnet("fc00::", 7, "ipv6");
  return b;
}

const blockList = createSsrfBlockList();

function isBlockedIpLiteral(addr: string, family: 4 | 6): boolean {
  const type = family === 6 ? "ipv6" : "ipv4";
  try {
    return blockList.check(addr, type);
  } catch {
    return true;
  }
}

/** Reserved / internal hostnames that must never be fetched. */
function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0" || h === "00") return true;
  return false;
}

export type ResolvedHttpTarget =
  /** Connect using URL host (literal IP); no extra DNS. */
  | { mode: "literal"; url: URL }
  /** Connect to `pinnedIp`; use URL host for Host / TLS SNI (DNS rebinding mitigated). */
  | { mode: "pinned"; url: URL; pinnedIp: string; family: 4 | 6 };

/**
 * Validates URL for SSRF and returns how to connect so fetch uses the same resolved IP as the check.
 */
export async function resolvePublicHttpTarget(urlString: string): Promise<ResolvedHttpTarget> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }

  if (url.username !== "" || url.password !== "") {
    throw new Error("URL must not contain credentials");
  }

  const host = url.hostname;
  if (!host) throw new Error("Missing hostname");

  if (isBlockedHostname(host)) {
    throw new Error("Hostname is not allowed (internal/reserved)");
  }

  if (net.isIPv4(host)) {
    if (isBlockedIpLiteral(host, 4)) {
      throw new Error("IPv4 address is in a blocked range");
    }
    return { mode: "literal", url };
  }

  if (net.isIPv6(host)) {
    if (isBlockedIpLiteral(host, 6)) {
      throw new Error("IPv6 address is in a blocked range");
    }
    return { mode: "literal", url };
  }

  let records: LookupAddress[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("DNS resolution failed");
  }

  if (!records.length) {
    throw new Error("DNS returned no addresses");
  }

  for (const r of records) {
    const family = r.family === 6 ? 6 : 4;
    if (isBlockedIpLiteral(r.address, family)) {
      throw new Error(`Hostname resolves to a blocked address (${r.address})`);
    }
  }

  const first = records[0];
  const family: 4 | 6 = first.family === 6 ? 6 : 4;
  return { mode: "pinned", url, pinnedIp: first.address, family };
}

/**
 * Throws if `urlString` is not a safe http(s) URL for server-side fetch (SSRF guard).
 */
export async function assertPublicHttpUrl(urlString: string): Promise<void> {
  await resolvePublicHttpTarget(urlString);
}

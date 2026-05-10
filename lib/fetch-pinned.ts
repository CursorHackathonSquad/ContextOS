import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { ResolvedHttpTarget } from "@/lib/ssrf-guard";

const MAX_RAW_BYTES = 2 * 1024 * 1024;

/**
 * GET over TCP to the address from {@link ResolvedHttpTarget} (no second DNS lookup).
 * Uses Host for vhosts; sets TLS {@link https.RequestOptions#servername} only for DNS names (RFC 6066 forbids IP literals in SNI).
 */
export async function fetchPinnedHttpGet(
  resolved: ResolvedHttpTarget,
  signal: AbortSignal,
  headerFields: Record<string, string>
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = resolved.url;
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;

  const connectHost = resolved.mode === "pinned" ? resolved.pinnedIp : url.hostname;
  const port = url.port ? Number.parseInt(url.port, 10) : isHttps ? 443 : 80;

  const options: https.RequestOptions = {
    hostname: connectHost,
    port,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: {
      ...headerFields,
      Host: url.host
    },
    signal,
    ...(isHttps && net.isIP(url.hostname) === 0 ? { servername: url.hostname } : {})
  };

  return await new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let overflowRejected = false;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_RAW_BYTES) {
          overflowRejected = true;
          res.destroy();
          req.destroy();
          reject(new Error("Response body too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (overflowRejected || res.destroyed) return;
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

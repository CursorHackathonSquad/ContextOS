import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin tracing to this app when another lockfile exists above the repo (avoids wrong roots / odd .next output).
  outputFileTracingRoot: projectRoot
};

export default nextConfig;


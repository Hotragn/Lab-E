import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This project sits under a directory that has a lockfile above it; pin the
  // tracing root so the build does not guess.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;

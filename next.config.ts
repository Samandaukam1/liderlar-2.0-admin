import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Turbopack ignores parent lockfiles.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

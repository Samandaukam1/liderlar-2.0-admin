import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Turbopack ignores parent lockfiles.
  turbopack: {
    root: __dirname,
  },
  // The certificate route reads its SVG template, fonts and QR logo via a
  // computed path (fs.readFile(path.join(process.cwd(), ...))), which isn't
  // statically analyzable — without this, Next's file tracer conservatively
  // bundles the entire project into the serverless function. Scope it down
  // to just the asset files that route actually needs.
  outputFileTracingIncludes: {
    "/api/admin/candidates/[candidateId]/certificate": ["public/assets/certificates/**/*"],
  },
};

export default nextConfig;

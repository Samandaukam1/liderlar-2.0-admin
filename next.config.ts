import type { NextConfig } from "next";

/**
 * Post Studio assets are read through computed paths
 * (fs.readFile(path.join(process.cwd(), ...))), which the file tracer cannot
 * analyse statically. Listing them explicitly keeps the tracer from
 * conservatively bundling the whole project into each serverless function.
 */
const POST_STUDIO_ASSETS = [
  "public/assets/post-studio/fonts/**/*",
  "public/assets/post-studio/backgrounds/**/*",
  "public/assets/post-studio/signature.svg",
];

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Turbopack ignores parent lockfiles.
  turbopack: {
    root: __dirname,
  },
  // @resvg/resvg-js ships a native .node binding that cannot be placed in an
  // ESM chunk; it has to stay an external require at runtime. sharp is listed
  // for the same reason.
  serverExternalPackages: ["@resvg/resvg-js", "sharp"],
  outputFileTracingIncludes: {
    "/api/admin/candidates/[candidateId]/certificate": ["public/assets/certificates/**/*"],
    "/api/admin/post-studio/[postId]/preview": POST_STUDIO_ASSETS,
    "/api/cron/post-pipeline": POST_STUDIO_ASSETS,
    "/postlar/[postId]": POST_STUDIO_ASSETS,
    "/postlar": POST_STUDIO_ASSETS,
  },
};

export default nextConfig;

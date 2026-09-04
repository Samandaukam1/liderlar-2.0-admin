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

/**
 * The self-hosted background-removal model (see models/README.md). It is read
 * through the same computed-path pattern as the fonts, so the tracer needs to
 * be told about it, and it lives outside public/ so Vercel does not also
 * publish 44 MB as a static asset.
 */
const SEGMENTATION_MODEL = [
  "models/silueta.onnx",
  /**
   * The ONNX Runtime binding dlopen's `libonnxruntime.so.1` at load time, and a
   * dynamic-linker dependency is invisible to the file tracer — it traces the
   * .node file and stops. Without this line the function deploys and then fails
   * at the first inference with a missing shared object. linux/x64 is what
   * Vercel runs; the other four builds are excluded below.
   */
  "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
];

/**
 * Route keys are matched as globs, so a literal `[postId]` in a key is read as
 * a character class and silently matches nothing — every key here is written
 * with `**` instead. (The Post Studio assets used to reach the studio page only
 * because the broader `/postlar` key happened to cover it.)
 *
 * These are the routes that actually run the model: the cron pipeline, and the
 * studio page, whose server actions ("Portretni qayta ishlash", "Saqlash va
 * render") prepare a portrait before rendering.
 */
const SEGMENTATION_ROUTES = [
  "/api/cron/post-pipeline",
  /**
   * The batch worker runs the very same pipeline, portrait stage included. It
   * was missing from this list once, and the symptom was not a build error: the
   * function deployed happily and every candidate it picked up failed at
   * "Portret fonini olib tashlash amalga oshmadi", while the identical work
   * done by the pipeline cron succeeded.
   */
  "/api/cron/intake-publish-batches",
  "/postlar/**",
];

/** Every route that pulls onnxruntime-node into its graph, model or not. */
const ONNX_ROUTES = [...SEGMENTATION_ROUTES, "/api/admin/post-studio/**"];

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Turbopack ignores parent lockfiles.
  turbopack: {
    root: __dirname,
  },
  // @resvg/resvg-js ships a native .node binding that cannot be placed in an
  // ESM chunk; it has to stay an external require at runtime. sharp is listed
  // for the same reason.
  // onnxruntime-node joins them: it loads a platform-specific .node binding
  // through its own runtime lookup, which a bundler cannot follow.
  serverExternalPackages: ["@resvg/resvg-js", "sharp", "onnxruntime-node"],
  outputFileTracingIncludes: {
    "/api/admin/candidates/**": ["public/assets/certificates/**/*"],
    "/api/admin/post-studio/**": POST_STUDIO_ASSETS,
    /**
     * Generated from SEGMENTATION_ROUTES rather than written out per route, so
     * adding a route to that list is all it takes to give it the model, the
     * fonts and the backgrounds. Hand-listing them is what let a new worker
     * ship without any of the three.
     */
    ...Object.fromEntries(
      SEGMENTATION_ROUTES.map((route) => [
        route,
        [...POST_STUDIO_ASSETS, ...SEGMENTATION_MODEL],
      ]),
    ),
  },
  /**
   * onnxruntime-node ships every platform's runtime in one package (283 MB).
   * Vercel runs linux/x64, so the other four builds are ~240 MB of dead weight
   * that would push these functions past the 250 MB limit on their own.
   */
  outputFileTracingExcludes: {
    /**
     * The certificate route traces the whole project (a dynamic font path in
     * src/lib/certificates/fonts.ts, see the build warning), so it would other-
     * wise carry a 44 MB segmentation model it can never use.
     */
    "/api/admin/candidates/**": ["models/**", "node_modules/onnxruntime-node/**"],
    ...Object.fromEntries(
      ONNX_ROUTES.map((route) => [
      route,
        [
          "node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
          "node_modules/onnxruntime-node/bin/napi-v6/win32/**",
          "node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**",
        ],
      ]),
    ),
  },
};

export default nextConfig;

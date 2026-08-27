/**
 * Minimal ESM resolve hook so dev scripts can import the app's extensionless
 * relative TypeScript imports (`./fonts`), which Next/Turbopack resolves for us
 * at build time but plain node does not.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !path.extname(specifier)) {
    const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`, `${specifier}/index.ts`]) {
      const abs = path.resolve(parent, candidate);
      if (existsSync(abs)) return next(pathToFileURL(abs).href, context);
    }
  }
  return next(specifier, context);
}

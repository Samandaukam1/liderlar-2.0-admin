import type { PostFontRole } from "./types.ts";

/**
 * Font family stacks, kept free of `server-only` so the SVG builder, the tests
 * and the browser preview can all reference the exact same list that resvg
 * rasterizes with.
 *
 * The quote and the name share Anton: the reference posters set both in the
 * same uppercase display face, and only the colour split tells them apart.
 *
 * Anton ships no Cyrillic and Oswald Bold lacks Ҳ/ҳ, so both chains end in
 * Montserrat — verified against each file's cmap, not assumed.
 */
export const POST_FONT_STACKS: Record<PostFontRole, string[]> = {
  name: ["Anton", "Oswald", "Montserrat SemiBold"],
  quote: ["Anton", "Oswald", "Montserrat SemiBold"],
  shortBio: ["Montserrat", "Oswald"],
  /** The signature is drawn from extracted outlines, not from a font. */
  signature: [],
};

/** `font-family` attribute value for a role, e.g. `Anton, Oswald, ...`. */
export function fontFamilyAttr(role: PostFontRole): string {
  return POST_FONT_STACKS[role].join(", ");
}

/** Web font-face URLs used by the in-browser preview canvas. */
export const POST_FONT_WEB_FACES: { family: string; url: string; weight: number }[] = [
  { family: "Anton", url: "/assets/post-studio/fonts/anton-regular.ttf", weight: 400 },
  { family: "Oswald", url: "/assets/post-studio/fonts/oswald-bold.ttf", weight: 700 },
  {
    family: "Montserrat SemiBold",
    url: "/assets/post-studio/fonts/montserrat-semibold.ttf",
    weight: 600,
  },
  { family: "Montserrat", url: "/assets/post-studio/fonts/montserrat-medium.ttf", weight: 500 },
];

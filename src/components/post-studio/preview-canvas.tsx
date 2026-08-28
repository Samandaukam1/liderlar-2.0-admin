"use client";

import { useEffect, useState } from "react";
import { buildOverlaySvgBody } from "@/lib/post-studio/svg";
import { POST_CANVAS_UNITS, type PostLayout } from "@/lib/post-studio/types";
import { POST_FONT_WEB_FACES } from "@/lib/post-studio/font-stacks";

/**
 * Live 1080x1080 preview.
 *
 * It draws from the PostLayout the server computed — the same object the final
 * raster is built from — so line breaks, font sizes and every x/baseline here
 * are the render's, not a second implementation's. Only the paint differs
 * (browser vs resvg), which is why the studio also offers a true render.
 */

const FONT_FACE_CSS = POST_FONT_WEB_FACES.map(
  (face) =>
    `@font-face{font-family:"${face.family}";src:url("${face.url}") format("truetype");` +
    `font-weight:${face.weight};font-display:block;}`,
).join("");

export function PostPreviewCanvas({
  layout,
  backgroundUrl,
  foregroundUrl,
  className,
}: {
  layout: PostLayout;
  backgroundUrl: string;
  /** Logo lock-up and band light, drawn over the portrait exactly as in render.ts. */
  foregroundUrl: string;
  className?: string;
}) {
  const [signature, setSignature] = useState<string | null>(null);

  // The signature is ~24KB of extracted outlines; fetching it once beats
  // shipping it inside every server-rendered payload.
  useEffect(() => {
    let cancelled = false;
    fetch("/assets/post-studio/signature.svg")
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => {
        if (!cancelled) setSignature(text);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const overlay = buildOverlaySvgBody(layout, {
    signatureMarkup: signature,
    foregroundHref: foregroundUrl,
  });

  return (
    <div className={className}>
      <style>{FONT_FACE_CSS}</style>
      <svg
        viewBox={`0 0 ${POST_CANVAS_UNITS} ${POST_CANVAS_UNITS}`}
        className="block h-auto w-full rounded-card border border-line shadow-sm"
        role="img"
        aria-label="Post ko‘rinishi"
      >
        <image
          href={backgroundUrl}
          x="0"
          y="0"
          width={POST_CANVAS_UNITS}
          height={POST_CANVAS_UNITS}
        />
        <g dangerouslySetInnerHTML={{ __html: overlay }} />
      </svg>
    </div>
  );
}

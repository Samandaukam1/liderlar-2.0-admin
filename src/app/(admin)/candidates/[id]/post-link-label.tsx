"use client";

import { useLinkStatus } from "next/link";
import { ImageIcon } from "lucide-react";

export function PostLinkLabel() {
  const { pending } = useLinkStatus();

  return (
    <span className="inline-flex items-center gap-2" role="status" aria-live="polite" aria-atomic="true">
      <ImageIcon className="h-4 w-4" aria-hidden="true" />
      {pending ? (
        <span>
          Post Studio ochilmoqda
          <span aria-hidden="true" className="inline-flex w-3 justify-start">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="motion-safe:animate-pulse motion-safe:[animation-duration:1s]"
                style={{ animationDelay: `${delay}ms` }}
              >
                .
              </span>
            ))}
          </span>
        </span>
      ) : "Postga o‘tish"}
    </span>
  );
}

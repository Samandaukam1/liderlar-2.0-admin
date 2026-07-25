"use client";

import { useState } from "react";
import { Textarea, FormField } from "@/components/ui/primitives";
import { AIImprovePanel } from "@/components/admin/ai-panel";

export function AIPlayground() {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState("");

  return (
    <div className="space-y-4">
      <FormField
        label="Sinov matni"
        htmlFor="ai-playground"
        hint="Nomzod yuborgan xom matnni shu yerga qo‘yib, Jaxongir AI qanday qayta yozishini sinab ko‘ring"
      >
        <Textarea
          id="ai-playground"
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (submitted && e.target.value !== submitted) setSubmitted("");
          }}
          placeholder="Masalan: Men bu oy 3 ta kitob o‘qidim va IT Park’dagi tadbirda spiker bo‘ldim…"
        />
      </FormField>
      {text.trim().length >= 20 && (
        <AIImprovePanel
          key={submitted || "draft"}
          original={text}
          entityType="playground"
          acceptLabel="Natijani nusxalash uchun tayyor"
          onAccept={async (improved) => {
            await navigator.clipboard.writeText(improved);
          }}
        />
      )}
    </div>
  );
}

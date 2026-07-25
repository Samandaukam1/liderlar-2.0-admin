"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button, FormField, Input, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { saveLegalPageAction } from "@/lib/actions/system";
import { cn, formatDate } from "@/lib/utils";

export interface LegalPage {
  slug: string;
  title: string;
  content: string;
  updated_at: string | null;
}

const SLUG_LABELS: Record<string, string> = {
  oferta: "Ommaviy oferta",
  privacy: "Maxfiylik siyosati",
  terms: "Foydalanish shartlari",
};

export function LegalEditor({ pages }: { pages: LegalPage[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [active, setActive] = useState(pages[0]?.slug ?? "oferta");
  const [drafts, setDrafts] = useState<Record<string, { title: string; content: string }>>(
    Object.fromEntries(pages.map((p) => [p.slug, { title: p.title, content: p.content }])),
  );
  const [pending, startTransition] = useTransition();

  const page = pages.find((p) => p.slug === active);
  const draft = drafts[active] ?? { title: SLUG_LABELS[active] ?? active, content: "" };

  return (
    <div>
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-[16px] border border-line bg-card p-1 shadow-card">
        {["oferta", "privacy", "terms"].map((slug) => (
          <button
            key={slug}
            onClick={() => setActive(slug)}
            className={cn(
              "whitespace-nowrap rounded-[12px] px-4 py-2 text-sm font-bold transition",
              active === slug
                ? "bg-gradient-to-r from-brand to-electric text-white"
                : "text-ink-soft hover:bg-surface hover:text-ink",
            )}
          >
            {SLUG_LABELS[slug]}
          </button>
        ))}
      </nav>

      <div className="rounded-card border border-line bg-card p-5 shadow-card">
        <div className="space-y-4">
          <FormField label="Sarlavha" htmlFor="legal-title">
            <Input
              id="legal-title"
              value={draft.title}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [active]: { ...draft, title: e.target.value } }))
              }
            />
          </FormField>
          <FormField
            label="Matn"
            htmlFor="legal-content"
            hint="Bo‘sh qator — yangi xatboshi; «## » — bo‘lim sarlavhasi"
          >
            <Textarea
              id="legal-content"
              rows={18}
              value={draft.content}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [active]: { ...draft, content: e.target.value } }))
              }
            />
          </FormField>
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-soft">
              Oxirgi yangilanish: {formatDate(page?.updated_at ?? null, true)}
            </p>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await saveLegalPageAction(active, draft.title, draft.content);
                  if (res.ok) {
                    toast("success", "Sahifa saqlandi");
                    router.refresh();
                  } else toast("error", "Xatolik", res.error);
                })
              }
            >
              <Save className="h-4 w-4" /> {pending ? "Saqlanmoqda…" : "Saqlash"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Save, Check, Loader2, ImagePlus, Shirt, Palette } from "lucide-react";
import { Button, Textarea, Card } from "@/components/ui/primitives";
import { Badge } from "@/components/admin/badges";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  GENDER_LABELS,
  CLOTHING_LABELS,
  COLOR_LABELS,
  type Gender,
  type ClothingType,
  type PhotoColor,
} from "@/lib/intake/constants";
import type { PromptFragment } from "@/lib/intake/photo-prompt";
import { updateFragmentAction, toggleFragmentActiveAction } from "@/lib/actions/ai-prompts";

function fragmentLabel(f: PromptFragment): string {
  if (f.label) return f.label;
  const g = f.gender ? GENDER_LABELS[f.gender as Gender] ?? f.gender : "";
  if (f.fragment_type === "base_scene") return `${g} — Asosiy fon`;
  if (f.fragment_type === "clothing") {
    const c = f.clothing_type ? CLOTHING_LABELS[f.clothing_type as ClothingType] ?? f.clothing_type : "";
    return `${g} — ${c}`;
  }
  return f.color ? COLOR_LABELS[f.color as PhotoColor] ?? f.color : "Rang";
}

function FragmentCard({ fragment, canEdit }: { fragment: PromptFragment; canEdit: boolean }) {
  const toast = useToast();
  const [text, setText] = useState(fragment.text);
  const [active, setActive] = useState(fragment.is_active);
  const [pending, startTransition] = useTransition();
  const dirty = text !== fragment.text;

  const save = () =>
    startTransition(async () => {
      const r = await updateFragmentAction(fragment.id, text);
      if (r.ok) toast.toast("success", "Saqlandi", fragmentLabel(fragment));
      else toast.toast("error", "Xatolik", r.error);
    });

  const toggle = () =>
    startTransition(async () => {
      const next = !active;
      const r = await toggleFragmentActiveAction(fragment.id, next);
      if (r.ok) {
        setActive(next);
        toast.toast("success", next ? "Faollashtirildi" : "Nofaol qilindi");
      } else toast.toast("error", "Xatolik", r.error);
    });

  return (
    <Card className={cn(!active && "opacity-70")}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-ink">{fragmentLabel(fragment)}</h3>
        <button
          type="button"
          onClick={toggle}
          disabled={!canEdit || pending}
          className="disabled:opacity-50"
          title={active ? "Faol" : "Nofaol"}
        >
          <Badge accent={active ? "mint" : "neutral"}>{active ? "Faol" : "Nofaol"}</Badge>
        </button>
      </div>
      <Textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!canEdit}
        className="text-xs"
        placeholder="Prompt matni…"
      />
      {canEdit && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : dirty ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {dirty ? "Saqlash" : "Saqlangan"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Section({ title, icon, fragments, canEdit }: { title: string; icon: React.ReactNode; fragments: PromptFragment[]; canEdit: boolean }) {
  if (fragments.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide text-ink">
        {icon} {title}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        {fragments.map((f) => (
          <FragmentCard key={f.id} fragment={f} canEdit={canEdit} />
        ))}
      </div>
    </section>
  );
}

export function AiPromptsEditor({ fragments, canEdit }: { fragments: PromptFragment[]; canEdit: boolean }) {
  const base = fragments.filter((f) => f.fragment_type === "base_scene");
  const clothing = fragments.filter((f) => f.fragment_type === "clothing");
  const color = fragments.filter((f) => f.fragment_type === "color");

  return (
    <div>
      {!canEdit && (
        <div className="mb-4 rounded-field border border-line bg-surface/60 p-3 text-sm text-ink-soft">
          Sizda faqat ko‘rish ruxsati bor. Tahrirlash uchun <b>ai_prompts.edit</b> ruxsati kerak.
        </div>
      )}
      <Section title="Asosiy fon" icon={<ImagePlus className="h-5 w-5 text-brand" />} fragments={base} canEdit={canEdit} />
      <Section title="Kiyim turlari" icon={<Shirt className="h-5 w-5 text-brand" />} fragments={clothing} canEdit={canEdit} />
      <Section title="Ranglar" icon={<Palette className="h-5 w-5 text-brand" />} fragments={color} canEdit={canEdit} />
      {fragments.length === 0 && (
        <div className="rounded-card border border-dashed border-line-strong bg-card p-10 text-center text-sm text-ink-soft">
          Promt fragmentlari topilmadi. 0011-migratsiya <b>photo_prompt_fragments</b> jadvalini va boshlang‘ich
          qiymatlarni qo‘shganini tekshiring.
        </div>
      )}
    </div>
  );
}

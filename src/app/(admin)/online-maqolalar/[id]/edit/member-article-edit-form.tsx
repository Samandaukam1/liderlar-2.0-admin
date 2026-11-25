"use client";

import Link from "next/link";
import Image from "next/image";
import { Save } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { Button, Card, FormField, Input, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { uploadToBucket } from "@/lib/upload-client";
import { validateUpload } from "@/lib/upload-rules";
import { updateMemberArticleAction } from "../../actions";

/** Maqolaning matni, sarlavhasi va bannerini tahrirlash formasi. */
export function MemberArticleEditForm({ article }: {
  article: {
    id: string; candidate_id: string; title: string; subtitle: string | null;
    excerpt: string | null; content: string; hero_url: string | null; state: string; updated_at: string;
  };
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** Banner tanlansa, uni bevosita Storage’ga yuklaydi va forma bilan faqat manzilini yuboradi. */
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const banner = form.get("banner");
    form.delete("banner");
    setError(null);
    startTransition(async () => {
      try {
        if (banner instanceof File && banner.size > 0) {
          const check = validateUpload("candidate-gallery", banner.type, banner.size);
          if ("error" in check) {
            setError(check.error);
            return;
          }
          const bitmap = await createImageBitmap(banner);
          const { width, height } = bitmap;
          bitmap.close();
          form.set("hero_url", await uploadToBucket(banner, "candidate-gallery", article.candidate_id));
          form.set("hero_width", String(width));
          form.set("hero_height", String(height));
        }
        const result = await updateMemberArticleAction(article.id, article.updated_at, form);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast("success", "Maqola saqlandi");
      } catch {
        setError("Maqolani saqlab bo‘lmadi. Qayta urinib ko‘ring.");
      }
    });
  }

  return (
    <Card>
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={pending} className="space-y-4">
          <FormField label="Banner rasmi" htmlFor="member-article-banner">
            {article.hero_url && /^https?:\/\//i.test(article.hero_url) && (
              <Image src={article.hero_url} alt="Joriy banner" width={320} height={180} unoptimized className="mb-2 aspect-video rounded-field object-cover" />
            )}
            <Input id="member-article-banner" name="banner" type="file" accept="image/jpeg,image/png,image/webp" />
            <p className="mt-1 text-xs text-ink-soft">JPG, PNG yoki WebP · 8 MB gacha</p>
          </FormField>
          <FormField label="Sarlavha" htmlFor="member-article-title">
            <Input id="member-article-title" name="title" defaultValue={article.title} minLength={5} maxLength={300} required />
          </FormField>
          <FormField label="Qo‘shimcha sarlavha" htmlFor="member-article-subtitle">
            <Input id="member-article-subtitle" name="subtitle" defaultValue={article.subtitle ?? ""} maxLength={500} />
          </FormField>
          <FormField label="Qisqacha mazmun" htmlFor="member-article-excerpt">
            <Textarea id="member-article-excerpt" name="excerpt" defaultValue={article.excerpt ?? ""} maxLength={600} rows={3} />
          </FormField>
          <FormField label="Maqola matni" htmlFor="member-article-content">
            <Textarea id="member-article-content" name="content" defaultValue={article.content} maxLength={200_000} rows={16} />
          </FormField>
        </fieldset>
        {article.state === "published" && <p className="text-sm text-ink-soft">Saqlangan o‘zgarishlar saytdagi nashrda ham ko‘rinadi.</p>}
        {error && <p role="alert" className="text-sm text-coral">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <Link href={`/candidates/${article.candidate_id}?tab=articles`} className="text-sm font-semibold text-brand hover:underline">
            Nomzod maqolalariga qaytish
          </Link>
          <Button type="submit" disabled={pending}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {pending ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

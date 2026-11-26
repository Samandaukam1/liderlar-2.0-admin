"use client";

import Link from "next/link";
import Image from "next/image";
import { ImageIcon, Save, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
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
  const bannerInput = useRef<HTMLInputElement>(null);
  const [selectedBanner, setSelectedBanner] = useState<{ url: string; name: string } | null>(null);
  const previewUrl = selectedBanner?.url ?? (article.hero_url && /^https?:\/\//i.test(article.hero_url) ? article.hero_url : null);

  useEffect(() => {
    return () => {
      if (selectedBanner) URL.revokeObjectURL(selectedBanner.url);
    };
  }, [selectedBanner]);

  function selectBanner(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      setSelectedBanner(null);
      return;
    }
    const check = validateUpload("candidate-gallery", file.type, file.size);
    if ("error" in check) {
      event.currentTarget.value = "";
      setSelectedBanner(null);
      setError(check.error);
      return;
    }
    setError(null);
    setSelectedBanner({ url: URL.createObjectURL(file), name: file.name });
  }

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
            <div className="mb-3 flex aspect-video w-full max-w-md items-center justify-center overflow-hidden rounded-field border border-line bg-surface">
              {previewUrl ? (
                <Image src={previewUrl} alt="Banner rasmi preview" width={640} height={360} unoptimized className="h-full w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-ink-soft">
                  <ImageIcon className="h-8 w-8" aria-hidden="true" />
                  <span className="text-xs">Banner rasmini tanlang</span>
                </div>
              )}
            </div>
            <input ref={bannerInput} id="member-article-banner" name="banner" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectBanner} className="sr-only" tabIndex={-1} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => bannerInput.current?.click()}>
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
                {previewUrl ? "Rasmni almashtirish" : "Rasm yuklash"}
              </Button>
              {selectedBanner && <span className="max-w-full truncate text-xs text-ink-soft" role="status">{selectedBanner.name}</span>}
            </div>
            <p className="mt-2 text-xs text-ink-soft">JPG, PNG yoki WebP · 8 MB gacha</p>
            {selectedBanner && <p className="mt-1 text-xs text-brand">Yangi banner tanlandi. Saqlash bosilganda yuklanadi.</p>}
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

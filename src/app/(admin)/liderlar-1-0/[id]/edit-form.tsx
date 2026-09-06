"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { Button, FormField, Input, Select, Textarea } from "@/components/ui/primitives";
import { updateLegacyPostAction } from "@/lib/actions/legacy-posts";

export interface LegacyEditable {
  id: string;
  title: string;
  summary: string | null;
  legacy_status: string;
  cover_image_url: string | null;
  content_html: string;
  candidate_id: string | null;
}

/**
 * Arxiv yozuvining tahrirlanadigan qismi.
 *
 * Identifikatorlar (Post ID, slug, eski yo'l) va manbadagi sana bu formada
 * ATAYLAB yo'q — ular sahifaning yuqori qismida faqat o'qish uchun ko'rsatiladi.
 * Sabab server action izohida.
 */
export function LegacyEditForm({ post }: { post: LegacyEditable }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const onSubmit = (formData: FormData) => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateLegacyPostAction(post.id, formData);
      setMessage(
        result.ok
          ? { ok: true, text: "Saqlandi." }
          : { ok: false, text: result.error ?? "Saqlab bo‘lmadi" },
      );
    });
  };

  return (
    <form action={onSubmit} className="space-y-4">
      <FormField label="F.I.Sh." htmlFor="legacy-title">
        <Input id="legacy-title" name="title" defaultValue={post.title} maxLength={300} />
      </FormField>

      <FormField label="Qisqa tavsif" htmlFor="legacy-summary">
        <Textarea
          id="legacy-summary"
          name="summary"
          rows={3}
          defaultValue={post.summary ?? ""}
          maxLength={1000}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Status" htmlFor="legacy-status">
          <Select id="legacy-status" name="legacy_status" defaultValue={post.legacy_status}>
            <option value="published">Chop etilgan</option>
            <option value="draft">Qoralama</option>
          </Select>
        </FormField>

        <FormField
          label="Rasm manzili"
          htmlFor="legacy-cover"
          hint="Eski sayt CDN havolasi yoki yangi to‘liq URL"
        >
          <Input
            id="legacy-cover"
            name="cover_image_url"
            defaultValue={post.cover_image_url ?? ""}
            placeholder="https://…"
          />
        </FormField>
      </div>

      <FormField
        label="Maqola matni (HTML)"
        htmlFor="legacy-content"
        hint="Saqlashda oq ro‘yxatdan qayta o‘tkaziladi: script, iframe, style va class saqlanmaydi."
      >
        <Textarea
          id="legacy-content"
          name="content_html"
          rows={14}
          defaultValue={post.content_html}
          className="font-mono text-xs"
        />
      </FormField>

      <FormField
        label="2.0 nomzodiga ulash"
        htmlFor="legacy-candidate"
        hint="Nomzod ID (ixtiyoriy). Ulangan bo‘lsa, arxiv sahifasida yangi profilga havola chiqadi."
      >
        <Input
          id="legacy-candidate"
          name="candidate_id"
          defaultValue={post.candidate_id ?? ""}
          placeholder="uuid"
        />
      </FormField>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Saqlash
        </Button>
        {message && (
          <span className={message.ok ? "text-sm text-green" : "text-sm font-semibold text-coral"}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}

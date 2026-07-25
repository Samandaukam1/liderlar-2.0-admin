"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, UploadCloud } from "lucide-react";
import { Button, FormField, Input, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { upsertCandidateAction } from "@/lib/actions/candidates";
import { slugify } from "@/lib/utils";
import { Avatar } from "@/components/admin/badges";
import type { Candidate, Category, Region } from "@/lib/types";

const schema = z.object({
  full_name: z.string().min(3, "Ism juda qisqa"),
  slug: z.string().optional(),
  short_bio: z.string().max(600, "Maksimum 600 belgi").optional(),
  birth_date: z.string().optional(),
  region_id: z.string().optional(),
  category_id: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Email noto‘g‘ri").optional().or(z.literal("")),
  avatar_url: z.string().optional(),
  seo_title: z.string().max(160).optional(),
  seo_description: z.string().max(300).optional(),
  is_top100: z.boolean().optional(),
  top100_position: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function CandidateForm({
  candidate,
  regions,
  categories,
}: {
  candidate: Candidate | null;
  regions: Array<Pick<Region, "id" | "name">>;
  categories: Array<Pick<Category, "id" | "name">>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: candidate?.full_name ?? "",
      slug: candidate?.slug ?? "",
      short_bio: candidate?.short_bio ?? "",
      birth_date: candidate?.birth_date ?? "",
      region_id: candidate?.region_id ?? "",
      category_id: candidate?.category_id ?? "",
      phone: candidate?.phone ?? "",
      email: candidate?.email ?? "",
      avatar_url: candidate?.avatar_url ?? "",
      seo_title: candidate?.seo_title ?? "",
      seo_description: candidate?.seo_description ?? "",
      is_top100: candidate?.is_top100 ?? false,
      top100_position: candidate?.top100_position?.toString() ?? "",
    },
  });

  const avatarUrl = watch("avatar_url");
  const fullName = watch("full_name");

  async function handleAvatarUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("bucket", "candidate-avatars");
      if (candidate?.id) fd.set("candidate_id", candidate.id);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "Yuklab bo‘lmadi");
      setValue("avatar_url", json.url, { shouldDirty: true });
      toast("success", "Surat yuklandi");
    } catch (e) {
      toast("error", "Surat yuklanmadi", e instanceof Error ? e.message : undefined);
    } finally {
      setUploading(false);
    }
  }

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(values)) {
        if (v !== undefined && v !== null) fd.set(k, String(v));
      }
      if (!values.slug) fd.set("slug", slugify(values.full_name));
      const result = await upsertCandidateAction(candidate?.id ?? null, fd);
      if (result.ok) {
        toast("success", candidate ? "Nomzod saqlandi" : "Nomzod yaratildi");
        if (!candidate && result.id) router.push(`/candidates/${result.id}`);
        else router.refresh();
      } else {
        toast("error", "Saqlab bo‘lmadi", result.error);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Avatar + identity */}
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex flex-col items-center gap-2">
          <Avatar name={fullName || "?"} src={avatarUrl || null} size={88} />
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[12px] border border-line px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand">
            <UploadCloud className="h-3.5 w-3.5" />
            {uploading ? "Yuklanmoqda…" : "Surat yuklash"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleAvatarUpload(f);
              }}
            />
          </label>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="To‘liq ism" htmlFor="full_name" error={errors.full_name?.message}>
            <Input id="full_name" {...register("full_name")} placeholder="Aziza Karimova" />
          </FormField>
          <FormField
            label="Slug"
            htmlFor="slug"
            error={errors.slug?.message}
            hint={`liderlar.uz/lider/${watch("slug") || slugify(fullName || "")}`}
          >
            <Input id="slug" {...register("slug")} placeholder="avto: ismdan" />
          </FormField>
          <FormField label="Yo‘nalish" htmlFor="category_id">
            <Select id="category_id" {...register("category_id")}>
              <option value="">Tanlang…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Hudud" htmlFor="region_id">
            <Select id="region_id" {...register("region_id")}>
              <option value="">Tanlang…</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </div>

      <FormField label="Qisqacha tavsif" htmlFor="short_bio" error={errors.short_bio?.message}>
        <Textarea id="short_bio" rows={3} {...register("short_bio")} placeholder="Nomzod haqida 1–2 jumla…" />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="Tug‘ilgan sana" htmlFor="birth_date">
          <Input id="birth_date" type="date" {...register("birth_date")} />
        </FormField>
        <FormField label="Telefon" htmlFor="phone">
          <Input id="phone" {...register("phone")} placeholder="+998 90 123 45 67" />
        </FormField>
        <FormField label="Email" htmlFor="c_email" error={errors.email?.message}>
          <Input id="c_email" type="email" {...register("email")} placeholder="lider@example.uz" />
        </FormField>
      </div>

      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
          SEO
        </legend>
        <div className="grid grid-cols-1 gap-4">
          <FormField label="SEO sarlavha" htmlFor="seo_title" error={errors.seo_title?.message}>
            <Input id="seo_title" {...register("seo_title")} />
          </FormField>
          <FormField label="SEO tavsif" htmlFor="seo_description" error={errors.seo_description?.message}>
            <Textarea id="seo_description" rows={2} {...register("seo_description")} />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
          TOP 100
        </legend>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              {...register("is_top100")}
              className="h-4 w-4 rounded accent-[#087ea4]"
            />
            TOP 100 ro‘yxatida
          </label>
          <FormField label="Pozitsiya" htmlFor="top100_position" className="w-32">
            <Input
              id="top100_position"
              type="number"
              min={1}
              max={100}
              {...register("top100_position")}
            />
          </FormField>
        </div>
      </fieldset>

      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-card border border-line bg-card/90 p-3 shadow-card backdrop-blur">
        <p className="text-xs text-ink-soft">
          {isDirty ? "Saqlanmagan o‘zgarishlar bor" : "Barcha o‘zgarishlar saqlangan"}
        </p>
        <Button type="submit" disabled={pending}>
          <Save className="h-4 w-4" />
          {pending ? "Saqlanmoqda…" : candidate ? "Saqlash" : "Yaratish"}
        </Button>
      </div>
    </form>
  );
}

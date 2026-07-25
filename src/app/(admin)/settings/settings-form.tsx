"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button, FormField, Input, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { saveSiteSettingsAction } from "@/lib/actions/system";

const FIELD_GROUPS: Array<{
  title: string;
  fields: Array<{ key: string; label: string; textarea?: boolean; placeholder?: string }>;
}> = [
  {
    title: "Sayt ma’lumotlari",
    fields: [
      { key: "site_title", label: "Sayt sarlavhasi", placeholder: "Liderlar.uz" },
      { key: "site_description", label: "Sayt tavsifi", textarea: true },
      { key: "hero_title", label: "Bosh sahifa sarlavhasi" },
      { key: "hero_subtitle", label: "Bosh sahifa subtitri", textarea: true },
      { key: "footer_text", label: "Footer matni", textarea: true },
    ],
  },
  {
    title: "Aloqa",
    fields: [
      { key: "contact_email", label: "Email", placeholder: "info@liderlar.uz" },
      { key: "contact_phone", label: "Telefon" },
      { key: "telegram_url", label: "Telegram" },
      { key: "instagram_url", label: "Instagram" },
      { key: "youtube_url", label: "YouTube" },
      { key: "facebook_url", label: "Facebook" },
    ],
  },
  {
    title: "Funksiyalar",
    fields: [{ key: "application_form_enabled", label: "Ariza formasi (true/false)" }],
  },
];

export function SettingsForm({ values }: { values: Record<string, string> }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await saveSiteSettingsAction(fd);
          if (res.ok) {
            toast("success", "Sozlamalar saqlandi");
            router.refresh();
          } else toast("error", "Xatolik", res.error);
        })
      }
      className="space-y-6"
    >
      {FIELD_GROUPS.map((group) => (
        <fieldset key={group.title} className="rounded-card border border-line bg-card p-5 shadow-card">
          <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
            {group.title}
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {group.fields.map((f) => (
              <div key={f.key} className={f.textarea ? "sm:col-span-2" : undefined}>
                <FormField label={f.label} htmlFor={`s-${f.key}`}>
                  {f.textarea ? (
                    <Textarea id={`s-${f.key}`} name={f.key} rows={2} defaultValue={values[f.key] ?? ""} />
                  ) : (
                    <Input id={`s-${f.key}`} name={f.key} defaultValue={values[f.key] ?? ""} placeholder={f.placeholder} />
                  )}
                </FormField>
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save className="h-4 w-4" /> {pending ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      </div>
    </form>
  );
}

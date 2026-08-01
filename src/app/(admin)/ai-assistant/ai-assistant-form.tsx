"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, UploadCloud } from "lucide-react";
import { Button, FormField, Input, Textarea, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { saveAiAssistantSettingsAction } from "@/lib/actions/ai-assistant";

export interface AiAssistantSettingsRow {
  assistant_name: string;
  greeting: string;
  quick_questions: string[];
  avatar_kind: "image" | "video";
  avatar_image_url: string | null;
  avatar_video_url: string | null;
  size_px: number;
  floating_height_px: number;
  particle_count: number;
  animation_speed: number;
  glow_enabled: boolean;
  particle_enabled: boolean;
  pulse_enabled: boolean;
  bloom_enabled: boolean;
  blur_shadow_enabled: boolean;
  halo_enabled: boolean;
  voice_enabled: boolean;
  glow_color: string;
  border_color: string;
  background_color: string | null;
  opening_animation: "portal" | "fade" | "scale";
  closing_animation: "teleport" | "fade" | "scale";
}

const DEFAULTS: AiAssistantSettingsRow = {
  assistant_name: "Jaxongir AI",
  greeting: "Salom! Men Jaxongir AI — Liderlar.uz bo'yicha savollaringizga yordam beraman.",
  quick_questions: [
    "Reyting qanday hisoblanadi?",
    "IT yo'nalishidagi liderlarni ko'rsat",
    "Ariza qanday topshiraman?",
  ],
  avatar_kind: "video",
  avatar_image_url: null,
  avatar_video_url: null,
  size_px: 56,
  floating_height_px: 24,
  particle_count: 18,
  animation_speed: 1,
  glow_enabled: true,
  particle_enabled: true,
  pulse_enabled: true,
  bloom_enabled: true,
  blur_shadow_enabled: true,
  halo_enabled: true,
  voice_enabled: false,
  glow_color: "#13BCE4",
  border_color: "#13BCE4",
  background_color: null,
  opening_animation: "portal",
  closing_animation: "teleport",
};

function UploadField({
  name,
  initial,
  accept,
  kind,
}: {
  name: string;
  initial: string;
  accept: string;
  kind: "image" | "video";
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState(initial);
  const [uploading, setUploading] = useState(false);

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={url} />
      {url && kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-24 w-24 rounded-full border border-line object-cover" />
      )}
      {url && kind === "video" && (
        <video src={url} className="h-24 w-24 rounded-full border border-line object-cover" muted loop autoPlay playsInline />
      )}
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[12px] border border-line px-3 py-2 text-xs font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand">
        <UploadCloud className="h-3.5 w-3.5" />
        {uploading ? "Yuklanmoqda…" : url ? "Almashtirish" : "Fayl yuklash"}
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUploading(true);
            try {
              const fd = new FormData();
              fd.set("file", f);
              fd.set("bucket", "ai-assistant");
              const res = await fetch("/api/upload", { method: "POST", body: fd });
              const json = (await res.json()) as { url?: string; error?: string };
              if (!res.ok || !json.url) throw new Error(json.error ?? "Xatolik");
              setUrl(json.url);
              toast("success", "Fayl yuklandi");
            } catch (err) {
              toast("error", "Yuklab bo'lmadi", err instanceof Error ? err.message : undefined);
            } finally {
              setUploading(false);
            }
          }}
        />
      </label>
    </div>
  );
}

const TOGGLES: Array<{ key: keyof AiAssistantSettingsRow; label: string; hint?: string }> = [
  { key: "glow_enabled", label: "Glow", hint: "Atrofidagi yorug'lik effekti" },
  { key: "particle_enabled", label: "Particle", hint: "Suzuvchi zarrachalar" },
  { key: "pulse_enabled", label: "Pulse", hint: "Nafas olayotgandek pulsatsiya" },
  { key: "bloom_enabled", label: "Bloom", hint: "Yorug'lik tarqalishi" },
  { key: "blur_shadow_enabled", label: "Blur shadow", hint: "Xira soya" },
  { key: "halo_enabled", label: "Halo", hint: "Aylana nur" },
  { key: "voice_enabled", label: "Voice", hint: "Ovozli javob va ovozli kiritish" },
];

export function AiAssistantForm({ settings }: { settings: AiAssistantSettingsRow | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const v = { ...DEFAULTS, ...(settings ?? {}) };

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await saveAiAssistantSettingsAction(fd);
          if (res.ok) {
            toast("success", "AI Assistant sozlamalari saqlandi");
            router.refresh();
          } else toast("error", "Xatolik", res.error);
        })
      }
      className="space-y-6"
    >
      <fieldset className="rounded-card border border-line bg-card p-5 shadow-card">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">Avatar</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Avatar turi" htmlFor="avatar_kind">
            <Select id="avatar_kind" name="avatar_kind" defaultValue={v.avatar_kind}>
              <option value="video">Video (GIF/MP4/WEBM)</option>
              <option value="image">Rasm (PNG/SVG/WEBP)</option>
            </Select>
          </FormField>
          <div />
          <FormField label="Avatar rasm (PNG, SVG, WEBP, GIF)">
            <UploadField
              name="avatar_image_url"
              initial={v.avatar_image_url ?? ""}
              accept="image/png,image/svg+xml,image/webp,image/gif,image/jpeg"
              kind="image"
            />
          </FormField>
          <FormField label="Avatar video (MP4, WEBM)">
            <UploadField
              name="avatar_video_url"
              initial={v.avatar_video_url ?? ""}
              accept="video/mp4,video/webm"
              kind="video"
            />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-line bg-card p-5 shadow-card">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
          Yordamchi va suhbat
        </legend>
        <div className="grid grid-cols-1 gap-4">
          <FormField label="Yordamchi nomi" htmlFor="assistant_name">
            <Input id="assistant_name" name="assistant_name" defaultValue={v.assistant_name} maxLength={60} required />
          </FormField>
          <FormField label="Salomlashuv matni" htmlFor="greeting" hint="Suhbat oynasi ochilganda ko'rinadi">
            <Textarea id="greeting" name="greeting" rows={2} defaultValue={v.greeting} maxLength={500} />
          </FormField>
          <FormField
            label="Tezkor savollar"
            htmlFor="quick_questions"
            hint="Har bir qatorda bitta savol, maksimum 8 ta"
          >
            <Textarea
              id="quick_questions"
              name="quick_questions"
              rows={4}
              defaultValue={v.quick_questions.join("\n")}
            />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-line bg-card p-5 shadow-card">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
          O&apos;lcham va tezlik
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="O'lcham (px)" htmlFor="size_px">
            <Input id="size_px" name="size_px" type="number" min={32} max={160} defaultValue={v.size_px} />
          </FormField>
          <FormField label="Pastdan masofa (px)" htmlFor="floating_height_px">
            <Input
              id="floating_height_px"
              name="floating_height_px"
              type="number"
              min={0}
              max={200}
              defaultValue={v.floating_height_px}
            />
          </FormField>
          <FormField label="Particle soni" htmlFor="particle_count">
            <Input
              id="particle_count"
              name="particle_count"
              type="number"
              min={0}
              max={80}
              defaultValue={v.particle_count}
            />
          </FormField>
          <FormField label="Animatsiya tezligi" htmlFor="animation_speed" hint="0.25 – 3.0">
            <Input
              id="animation_speed"
              name="animation_speed"
              type="number"
              step={0.05}
              min={0.25}
              max={3}
              defaultValue={v.animation_speed}
            />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-line bg-card p-5 shadow-card">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
          Effektlar
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TOGGLES.map((t) => (
            <label
              key={t.key}
              className="flex items-start gap-3 rounded-[12px] border border-line px-3.5 py-3 text-sm transition hover:border-brand/40"
            >
              <input
                type="checkbox"
                name={t.key}
                defaultChecked={Boolean(v[t.key])}
                className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand/30"
              />
              <span>
                <span className="block font-semibold text-ink">{t.label}</span>
                {t.hint && <span className="block text-xs text-ink-soft">{t.hint}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-line bg-card p-5 shadow-card">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
          Ranglar va animatsiya turi
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Glow rangi" htmlFor="glow_color">
            <Input id="glow_color" name="glow_color" type="color" defaultValue={v.glow_color} className="h-10 p-1" />
          </FormField>
          <FormField label="Border rangi" htmlFor="border_color">
            <Input id="border_color" name="border_color" type="color" defaultValue={v.border_color} className="h-10 p-1" />
          </FormField>
          <FormField label="Fon rangi (ixtiyoriy)" htmlFor="background_color">
            <Input
              id="background_color"
              name="background_color"
              type="color"
              defaultValue={v.background_color ?? "#0b3555"}
              className="h-10 p-1"
            />
          </FormField>
          <FormField label="Ochilish animatsiyasi" htmlFor="opening_animation">
            <Select id="opening_animation" name="opening_animation" defaultValue={v.opening_animation}>
              <option value="portal">Portal</option>
              <option value="fade">Fade</option>
              <option value="scale">Scale</option>
            </Select>
          </FormField>
          <FormField label="Yopilish animatsiyasi" htmlFor="closing_animation">
            <Select id="closing_animation" name="closing_animation" defaultValue={v.closing_animation}>
              <option value="teleport">Teleport</option>
              <option value="fade">Fade</option>
              <option value="scale">Scale</option>
            </Select>
          </FormField>
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save className="h-4 w-4" /> {pending ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      </div>
    </form>
  );
}

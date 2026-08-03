"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, UploadCloud, Trash2 } from "lucide-react";
import { Button, FormField, Input, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { uploadToBucket } from "@/lib/upload-client";
import { saveCornerVideoSettingsAction } from "@/lib/actions/corner-video";

export interface CornerVideoSettingsRow {
  enabled: boolean;
  video_url: string | null;
  poster_url: string | null;
  corner: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  aspect_ratio: "9:16" | "4:5" | "1:1" | "16:9";
  width_px: number;
  offset_x_px: number;
  offset_y_px: number;
  rounded_px: number;
  loop_enabled: boolean;
  show_close_button: boolean;
  button_enabled: boolean;
  button_label: string;
  button_url: string | null;
  button_animation: "pulse" | "bounce" | "glow" | "shine" | "none";
  button_color: string;
  button_text_color: string;
}

const DEFAULTS: CornerVideoSettingsRow = {
  enabled: false,
  video_url: null,
  poster_url: null,
  corner: "bottom-left",
  aspect_ratio: "9:16",
  width_px: 150,
  offset_x_px: 16,
  offset_y_px: 16,
  rounded_px: 18,
  loop_enabled: true,
  show_close_button: true,
  button_enabled: true,
  button_label: "Batafsil",
  button_url: null,
  button_animation: "pulse",
  button_color: "#13BCE4",
  button_text_color: "#FFFFFF",
};

const CORNERS: Array<{ value: CornerVideoSettingsRow["corner"]; label: string; cell: string }> = [
  { value: "top-left", label: "Yuqori chap", cell: "items-start justify-start" },
  { value: "top-right", label: "Yuqori o'ng", cell: "items-start justify-end" },
  { value: "bottom-left", label: "Pastki chap", cell: "items-end justify-start" },
  { value: "bottom-right", label: "Pastki o'ng", cell: "items-end justify-end" },
];

function UploadField({
  name,
  initial,
  accept,
  kind,
  bucket = "corner-video",
}: {
  name: string;
  initial: string;
  accept: string;
  kind: "image" | "video";
  bucket?: string;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState(initial);
  const [uploading, setUploading] = useState(false);

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={url} />
      {url && kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-28 w-20 rounded-[12px] border border-line object-cover" />
      )}
      {url && kind === "video" && (
        <video
          src={url}
          className="h-28 w-20 rounded-[12px] border border-line object-cover"
          muted
          loop
          autoPlay
          playsInline
        />
      )}
      <div className="flex items-center gap-2">
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
                setUrl(await uploadToBucket(f, bucket));
                toast("success", "Fayl yuklandi");
              } catch (err) {
                toast("error", "Yuklab bo'lmadi", err instanceof Error ? err.message : undefined);
              } finally {
                setUploading(false);
                e.target.value = "";
              }
            }}
          />
        </label>
        {url && (
          <button
            type="button"
            onClick={() => setUrl("")}
            className="inline-flex items-center gap-1.5 rounded-[12px] border border-line px-3 py-2 text-xs font-bold text-ink-soft transition hover:border-coral/60 hover:text-coral"
          >
            <Trash2 className="h-3.5 w-3.5" /> O&apos;chirish
          </button>
        )}
      </div>
    </div>
  );
}

export function CornerVideoForm({ settings }: { settings: CornerVideoSettingsRow | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const v = { ...DEFAULTS, ...(settings ?? {}) };
  const [corner, setCorner] = useState(v.corner);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await saveCornerVideoSettingsAction(fd);
          if (res.ok) {
            toast("success", "Burchak video sozlamalari saqlandi");
            router.refresh();
          } else toast("error", "Xatolik", res.error);
        })
      }
      className="space-y-6"
    >
      <fieldset className="rounded-card border border-line bg-card p-5 shadow-card">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
          Holati
        </legend>
        <label className="flex items-start gap-3 rounded-[12px] border border-line px-3.5 py-3 text-sm transition hover:border-brand/40">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={v.enabled}
            className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand/30"
          />
          <span>
            <span className="block font-semibold text-ink">Widget yoqilgan</span>
            <span className="block text-xs text-ink-soft">
              Yoqilganda video sayt bo&apos;ylab barcha sahifalarda, shu jumladan nomzodlarni
              o&apos;qish sahifalarida ham ko&apos;rinadi
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="rounded-card border border-line bg-card p-5 shadow-card">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
          Video
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Video fayl (MP4, WEBM)" hint="Maksimum 40 MB. Ovozsiz avtomatik ijro etiladi">
            <UploadField
              name="video_url"
              initial={v.video_url ?? ""}
              accept="video/mp4,video/webm"
              kind="video"
            />
          </FormField>
          <FormField label="Poster rasm (ixtiyoriy)" hint="Video yuklangunicha ko'rinadigan rasm">
            <UploadField
              name="poster_url"
              initial={v.poster_url ?? ""}
              accept="image/jpeg,image/png,image/webp"
              kind="image"
            />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-line bg-card p-5 shadow-card">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
          Joylashuvi
        </legend>
        <input type="hidden" name="corner" value={corner} />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,220px)_1fr]">
          <div>
            <span className="mb-2 block text-xs font-semibold text-ink-soft">Burchak</span>
            <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-1.5 rounded-[14px] border border-line bg-surface p-1.5">
              {CORNERS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCorner(c.value)}
                  aria-pressed={corner === c.value}
                  title={c.label}
                  className={`flex rounded-[10px] border p-1.5 transition ${c.cell} ${
                    corner === c.value
                      ? "border-brand bg-brand/10"
                      : "border-transparent hover:border-brand/30"
                  }`}
                >
                  <span
                    className={`h-5 w-4 rounded-[4px] transition ${
                      corner === c.value ? "bg-brand" : "bg-line"
                    }`}
                  />
                </button>
              ))}
            </div>
            <span className="mt-2 block text-xs text-ink-soft">
              Tanlangan: <strong className="text-ink">{CORNERS.find((c) => c.value === corner)?.label}</strong>
            </span>
            <span className="mt-1 block text-[11px] text-ink-soft">
              Eslatma: Jaxongir AI widgeti pastki o&apos;ng burchakda turadi — ustma-ust tushmasligi
              uchun boshqa burchakni tanlash tavsiya etiladi.
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Video nisbati" htmlFor="aspect_ratio">
              <Select id="aspect_ratio" name="aspect_ratio" defaultValue={v.aspect_ratio}>
                <option value="9:16">9:16 — vertikal (Reels/Shorts)</option>
                <option value="4:5">4:5 — portret</option>
                <option value="1:1">1:1 — kvadrat</option>
                <option value="16:9">16:9 — gorizontal</option>
              </Select>
            </FormField>
            <FormField label="Kenglik (px)" htmlFor="width_px" hint="90 – 420. Telefonda avtomatik kichrayadi">
              <Input id="width_px" name="width_px" type="number" min={90} max={420} defaultValue={v.width_px} />
            </FormField>
            <FormField label="Yon chetdan masofa (px)" htmlFor="offset_x_px" hint="0 – 200">
              <Input id="offset_x_px" name="offset_x_px" type="number" min={0} max={200} defaultValue={v.offset_x_px} />
            </FormField>
            <FormField label="Yuqori/past masofa (px)" htmlFor="offset_y_px" hint="0 – 200">
              <Input id="offset_y_px" name="offset_y_px" type="number" min={0} max={200} defaultValue={v.offset_y_px} />
            </FormField>
            <FormField label="Burchak yumaloqligi (px)" htmlFor="rounded_px" hint="0 – 40">
              <Input id="rounded_px" name="rounded_px" type="number" min={0} max={40} defaultValue={v.rounded_px} />
            </FormField>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-[12px] border border-line px-3.5 py-3 text-sm transition hover:border-brand/40">
            <input
              type="checkbox"
              name="loop_enabled"
              defaultChecked={v.loop_enabled}
              className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand/30"
            />
            <span>
              <span className="block font-semibold text-ink">Takrorlash</span>
              <span className="block text-xs text-ink-soft">Video tugagach qaytadan boshlanadi</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-[12px] border border-line px-3.5 py-3 text-sm transition hover:border-brand/40">
            <input
              type="checkbox"
              name="show_close_button"
              defaultChecked={v.show_close_button}
              className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand/30"
            />
            <span>
              <span className="block font-semibold text-ink">Yopish tugmasi</span>
              <span className="block text-xs text-ink-soft">
                Foydalanuvchi videoni sessiya davomida yashira oladi
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-line bg-card p-5 shadow-card">
        <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
          Animatsiyali tugma
        </legend>
        <label className="mb-4 flex items-start gap-3 rounded-[12px] border border-line px-3.5 py-3 text-sm transition hover:border-brand/40">
          <input
            type="checkbox"
            name="button_enabled"
            defaultChecked={v.button_enabled}
            className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand/30"
          />
          <span>
            <span className="block font-semibold text-ink">Tugma ko&apos;rsatilsin</span>
            <span className="block text-xs text-ink-soft">Video ostida chiqadi</span>
          </span>
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Tugma matni" htmlFor="button_label" hint="Maksimum 40 belgi">
            <Input id="button_label" name="button_label" maxLength={40} defaultValue={v.button_label} />
          </FormField>
          <FormField
            label="Tugma havolasi"
            htmlFor="button_url"
            hint="https://… yoki sayt ichidagi manzil: /liderlar"
          >
            <Input
              id="button_url"
              name="button_url"
              placeholder="https://t.me/liderlar_uz"
              defaultValue={v.button_url ?? ""}
            />
          </FormField>
          <FormField label="Tugma animatsiyasi" htmlFor="button_animation">
            <Select id="button_animation" name="button_animation" defaultValue={v.button_animation}>
              <option value="pulse">Pulse — pulsatsiyalanuvchi halqa</option>
              <option value="bounce">Bounce — sakrash</option>
              <option value="glow">Glow — yorug&apos;lik</option>
              <option value="shine">Shine — yaltirash</option>
              <option value="none">Animatsiyasiz</option>
            </Select>
          </FormField>
          <div />
          <FormField label="Tugma fon rangi" htmlFor="button_color">
            <Input id="button_color" name="button_color" type="color" defaultValue={v.button_color} className="h-10 p-1" />
          </FormField>
          <FormField label="Tugma matn rangi" htmlFor="button_text_color">
            <Input
              id="button_text_color"
              name="button_text_color"
              type="color"
              defaultValue={v.button_text_color}
              className="h-10 p-1"
            />
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

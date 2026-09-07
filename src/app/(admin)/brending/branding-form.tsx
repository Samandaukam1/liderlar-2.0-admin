"use client";

import { useRef, useState } from "react";
import { RotateCcw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  BRANDING_ICON_SIZES,
  BRANDING_MAX_BYTES,
  BRANDING_MIME_TYPES,
  validateBrandingUpload,
  versioned,
  type BrandingAssets,
} from "@/lib/branding/config";

/**
 * Logotip yuklash va standart belgiga qaytarish.
 *
 * Yuklash `fetch` orqali route handler'ga ketadi, server action'ga emas:
 * server action'ning body chegarasi 1 MB va logotip undan katta bo'lishi
 * mumkin.
 */
export function BrandingForm({ branding }: { branding: BrandingAssets }) {
  const { toast } = useToast();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function upload(file: File) {
    const check = validateBrandingUpload({ mimeType: file.type, size: file.size });
    if (!check.ok) {
      toast("error", "Fayl qabul qilinmadi", check.error);
      return;
    }

    setPending(true);
    // Yuklanayotgan faylni darhol ko'rsatamiz — server javobini kutmasdan.
    setPreview(URL.createObjectURL(file));
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/admin/branding", { method: "POST", body });
      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        toast("error", "Saqlanmadi", data.error);
        setPreview(null);
        return;
      }
      toast("success", "Logotip yangilandi", "Barcha ikonkalar qayta yaratildi.");
      // Sidebar va <head> dagi ikonkalar server tomonda hosil bo'ladi.
      router.refresh();
    } catch (err) {
      toast("error", "Saqlanmadi", err instanceof Error ? err.message : undefined);
      setPreview(null);
    } finally {
      setPending(false);
    }
  }

  async function reset() {
    setPending(true);
    try {
      const response = await fetch("/api/admin/branding", { method: "DELETE" });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        toast("error", "Saqlanmadi", data.error);
        return;
      }
      setPreview(null);
      toast("success", "Standart belgiga qaytarildi");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const currentLogo = preview ?? (branding.logoUrl ? versioned(branding.logoUrl, branding.version) : null);

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-line bg-card p-5 shadow-card">
        <h2 className="font-display text-base font-semibold text-ink">Logotip</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          Bitta tasvir yuklang — barcha ikonka o‘lchamlari undan avtomatik
          hosil qilinadi. Kvadrat, fon shaffof PNG eng yaxshi natija beradi;
          kvadrat bo‘lmasa tasvir kesilmaydi, atrofi shaffof qoladi.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-card border border-line bg-surface">
            {currentLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentLogo} alt="Logotip" className="h-16 w-16 object-contain" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-cyan to-electric font-display text-2xl font-bold text-white">
                L
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={BRANDING_MIME_TYPES.join(",")}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={pending}>
              <Upload className="h-4 w-4" />
              {pending ? "Yuklanmoqda…" : "Logotip yuklash"}
            </Button>
            {branding.logoUrl ? (
              <Button variant="ghost" onClick={reset} disabled={pending}>
                <RotateCcw className="h-4 w-4" /> Standart belgiga qaytarish
              </Button>
            ) : null}
          </div>
        </div>

        <p className="mt-3 text-xs text-ink-soft">
          PNG, JPEG, WebP yoki SVG · eng ko‘pi {Math.round(BRANDING_MAX_BYTES / 1024 / 1024)} MB
        </p>
      </section>

      <section className="rounded-card border border-line bg-card p-5 shadow-card">
        <h2 className="font-display text-base font-semibold text-ink">Hosil qilingan ikonkalar</h2>
        <p className="mt-1 mb-4 text-xs text-ink-soft">
          Har o‘lcham aniq bir joy uchun. Logotip yuklanmagan bo‘lsa
          standart <code>favicon.ico</code> ishlatiladi.
        </p>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {BRANDING_ICON_SIZES.map((icon) => {
            const url = branding.icons[icon.size];
            return (
              <li key={icon.size} className="rounded-[10px] border border-line bg-surface p-3 text-center">
                <div className="flex h-14 items-center justify-center">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={versioned(url, branding.version)}
                      alt={`${icon.size}px`}
                      className="max-h-12 max-w-12 object-contain"
                      style={{ imageRendering: icon.size <= 32 ? "pixelated" : "auto" }}
                    />
                  ) : (
                    <span className="text-xs text-ink-soft">—</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] font-bold text-ink">{icon.size}×{icon.size}</p>
                <p className="text-[10px] leading-tight text-ink-soft">{icon.purpose}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

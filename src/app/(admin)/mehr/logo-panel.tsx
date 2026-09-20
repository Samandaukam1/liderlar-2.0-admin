"use client";

import { useState, useTransition, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2, AlertTriangle } from "lucide-react";

/**
 * MEHR 365+ logotipi.
 *
 * RASMIY FAYL BO'LMASA, KOD UNI CHIZMAYDI.
 *
 * Logotipni taxminan qayta yaratish brendni buzadi: rasmiy
 * belgining o'rnida unga o'xshash, lekin boshqa narsa turgan
 * bo'lardi va u sayt bo'ylab tarqalardi. Shuning uchun
 * fayl bo'lmaguncha tipografik yozuv ko'rsatiladi.
 */
export function LogoPanel({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    startTransition(async () => {
      setError(null);
      setNotice(null);

      const form = new FormData();
      form.set("logo", file);

      const response = await fetch("/api/admin/mehr-logo", { method: "POST", body: form });
      const json = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !json.ok) {
        setError(json.error ?? "Yuklab bo'lmadi.");
        return;
      }

      setNotice("Logotip yangilandi. Sayt bo'ylab o'zi almashadi.");
      router.refresh();
    });
  }

  function clear() {
    startTransition(async () => {
      setError(null);
      const response = await fetch("/api/admin/mehr-logo", { method: "DELETE" });
      if (!response.ok) {
        setError("Olib tashlab bo'lmadi.");
        return;
      }
      setNotice("Logotip olib tashlandi — sayt tipografik yozuvga qaytdi.");
      router.refresh();
    });
  }

  return (
    <section className="mb-8 rounded-lg border border-border-soft bg-paper p-5">
      <div className="flex items-center gap-2">
        <ImageUp className="h-4 w-4 text-brand" aria-hidden />
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
          MEHR 365+ logotipi
        </h2>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-5">
        <div
          className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-border-soft bg-ice"
          aria-hidden={!logoUrl}
        >
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt="MEHR 365+ logotipi"
              width={80}
              height={80}
              className="h-20 w-20 object-contain"
              unoptimized
            />
          ) : (
            <span className="px-2 text-center text-[11px] font-semibold text-ink-soft">
              Logotip yuklanmagan
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!logoUrl && (
            <p className="flex items-start gap-1.5 text-xs text-[#946a10]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Rasmiy logotip yuklanmagan. Saytda hozir <strong>tipografik yozuv</strong>{" "}
                ko&apos;rinadi — u logotip emas va rasmiy belgiga o&apos;xshamaydi ham.
              </span>
            </p>
          )}

          <p className="mt-2 text-xs text-ink-soft">
            PNG, WebP yoki SVG. Eng ko&apos;pi 5 MB. Shaffof fon tavsiya etiladi —
            logotip oq va rangli fonda ham ishlatiladi.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/webp,image/svg+xml,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
                e.target.value = "";
              }}
            />

            <button
              type="button"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-badge border border-brand/50 bg-brand/10 px-3 py-1.5 text-xs font-bold text-brand transition hover:bg-brand/20 disabled:opacity-40"
            >
              <ImageUp className="h-3.5 w-3.5" aria-hidden />
              {pending ? "Yuklanmoqda…" : logoUrl ? "Almashtirish" : "Logotip yuklash"}
            </button>

            {logoUrl && (
              <button
                type="button"
                disabled={pending}
                onClick={clear}
                className="inline-flex items-center gap-1.5 rounded-badge border border-border-soft px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:bg-ice disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Olib tashlash
              </button>
            )}
          </div>

          {error && <p className="mt-2 text-xs font-semibold text-[#c43d3d]">{error}</p>}
          {notice && <p className="mt-2 text-xs font-semibold text-[#2e7d44]">{notice}</p>}
        </div>
      </div>

      {/*
        Eski fayl o'chirilmaydi — u keshlarda, ijtimoiy tarmoq
        oldindan ko'rinishlarida va chop etilgan materiallarda
        qolgan bo'lishi mumkin. Buni admin bilib tursin.
      */}
      {logoUrl && (
        <p className="mt-3 text-[11px] text-ink-soft">
          Almashtirilganda eski fayl saqlanib qoladi: unga tashqi havolalar
          bo&apos;lishi mumkin.
        </p>
      )}
    </section>
  );
}

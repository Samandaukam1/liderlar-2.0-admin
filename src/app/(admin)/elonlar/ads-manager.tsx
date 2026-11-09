"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Pencil,
  Plus,
  Save,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Badge } from "@/components/admin/badges";
import { Button, FormField, Input, Select } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  createAdAction,
  deleteAdAction,
  moveAdAction,
  saveAdsSettingsAction,
  setAdActiveAction,
  updateAdAction,
} from "@/lib/actions/elonlar";
import {
  AD_BUTTON_LABEL_MAX,
  AD_TEXT_MAX,
  AD_TITLE_MAX,
  ATTENTION_LABELS,
  BAR_ATTENTIONS,
  BAR_ENTRANCES,
  BAR_ROTATIONS,
  BAR_THEMES,
  BOT_AD_TEXT_MAX,
  BOT_POSITION_LABELS,
  BOT_POST_POSITIONS,
  DEFAULT_BAR_STYLE,
  ENTRANCE_LABELS,
  KIND_LABELS,
  MAX_ACTIVE_ADS_PER_PLACEMENT,
  ROTATION_LABELS,
  THEME_LABELS,
  countActive,
  parseBarStyle,
  type Ad,
  type AdKind,
  type AdPlacement,
  type AdsSettings,
  type BarStyle,
} from "@/lib/elonlar/types";
import {
  AD_STATUS_LABELS,
  LOGO_POSITION_LABELS,
  adStatus,
  previewColors,
  toTashkentDateTimeInput,
  urlHost,
  type AdStatus,
} from "@/lib/elonlar/rules";

/**
 * REKLAMALARNI BOSHQARISH — mijoz qismi.
 *
 * Ikki joy, ikki ro'yxat: bot postlari (caption ostidagi havola) va
 * biografik sahifa bari. Yozish faqat server action orqali; rasm yuklash
 * alohida route'da (server action'ning 1 MB chegarasi).
 */

type ActionResult = { ok: boolean; error?: string };

const STATUS_ACCENT: Record<AdStatus, "green" | "sky" | "amber" | "neutral"> = {
  live: "green",
  scheduled: "sky",
  expired: "amber",
  off: "neutral",
};

function useRunner() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<ActionResult>, success: string, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast("success", success);
        onSuccess?.();
        router.refresh();
      } else {
        toast("error", "Xatolik", result.error);
      }
    });
  }
  return { pending, run };
}

export function AdsManager({
  ads,
  settings,
  nowIso,
}: {
  ads: Ad[];
  settings: AdsSettings;
  nowIso: string;
}) {
  const [tab, setTab] = useState<AdPlacement>("bot_post");
  const now = new Date(nowIso);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="inline-flex rounded-[14px] border border-line bg-card p-1" role="tablist">
        {(
          [
            ["bot_post", "Bot postlari"],
            ["profile_bar", "Biografik sahifa bari"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={
              tab === value
                ? "rounded-[10px] bg-brand px-4 py-2 text-sm font-bold text-white"
                : "rounded-[10px] px-4 py-2 text-sm font-bold text-ink-soft hover:text-ink"
            }
          >
            {label}{" "}
            <span className="ml-1 text-xs opacity-80">
              {countActive(ads, value)}/{MAX_ACTIVE_ADS_PER_PLACEMENT}
            </span>
          </button>
        ))}
      </div>

      <PlacementSection
        key={tab}
        placement={tab}
        ads={ads.filter((ad) => ad.placement === tab)}
        now={now}
      />

      <SettingsCard settings={settings} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PlacementSection({
  placement,
  ads,
  now,
}: {
  placement: AdPlacement;
  ads: Ad[];
  now: Date;
}) {
  const [creating, setCreating] = useState(false);
  const active = countActive(ads, placement);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">
            {placement === "bot_post" ? "Bot postlari ostidagi havola" : "Biografik sahifa ustidagi bar"}
          </h2>
          <p className="text-xs text-ink-soft">
            {placement === "bot_post"
              ? "Har bir yuborilgan post rasmining ostidagi matn oxiriga qo‘shiladi — nomzod ismi kabi qalin, bosiladigan qator. Bir nechtasi yoqilsa, postlarga navbat bilan tushadi."
              : "Har bir biografik sahifada tepadan tushib keladigan bar. X birinchi bosilganda havola ochiladi, ikkinchi bosishda bar yopiladi. Tashrifchi sahifaga qayta kirsa, bar yana chiqadi."}{" "}
            <strong className="text-ink">
              {active}/{MAX_ACTIVE_ADS_PER_PLACEMENT} yoqilgan.
            </strong>
          </p>
        </div>
        {!creating ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Yangi reklama
          </Button>
        ) : null}
      </div>

      {creating ? <AdForm placement={placement} onDone={() => setCreating(false)} /> : null}

      {ads.length === 0 && !creating ? (
        <div className="rounded-card border border-dashed border-line bg-card p-8 text-center text-sm text-ink-soft">
          Hozircha reklama yo‘q. “Yangi reklama” tugmasini bosing.
        </div>
      ) : null}

      <ul className="space-y-3">
        {ads.map((ad, index) => (
          <AdCard key={ad.id} ad={ad} now={now} isFirst={index === 0} isLast={index === ads.length - 1} />
        ))}
      </ul>
    </section>
  );
}

function AdCard({ ad, now, isFirst, isLast }: { ad: Ad; now: Date; isFirst: boolean; isLast: boolean }) {
  const { pending, run } = useRunner();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = adStatus(ad, now);

  return (
    <li
      className={`rounded-card border border-line bg-card p-4 shadow-card transition ${ad.isActive ? "" : "opacity-75"}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-ink">{ad.title}</span>
            <Badge accent={STATUS_ACCENT[status]}>{AD_STATUS_LABELS[status]}</Badge>
            {ad.placement === "profile_bar" && ad.kind ? (
              <Badge accent="neutral">{KIND_LABELS[ad.kind]}</Badge>
            ) : null}
          </div>
          {ad.text ? <p className="mt-1 text-sm text-ink">{ad.text}</p> : null}
          <a
            href={ad.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
          >
            {urlHost(ad.url)} <ExternalLink className="h-3 w-3" />
          </a>
          <p className="mt-1 text-[11px] text-ink-soft">
            {ad.placement === "bot_post"
              ? `${ad.shownCount} ta postga qo‘shildi`
              : `${ad.impressions} marta ko‘rsatildi · ${ad.clicks} marta bosildi`}
            {ad.startsAt || ad.endsAt
              ? ` · ${ad.startsAt ? toTashkentDateTimeInput(ad.startsAt).replace("T", " ") : "…"} — ${
                  ad.endsAt ? toTashkentDateTimeInput(ad.endsAt).replace("T", " ") : "…"
                }`
              : ""}
          </p>
        </div>

        {ad.placement === "profile_bar" && ad.kind === "image" && ad.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt="" className="h-12 max-w-[12rem] rounded-[10px] border border-line object-cover" />
        ) : null}

        <div className="flex items-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={ad.isActive}
            aria-label={ad.isActive ? "O‘chirish" : "Yoqish"}
            disabled={pending}
            onClick={() =>
              run(() => setAdActiveAction(ad.id, !ad.isActive), ad.isActive ? "O‘chirildi" : "Yoqildi")
            }
            className={`relative h-6 w-11 rounded-full transition ${ad.isActive ? "bg-brand" : "bg-ink-soft/30"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                ad.isActive ? "left-[1.375rem]" : "left-0.5"
              }`}
            />
          </button>
          <IconButton
            label="Yuqoriga"
            disabled={pending || isFirst}
            onClick={() => run(() => moveAdAction(ad.id, "up"), "Tartib o‘zgardi")}
          >
            <ArrowUp className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Pastga"
            disabled={pending || isLast}
            onClick={() => run(() => moveAdAction(ad.id, "down"), "Tartib o‘zgardi")}
          >
            <ArrowDown className="h-4 w-4" />
          </IconButton>
          <IconButton label="Tahrirlash" disabled={pending} onClick={() => setEditing((v) => !v)}>
            {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </IconButton>
          <IconButton label="O‘chirib tashlash" disabled={pending} onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {editing ? (
        <div className="mt-4 border-t border-line pt-4">
          <AdForm placement={ad.placement} ad={ad} onDone={() => setEditing(false)} />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          run(() => deleteAdAction(ad.id), "Reklama o‘chirildi", () => setConfirmDelete(false))
        }
        title="Reklamani o‘chirish"
        description={`“${ad.title}” butunlay o‘chiriladi. Statistikasi ham yo‘qoladi.`}
        confirmLabel="O‘chirish"
        danger
        loading={pending}
      />
    </li>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-line text-ink-soft transition hover:border-brand/50 hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

function AdForm({ placement, ad, onDone }: { placement: AdPlacement; ad?: Ad; onDone: () => void }) {
  const { pending, run } = useRunner();
  const initialStyle = ad?.style ?? DEFAULT_BAR_STYLE;

  const [kind, setKind] = useState<AdKind>(ad?.kind ?? "text");
  const [text, setText] = useState(ad?.text ?? "");
  const [url, setUrl] = useState(ad?.url ?? "");
  const [buttonLabel, setButtonLabel] = useState(ad?.buttonLabel ?? "");
  const [style, setStyle] = useState<BarStyle>(initialStyle);
  const [logoUrl, setLogoUrl] = useState(ad?.logoUrl ?? "");
  const [image, setImage] = useState({
    url: ad?.imageUrl ?? "",
    width: ad?.imageWidth ?? null,
    height: ad?.imageHeight ?? null,
  });

  const textMax = placement === "bot_post" ? BOT_AD_TEXT_MAX : AD_TEXT_MAX;
  const patchStyle = (patch: Partial<BarStyle>) => setStyle((s) => parseBarStyle({ ...s, ...patch }));

  return (
    <form
      action={(formData) =>
        run(
          () => (ad ? updateAdAction(formData) : createAdAction(formData)),
          ad ? "Saqlandi" : "Reklama qo‘shildi",
          onDone,
        )
      }
      className="space-y-4 rounded-card border border-line bg-surface p-4"
    >
      <input type="hidden" name="placement" value={placement} />
      {ad ? <input type="hidden" name="id" value={ad.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Ichki nom" hint="Faqat admin panelda ko‘rinadi">
          <Input name="title" defaultValue={ad?.title ?? ""} maxLength={AD_TITLE_MAX} required placeholder="Jaxongirman ilovasi — noyabr" />
        </FormField>
        <FormField label="Havola" hint="https:// bilan">
          <Input
            name="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="https://…"
          />
        </FormField>
      </div>

      {placement === "profile_bar" ? (
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Bar turi</legend>
          <div className="flex flex-wrap gap-2">
            {(["text", "image"] as const).map((value) => (
              <label
                key={value}
                className={`cursor-pointer rounded-[12px] border px-3 py-2 text-sm font-semibold ${
                  kind === value ? "border-brand bg-brand/10 text-ink" : "border-line text-ink-soft"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="sr-only"
                />
                {KIND_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {placement === "bot_post" || kind === "text" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={placement === "bot_post" ? "Post ostidagi matn" : "Sarlavha"}
            hint={`${[...text].length}/${textMax} belgi${placement === "profile_bar" ? " · telefonda 40 belgigacha yaxshi ko‘rinadi" : ""}`}
            className={placement === "bot_post" ? "sm:col-span-2" : undefined}
          >
            <Input
              name="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={textMax}
              required
              placeholder="Jaxongirman ilovasini yuklab oling"
            />
          </FormField>
          {placement === "profile_bar" ? (
            <FormField label="Tugma matni" hint="Ixtiyoriy — bo‘sh bo‘lsa barning o‘zi bosiladi">
              <Input
                name="button_label"
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                maxLength={AD_BUTTON_LABEL_MAX}
                placeholder="Yuklab olish"
              />
            </FormField>
          ) : null}
        </div>
      ) : null}

      {placement === "profile_bar" && kind === "text" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Ilova logotipi (1:1)" hint="Kvadratga kesiladi, 512×512 WebP">
            <MediaField kind="logo" value={logoUrl} onChange={(next) => setLogoUrl(next.url)} />
            <input type="hidden" name="logo_url" value={logoUrl} />
          </FormField>
          <FormField label="Logotip joyi">
            <Select
              name="style_logo_position"
              value={style.logoPosition}
              onChange={(e) => patchStyle({ logoPosition: e.target.value as BarStyle["logoPosition"] })}
            >
              {(["left", "right"] as const).map((value) => (
                <option key={value} value={value}>
                  {LOGO_POSITION_LABELS[value]}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      ) : (
        <input type="hidden" name="style_logo_position" value={style.logoPosition} />
      )}

      {placement === "profile_bar" && kind === "image" ? (
        <FormField label="Bar rasmi" hint="Tavsiya: 1280×160 (8:1). Butun bar shu rasm bo‘ladi.">
          <MediaField kind="image" value={image.url} onChange={(next) => setImage(next)} />
          <input type="hidden" name="image_url" value={image.url} />
          <input type="hidden" name="image_width" value={image.width ?? ""} />
          <input type="hidden" name="image_height" value={image.height ?? ""} />
          {image.width && image.height ? (
            <p className="mt-1 text-xs text-ink-soft">
              {image.width}×{image.height}
            </p>
          ) : null}
        </FormField>
      ) : null}

      {placement === "profile_bar" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Ko‘rinish">
              <Select
                name="style_theme"
                value={style.theme}
                onChange={(e) => patchStyle({ theme: e.target.value as BarStyle["theme"] })}
              >
                {BAR_THEMES.map((value) => (
                  <option key={value} value={value}>
                    {THEME_LABELS[value]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Kirish animatsiyasi">
              <Select
                name="style_entrance"
                value={style.entrance}
                onChange={(e) => patchStyle({ entrance: e.target.value as BarStyle["entrance"] })}
              >
                {BAR_ENTRANCES.map((value) => (
                  <option key={value} value={value}>
                    {ENTRANCE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="E’tibor tortish">
              <Select
                name="style_attention"
                value={style.attention}
                onChange={(e) => patchStyle({ attention: e.target.value as BarStyle["attention"] })}
              >
                {BAR_ATTENTIONS.map((value) => (
                  <option key={value} value={value}>
                    {ATTENTION_LABELS[value]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {style.theme === "custom" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["style_bg", "bg", "Fon", "#0b3555"],
                  ["style_fg", "fg", "Matn", "#ffffff"],
                  ["style_accent", "accent", "Tugma", "#13bce4"],
                ] as const
              ).map(([name, key, label, fallback]) => (
                <FormField key={name} label={label}>
                  <Input
                    type="color"
                    name={name}
                    value={style[key] ?? fallback}
                    onChange={(e) => patchStyle({ [key]: e.target.value })}
                    className="h-10 p-1"
                  />
                </FormField>
              ))}
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="close_opens_link"
              defaultChecked={ad?.closeOpensLink ?? true}
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
            />
            <span>
              X birinchi bosilganda havola ochiladi, ikkinchi bosishda bar yopiladi
              <span className="block text-xs text-ink-soft">O‘chirilsa, X birinchi bosishdayoq yopadi.</span>
            </span>
          </label>

          <BarPreview kind={kind} text={text} buttonLabel={buttonLabel} logoUrl={logoUrl} imageUrl={image.url} style={style} />
        </>
      ) : (
        <BotLinePreview text={text} url={url} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Boshlanish (ixtiyoriy)" hint="Toshkent vaqti">
          <Input type="datetime-local" name="starts_at" defaultValue={toTashkentDateTimeInput(ad?.startsAt)} />
        </FormField>
        <FormField label="Tugash (ixtiyoriy)">
          <Input type="datetime-local" name="ends_at" defaultValue={toTashkentDateTimeInput(ad?.endsAt)} />
        </FormField>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <input type="checkbox" name="is_active" defaultChecked={ad?.isActive ?? true} className="h-4 w-4" />
          Yoqilgan
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>
            Bekor qilish
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            <Save className="h-4 w-4" /> {pending ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */

function MediaField({
  kind,
  value,
  onChange,
}: {
  kind: "logo" | "image";
  value: string;
  onChange: (next: { url: string; width: number | null; height: number | null }) => void;
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      const response = await fetch("/api/admin/elonlar/upload", { method: "POST", body });
      const json = (await response.json().catch(() => null)) as
        | { url?: string; width?: number; height?: number; error?: string }
        | null;
      if (!response.ok || !json?.url) throw new Error(json?.error ?? "Yuklab bo‘lmadi");
      onChange({ url: json.url, width: json.width ?? null, height: json.height ?? null });
      toast("success", "Rasm yuklandi");
    } catch (err) {
      toast("error", "Yuklab bo‘lmadi", err instanceof Error ? err.message : undefined);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt=""
          className={
            kind === "logo"
              ? "h-12 w-12 rounded-[12px] border border-line bg-white object-cover"
              : "h-12 max-w-[16rem] rounded-[10px] border border-line object-cover"
          }
        />
      ) : null}
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[12px] border border-line px-3 py-2 text-xs font-bold text-ink-soft transition hover:border-brand/50 hover:text-ink">
        <UploadCloud className="h-3.5 w-3.5" />
        {uploading ? "Yuklanmoqda…" : value ? "Almashtirish" : "Rasm yuklash"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      {value ? (
        <button
          type="button"
          onClick={() => onChange({ url: "", width: null, height: null })}
          className="inline-flex items-center gap-1 rounded-[12px] border border-line px-3 py-2 text-xs font-bold text-ink-soft hover:text-ink"
        >
          <Trash2 className="h-3.5 w-3.5" /> Olib tashlash
        </button>
      ) : null}
    </div>
  );
}

/** Telegram'dagi ko'rinishning soddalashtirilgan nusxasi. */
function BotLinePreview({ text, url }: { text: string; url: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Postda shunday ko‘rinadi</p>
      <div className="max-w-md rounded-[16px] bg-[#effdde] p-3 text-[13px] leading-relaxed text-[#111] shadow-sm">
        <p className="font-bold opacity-40">“Iqtibos matni…”</p>
        <p className="mt-2 font-bold text-[#2a7ab0] opacity-40">Nomzod Ism Familiyasi</p>
        <p className="mt-2 opacity-40">LIDERLAR.UZ ensiklopediyasiga kirish uchun … ariza qoldiring!</p>
        <p className="mt-2 opacity-40">Liderlar.uz | Instagram | @…</p>
        <p className="mt-2 font-bold text-[#2a7ab0] underline decoration-[#2a7ab0]/40 underline-offset-2">
          {text.trim() || "Reklama matni"}
        </p>
      </div>
      <p className="mt-2 text-[11px] text-ink-soft">
        Qator nomzod ismi kabi qalin va bosiladigan bo‘ladi{url ? ` → ${urlHost(url)}` : ""}. Caption 1024 belgidan
        oshib ketsa, o‘sha postga reklama qo‘shilmaydi.
      </p>
    </div>
  );
}

/** Saytdagi barning taxminiy, harakatsiz ko'rinishi. */
function BarPreview({
  kind,
  text,
  buttonLabel,
  logoUrl,
  imageUrl,
  style,
}: {
  kind: AdKind;
  text: string;
  buttonLabel: string;
  logoUrl: string;
  imageUrl: string;
  style: BarStyle;
}) {
  const colors = previewColors(style);
  const logo = logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-[12px] bg-white object-cover" />
  ) : null;

  return (
    <div className="rounded-card border border-line bg-[linear-gradient(135deg,#0b3555,#087ea4)] p-5">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-white/70">Taxminiy ko‘rinish</p>
      {kind === "image" ? (
        <div className="relative h-20 max-w-[40rem] overflow-hidden rounded-[22px] bg-[#0b3555] ring-1 ring-white/25">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/60">Rasm yuklang</div>
          )}
          <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#0b3555]/70 text-white">
            <X className="h-3.5 w-3.5" />
          </span>
        </div>
      ) : (
        <div
          className="flex min-h-16 max-w-[40rem] items-center gap-3 rounded-[22px] px-3.5 py-3 shadow-[0_18px_55px_rgba(7,88,126,0.25)]"
          style={{ background: colors.bg, color: colors.fg, backdropFilter: "blur(22px)" }}
        >
          {style.logoPosition === "left" ? logo : null}
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-60">Reklama</p>
            <p className="line-clamp-2 text-[14px] font-semibold leading-tight">{text.trim() || "Sarlavha"}</p>
          </div>
          {buttonLabel.trim() ? (
            <span
              className="shrink-0 rounded-full px-3.5 py-2 text-[12px] font-semibold"
              style={{ background: colors.accent, color: colors.accentText }}
            >
              {buttonLabel.trim()}
            </span>
          ) : null}
          {style.logoPosition === "right" ? logo : null}
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/50 text-current">
            <X className="h-4 w-4" />
          </span>
        </div>
      )}
      <p className="mt-3 text-[11px] text-white/70">
        {ENTRANCE_LABELS[style.entrance]} · {ATTENTION_LABELS[style.attention]}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SettingsCard({ settings }: { settings: AdsSettings }) {
  const { pending, run } = useRunner();
  const [rotation, setRotation] = useState(settings.profileBarRotation);

  return (
    <form
      action={(formData) => run(() => saveAdsSettingsAction(formData), "Sozlamalar saqlandi")}
      className="rounded-card border border-line bg-card p-5 shadow-card"
    >
      <h2 className="text-base font-bold text-ink">Umumiy sozlamalar</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormField label="Bot postida reklama o‘rni">
          <Select name="bot_post_position" defaultValue={settings.botPostPosition}>
            {BOT_POST_POSITIONS.map((value) => (
              <option key={value} value={value}>
                {BOT_POSITION_LABELS[value]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Bar navbati">
          <Select
            name="profile_bar_rotation"
            value={rotation}
            onChange={(e) => setRotation(e.target.value as AdsSettings["profileBarRotation"])}
          >
            {BAR_ROTATIONS.map((value) => (
              <option key={value} value={value}>
                {ROTATION_LABELS[value]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Bar paydo bo‘lish kechikishi (ms)" hint="0–30000">
          <Input
            type="number"
            name="profile_bar_appear_delay_ms"
            min={0}
            max={30000}
            step={100}
            defaultValue={settings.profileBarAppearDelayMs}
          />
        </FormField>
        <FormField label="Almashish davri (soniya)" hint="Faqat “Aylanma” navbatda, 3–120">
          <Input
            type="number"
            name="profile_bar_cycle_seconds"
            min={3}
            max={120}
            defaultValue={settings.profileBarCycleSeconds}
            disabled={rotation !== "cycle"}
          />
          {rotation !== "cycle" ? (
            <input type="hidden" name="profile_bar_cycle_seconds" value={settings.profileBarCycleSeconds} />
          ) : null}
        </FormField>
        {/* Yopish faqat shu sahifa ko'rishida amal qiladi — qayta kirilsa bar yana
            chiqadi (egasining talabi). Ustun bazada qoladi, qiymati o'zgarmaydi. */}
        <input type="hidden" name="profile_bar_dismiss_hours" value={settings.profileBarDismissHours} />
        <label className="flex items-start gap-2 self-end text-sm text-ink">
          <input
            type="checkbox"
            name="profile_bar_hide_on_scroll"
            defaultChecked={settings.profileBarHideOnScroll}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            O‘qishga xalaqit bermasin
            <span className="block text-xs text-ink-soft">Pastga aylantirilganda bar yashirinadi, tepaga qaytganda chiqadi.</span>
          </span>
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          <Save className="h-4 w-4" /> {pending ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      </div>
    </form>
  );
}

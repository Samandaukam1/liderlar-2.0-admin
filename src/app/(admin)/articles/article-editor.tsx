"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CloudUpload,
  Eye,
  History,
  Monitor,
  Quote,
  Send,
  Share2,
  Smartphone,
  UploadCloud,
} from "lucide-react";
import { Button, FormField, Input, Select, Textarea } from "@/components/ui/primitives";
import { Drawer, ConfirmDialog } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import { AIImprovePanel } from "@/components/admin/ai-panel";
import { StatusBadge, Avatar } from "@/components/admin/badges";
import {
  restoreRevisionAction,
  saveArticleAction,
  setArticleStatusAction,
} from "@/lib/actions/articles";
import { cn, formatDate, slugify } from "@/lib/utils";
import { uploadToBucket } from "@/lib/upload-client";
import type { Article, ArticleStatus } from "@/lib/types";

export interface RevisionSummary {
  id: string;
  revision: number;
  created_at: string;
  is_autosave: boolean;
  author: string | null;
}

type Mode = "edit" | "desktop" | "mobile" | "quote" | "og";

interface Fields {
  title: string;
  subtitle: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_url: string;
  candidate_id: string;
  seo_title: string;
  seo_description: string;
  scheduled_at: string;
}

export function ArticleEditor({
  article,
  candidates,
  revisions,
  canEdit,
  canSubmit,
  canPublish,
  canUseAI,
  initialCandidateId,
}: {
  article: Article | null;
  candidates: Array<{ id: string; full_name: string }>;
  revisions: RevisionSummary[];
  canEdit: boolean;
  canSubmit: boolean;
  canPublish: boolean;
  canUseAI: boolean;
  initialCandidateId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("edit");
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const [fields, setFields] = useState<Fields>({
    title: article?.title ?? "",
    subtitle: article?.subtitle ?? "",
    slug: article?.slug ?? "",
    excerpt: article?.excerpt ?? "",
    content: article?.content ?? "",
    cover_url: article?.cover_url ?? "",
    candidate_id: article?.candidate_id ?? initialCandidateId ?? "",
    seo_title: article?.seo_title ?? "",
    seo_description: article?.seo_description ?? "",
    scheduled_at: article?.scheduled_at?.slice(0, 16) ?? "",
  });
  // Ref drives async callbacks (always latest id); state drives render.
  const articleIdRef = useRef<string | null>(article?.id ?? null);
  const [articleId, setArticleId] = useState<string | null>(article?.id ?? null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (key: keyof Fields) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setSaveState("dirty");
  };

  // Unsaved-changes guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveState !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  const persist = useCallback(
    async (autosave: boolean) => {
      if (!fields.title || fields.title.trim().length < 3) return;
      setSaveState("saving");
      const res = await saveArticleAction(articleIdRef.current, fields, { autosave });
      if (res.ok) {
        setSaveState("saved");
        setLastSavedAt(new Date());
        if (!articleIdRef.current && res.id) {
          articleIdRef.current = res.id;
          setArticleId(res.id);
          window.history.replaceState(null, "", `/articles/${res.id}`);
        }
        if (!autosave) toast("success", "Maqola saqlandi", `Versiya №${res.revision}`);
      } else {
        setSaveState("dirty");
        if (!autosave) toast("error", "Saqlab bo‘lmadi", res.error);
      }
    },
    [fields, toast],
  );

  // Autosave: 3 s after the last change (existing articles only)
  useEffect(() => {
    if (saveState !== "dirty" || !canEdit) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      if (articleIdRef.current) void persist(true);
    }, 3000);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [fields, saveState, canEdit, persist]);

  async function uploadCover(file: File) {
    setUploading(true);
    try {
      set("cover_url")(await uploadToBucket(file, "candidate-gallery"));
      toast("success", "Muqova yuklandi");
    } catch (e) {
      toast("error", "Muqova yuklanmadi", e instanceof Error ? e.message : undefined);
    } finally {
      setUploading(false);
    }
  }

  const setStatus = (status: ArticleStatus) =>
    startTransition(async () => {
      if (!articleIdRef.current) {
        toast("warning", "Avval maqolani saqlang");
        return;
      }
      await persist(false);
      const res = await setArticleStatusAction(articleIdRef.current, status);
      if (res.ok) {
        toast("success", "Status yangilandi");
        router.refresh();
      } else toast("error", "Xatolik", res.error);
    });

  const paragraphs = useMemo(
    () => fields.content.split(/\n{2,}/).filter((p) => p.trim()),
    [fields.content],
  );
  const candidateName = candidates.find((c) => c.id === fields.candidate_id)?.full_name;

  const previewBody = (
    <article className={cn("mx-auto bg-card", mode === "mobile" ? "max-w-[380px] rounded-[28px] border-4 border-navy-deep/80 p-5" : "max-w-2xl p-2")}>
      {fields.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fields.cover_url} alt="" className="mb-5 aspect-[16/9] w-full rounded-card border border-line object-cover" />
      )}
      <h1 className="font-display text-2xl font-semibold uppercase leading-tight tracking-wide text-ink md:text-3xl">
        {fields.title || "Sarlavha…"}
      </h1>
      {fields.subtitle && <p className="mt-2 text-base text-brand">{fields.subtitle}</p>}
      {candidateName && (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <Avatar name={candidateName} size={26} /> {candidateName}
        </p>
      )}
      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-ink">
        {paragraphs.length === 0 ? (
          <p className="text-ink-soft">Matn hali yozilmagan…</p>
        ) : (
          paragraphs.map((p, i) =>
            p.startsWith("> ") ? (
              <blockquote key={i} className="rounded-r-card border-l-4 border-cyan bg-cyan/5 py-3 pl-4 pr-3 font-semibold italic text-navy-dark">
                {p.slice(2)}
              </blockquote>
            ) : p.startsWith("## ") ? (
              <h2 key={i} className="font-display text-xl font-semibold uppercase tracking-wide text-ink">
                {p.slice(3)}
              </h2>
            ) : (
              <p key={i}>{p}</p>
            ),
          )
        )}
      </div>
    </article>
  );

  const quotePreview = (
    <div className="mx-auto max-w-md overflow-hidden rounded-panel bg-gradient-to-br from-navy-deep via-navy-dark to-brand p-8 text-white shadow-pop">
      <p className="font-display text-6xl leading-none text-cyan/70">“</p>
      <p className="mt-2 text-lg font-semibold leading-relaxed">
        {fields.excerpt || fields.subtitle || "Iqtibos matni excerpt maydonidan olinadi…"}
      </p>
      <div className="mt-6 flex items-center gap-3 border-t border-white/15 pt-4">
        {candidateName && <Avatar name={candidateName} size={40} />}
        <div>
          <p className="font-display text-sm font-semibold uppercase tracking-widest">{candidateName ?? "Liderlar.uz"}</p>
          <p className="text-xs text-cyan-light/80">liderlar.uz</p>
        </div>
      </div>
    </div>
  );

  const ogPreview = (
    <div className="mx-auto max-w-lg overflow-hidden rounded-card border border-line shadow-card">
      <div className="aspect-[1.91/1] bg-gradient-to-br from-navy-deep to-brand">
        {fields.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fields.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center font-display text-xl font-semibold uppercase tracking-wide text-white">
            {fields.title || "Liderlar.uz"}
          </div>
        )}
      </div>
      <div className="bg-card p-4">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft">liderlar.uz</p>
        <p className="mt-1 text-sm font-bold text-ink">{fields.seo_title || fields.title || "Sarlavha"}</p>
        <p className="mt-1 line-clamp-2 text-xs text-ink-soft">
          {fields.seo_description || fields.excerpt || "SEO tavsif…"}
        </p>
      </div>
    </div>
  );

  const MODES: Array<{ key: Mode; label: string; icon: typeof Eye }> = [
    { key: "edit", label: "Tahrir", icon: Eye },
    { key: "desktop", label: "Desktop", icon: Monitor },
    { key: "mobile", label: "Mobil", icon: Smartphone },
    { key: "quote", label: "Quote card", icon: Quote },
    { key: "og", label: "OG preview", icon: Share2 },
  ];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-3 shadow-card">
        <div className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-[12px] px-3 py-2 text-xs font-bold transition",
                mode === m.key
                  ? "bg-gradient-to-r from-brand to-electric text-white"
                  : "text-ink-soft hover:bg-surface hover:text-ink",
              )}
            >
              <m.icon className="h-3.5 w-3.5" /> {m.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-ink-soft" aria-live="polite">
            {saveState === "saving" && "Saqlanmoqda…"}
            {saveState === "saved" && lastSavedAt && (
              <span className="flex items-center gap-1 text-[#2e7d44]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saqlandi {lastSavedAt.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {saveState === "dirty" && "Saqlanmagan o‘zgarishlar"}
          </span>
          {article && <StatusBadge status={article.status} />}
          <Button variant="ghost" size="sm" onClick={() => setRevisionsOpen(true)}>
            <History className="h-4 w-4" /> Versiyalar
          </Button>
          {canEdit && (
            <Button size="sm" disabled={pending || saveState === "saving"} onClick={() => void persist(false)}>
              <CloudUpload className="h-4 w-4" /> Saqlash
            </Button>
          )}
          {canSubmit && article?.status === "draft" && (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setStatus("review")}>
              <Send className="h-4 w-4" /> Nashrga yuborish
            </Button>
          )}
          {canPublish && article && article.status !== "published" && (
            <Button variant="success" size="sm" disabled={pending} onClick={() => setConfirmPublish(true)}>
              Nashr etish
            </Button>
          )}
          {canPublish && article?.status === "published" && (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setStatus("archived")}>
              Arxivlash
            </Button>
          )}
        </div>
      </div>

      {mode === "edit" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <FormField label="Sarlavha" htmlFor="a-title">
              <Input
                id="a-title"
                value={fields.title}
                onChange={(e) => set("title")(e.target.value)}
                placeholder="Maqola sarlavhasi"
                disabled={!canEdit}
                className="h-12 text-lg font-bold"
              />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Subtitr" htmlFor="a-subtitle">
                <Input id="a-subtitle" value={fields.subtitle} onChange={(e) => set("subtitle")(e.target.value)} disabled={!canEdit} />
              </FormField>
              <FormField label="Slug" htmlFor="a-slug" hint={`liderlar.uz/maqola/${fields.slug || slugify(fields.title)}`}>
                <Input id="a-slug" value={fields.slug} onChange={(e) => set("slug")(e.target.value)} disabled={!canEdit} />
              </FormField>
            </div>
            <FormField label="Qisqacha (excerpt)" htmlFor="a-excerpt" hint="Quote card va ro‘yxatlarda ko‘rinadi">
              <Textarea id="a-excerpt" rows={2} value={fields.excerpt} onChange={(e) => set("excerpt")(e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField
              label="Matn"
              htmlFor="a-content"
              hint="Bo‘sh qator — yangi xatboshi · «## » — bo‘lim sarlavhasi · «> » — iqtibos"
            >
              <Textarea
                id="a-content"
                rows={18}
                value={fields.content}
                onChange={(e) => set("content")(e.target.value)}
                disabled={!canEdit}
                className="font-[450] leading-relaxed"
              />
            </FormField>

            {canUseAI && fields.content.trim().length >= 20 && (
              <AIImprovePanel
                original={fields.content}
                candidateName={candidateName}
                entityType="article"
                entityId={articleId}
                acceptLabel="Matnga qo‘llash"
                onAccept={(text) => {
                  set("content")(text);
                }}
              />
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-card border border-line bg-card p-5 shadow-card">
              <h3 className="mb-3 text-sm font-bold text-ink">Muqova</h3>
              {fields.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fields.cover_url} alt="" className="mb-3 aspect-[16/9] w-full rounded-[14px] border border-line object-cover" />
              ) : (
                <div className="mb-3 flex aspect-[16/9] items-center justify-center rounded-[14px] border border-dashed border-line-strong text-xs text-ink-soft">
                  Muqova yuklanmagan
                </div>
              )}
              {canEdit && (
                <label className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[12px] border border-line px-3 py-2 text-xs font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand">
                  <UploadCloud className="h-3.5 w-3.5" />
                  {uploading ? "Yuklanmoqda…" : "Muqova yuklash"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadCover(f);
                    }}
                  />
                </label>
              )}
            </div>

            <div className="rounded-card border border-line bg-card p-5 shadow-card">
              <h3 className="mb-3 text-sm font-bold text-ink">Bog‘lanish</h3>
              <FormField label="Nomzod" htmlFor="a-candidate">
                <Select id="a-candidate" value={fields.candidate_id} onChange={(e) => set("candidate_id")(e.target.value)} disabled={!canEdit}>
                  <option value="">Bog‘lanmagan</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Rejalashtirilgan nashr vaqti" htmlFor="a-scheduled" className="mt-3">
                <Input id="a-scheduled" type="datetime-local" value={fields.scheduled_at} onChange={(e) => set("scheduled_at")(e.target.value)} disabled={!canEdit} />
              </FormField>
            </div>

            <div className="rounded-card border border-line bg-card p-5 shadow-card">
              <h3 className="mb-3 text-sm font-bold text-ink">SEO</h3>
              <FormField label="SEO sarlavha" htmlFor="a-seo-title">
                <Input id="a-seo-title" value={fields.seo_title} onChange={(e) => set("seo_title")(e.target.value)} disabled={!canEdit} />
              </FormField>
              <FormField label="SEO tavsif" htmlFor="a-seo-desc" className="mt-3">
                <Textarea id="a-seo-desc" rows={3} value={fields.seo_description} onChange={(e) => set("seo_description")(e.target.value)} disabled={!canEdit} />
              </FormField>
            </div>
          </aside>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface/60 p-6 shadow-card">
          {mode === "quote" ? quotePreview : mode === "og" ? ogPreview : previewBody}
        </div>
      )}

      <Drawer open={revisionsOpen} onClose={() => setRevisionsOpen(false)} title="Versiyalar tarixi">
        {revisions.length === 0 ? (
          <p className="text-sm text-ink-soft">Versiyalar hali yo‘q</p>
        ) : (
          <ul className="space-y-2">
            {revisions.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-[14px] border border-line p-3">
                <span className="font-display text-lg font-semibold text-brand">№{r.revision}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-ink">
                    {r.author ?? "—"} {r.is_autosave && <em className="font-normal text-ink-soft">(autosave)</em>}
                  </span>
                  <span className="block text-[11px] text-ink-soft">{formatDate(r.created_at, true)}</span>
                </span>
                {canEdit && articleId && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await restoreRevisionAction(articleIdRef.current!, r.id);
                        if (res.ok) {
                          toast("success", `№${r.revision} versiya tiklandi`);
                          setRevisionsOpen(false);
                          router.refresh();
                        } else toast("error", "Xatolik", res.error);
                      })
                    }
                  >
                    Tiklash
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        onConfirm={() => {
          setConfirmPublish(false);
          setStatus("published");
        }}
        title="Maqolani nashr etish"
        description="Maqola liderlar.uz saytida ommaga ko‘rinadi."
        confirmLabel="Nashr etish"
      />
    </div>
  );
}

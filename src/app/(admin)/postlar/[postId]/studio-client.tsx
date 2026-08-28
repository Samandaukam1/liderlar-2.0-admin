"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Check,
  RefreshCw,
  Scissors,
  Send,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/admin/badges";
import { Button, Input, Label, Textarea } from "@/components/ui/primitives";
import { PostPreviewCanvas } from "@/components/post-studio/preview-canvas";
import type { PostRecord } from "@/lib/post-studio/repository";
import type { QuoteCandidate } from "@/lib/post-studio/quote-source";
import {
  POST_STATUS_LABELS,
  POST_STATUS_TONES,
  type PostLayout,
  type PostPalette,
  type PostTemplateId,
} from "@/lib/post-studio/types";
import { applyPortraitOverride } from "@/lib/post-studio/portrait-fit";
import {
  approvePostAction,
  preparePortraitAction,
  regenerateCaptionAction,
  rerenderPostAction,
  saveArticleUrlAction,
  saveCaptionAction,
  savePostContentAction,
  schedulePostAction,
  sendPostToSubscribersAction,
  sendTelegramTestAction,
} from "@/lib/actions/post-studio";

/**
 * The three-panel Post Studio.
 *
 * The centre preview is drawn from the PostLayout the server computed, so what
 * is on screen is the render's own geometry. Saving re-runs the layout engine
 * server-side and returns a fresh render, which is what the "Haqiqiy render"
 * image shows.
 */

const TONE_ACCENT = {
  neutral: "neutral",
  info: "sky",
  success: "green",
  warning: "amber",
  danger: "coral",
} as const;

interface TemplateOption {
  id: PostTemplateId;
  label: string;
  accentColor: string;
  thumbnailUrl: string;
  backgroundUrl: string;
  foregroundUrl: string;
  palette: PostPalette;
}

interface StudioProps {
  post: PostRecord;
  layout: PostLayout;
  templates: TemplateOption[];
  candidate: {
    fullName: string;
    articleUrl: string | null;
    quotes: QuoteCandidate[];
    shortBioItems: string[];
    portraitSourceUrl: string | null;
    /** candidates.status — what decides whether the public profile is live. */
    candidateStatus: string | null;
    /** The candidate's article row status, or null when there is no article. */
    articleStatus: string | null;
    /** Whether site_settings → public_web.base_url resolves to an origin. */
    publicWebConfigured: boolean;
  };
  delivery: { sent: number; failed: number; lastSentAt: string | null };
  subscribers: { total: number; active: number; stopped: number; lastSentAt: string | null };
  canManage: boolean;
  canPublish: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "qoralama",
  review: "tekshiruvda",
  scheduled: "rejalashtirilgan",
  published: "nashr qilingan",
  archived: "arxivlangan",
};

/**
 * Why the caption has no profile link.
 *
 * The link is the candidate's own `/liderlar/{slug}` page, which the public
 * site serves whenever `candidates.status = 'published'`. Two different things
 * can leave it empty and they used to print the same message, which sent
 * admins hunting for a publication problem that did not exist.
 */
function describeProfileState(candidate: {
  articleUrl: string | null;
  candidateStatus: string | null;
  publicWebConfigured: boolean;
}): string {
  if (candidate.articleUrl) return "Nashr qilingan sahifa";
  if (candidate.candidateStatus !== "published") {
    const label = STATUS_LABELS[candidate.candidateStatus ?? ""] ?? candidate.candidateStatus ?? "noma’lum";
    return `Nomzod sahifasi hali nashr qilinmagan (holati: ${label})`;
  }
  if (!candidate.publicWebConfigured) {
    return "Sahifa nashr qilingan, lekin public sayt manzili sozlanmagan — havolani qo‘lda tasdiqlang";
  }
  return "Sahifa havolasi aniqlanmadi";
}

const QUOTE_SOURCE_LABELS: Record<string, string> = {
  intake_quote: "Anketa 15-savoli",
  featured_quote: "Tanlangan iqtibos",
  article_quote: "Maqoladagi iqtibos",
  life_motto: "Hayotiy shior",
  manual: "Qo‘lda kiritilgan",
  none: "Yo‘q",
};

type PortraitStage = "done" | "running" | "error" | "idle";

const PORTRAIT_STAGE_LABELS: Record<PortraitStage, string> = {
  done: "Olib tashlandi",
  running: "Jarayonda",
  error: "Xato",
  idle: "Boshlanmagan",
};

const PORTRAIT_STAGE_ACCENTS: Record<PortraitStage, "success" | "info" | "danger" | "neutral"> = {
  done: "success",
  running: "info",
  error: "danger",
  idle: "neutral",
};

/**
 * What the background-removal run last did. `preparePortrait` writes a fresh
 * metadata object on success and only ever stamps `failedAt` when an attempt
 * throws, so the presence of that stamp is what distinguishes "the stored
 * cut-out is current" from "the stored cut-out is stale and the last try
 * failed".
 */
function readPortraitStatus(post: PostRecord, busy: boolean): {
  stage: PortraitStage;
  detail: string | null;
} {
  const portrait = (post.metadata?.portrait ?? {}) as Record<string, unknown>;
  if (busy) return { stage: "running", detail: null };
  if (typeof portrait.failedAt === "string") {
    return {
      stage: "error",
      detail: typeof portrait.error === "string" ? portrait.error : null,
    };
  }
  if (post.portraitProcessedUrl) return { stage: "done", detail: null };
  return { stage: "idle", detail: null };
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card p-4">
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function PostStudio(props: StudioProps) {
  const { post, layout, templates, candidate, delivery, subscribers, canManage, canPublish } = props;

  const [templateId, setTemplateId] = useState<PostTemplateId>(post.templateId);
  const [quote, setQuote] = useState(post.quote);
  const [nameLines, setNameLines] = useState(post.nameLines.join("\n"));
  const [bioItems, setBioItems] = useState(post.shortBioItems.join("\n"));
  const [transform, setTransform] = useState(post.portraitTransform);
  const [caption, setCaption] = useState(post.telegramCaption ?? "");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [renderVersion, setRenderVersion] = useState(0);

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? templates[0],
    [templates, templateId],
  );

  const portraitStatus = readPortraitStatus(post, pending);

  /**
   * The preview reuses the server-computed layout but re-points the parts the
   * admin is dragging right now, so sliders feel instant. The template frame is
   * recovered from the laid-out portrait and re-placed by the very same
   * function the renderer uses, so dragging cannot drift from the final PNG.
   * Text geometry is not recomputed here — a save round-trip re-runs the real
   * engine.
   */
  const previewLayout: PostLayout = useMemo(() => {
    return {
      ...layout,
      // Template is a paint-time property, never post content: swapping it
      // recolours the quote's accent immediately instead of leaving the
      // previously saved template's colour on screen until the next save.
      palette: activeTemplate?.palette ?? layout.palette,
      portrait: {
        ...layout.portrait,
        ...applyPortraitOverride(layout.portraitFit, transform),
      },
    };
  }, [layout, transform, activeTemplate]);

  function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const result = await action();
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? "Bajarildi." });
      if (result.ok) setRenderVersion((v) => v + 1);
    });
  }

  function onSave(formData: FormData) {
    formData.set("post_id", post.id);
    formData.set("template_id", templateId);
    formData.set("quote", quote);
    formData.set("name_lines", nameLines);
    formData.set("short_bio_items", bioItems);
    formData.set("portrait_offset_x", String(transform.offsetX));
    formData.set("portrait_offset_y", String(transform.offsetY));
    formData.set("portrait_scale", String(transform.scale));
    run(() => savePostContentAction(formData));
  }

  const warnings = (post.metadata.warnings as { code: string; message: string }[] | undefined) ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
      {/* ---------------- LEFT: templates + source material ---------------- */}
      <div className="space-y-4">
        <Panel title="Shablon">
          <div className="grid grid-cols-3 gap-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setTemplateId(template.id)}
                title={template.label}
                className={`overflow-hidden rounded-[10px] border-2 transition ${
                  template.id === templateId
                    ? "border-brand shadow-[0_0_0_3px_rgba(30,200,251,0.2)]"
                    : "border-line hover:border-line-strong"
                }`}
              >
                <Image
                  src={template.thumbnailUrl}
                  alt={template.label}
                  width={80}
                  height={80}
                  className="h-auto w-full"
                />
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">{activeTemplate?.label}</p>
        </Panel>

        <Panel title="Nomzod">
          <p className="text-sm font-semibold text-ink">{candidate.fullName}</p>
          <p className="mt-1 text-xs text-ink-soft">
            {candidate.articleUrl ? (
              <a href={candidate.articleUrl} className="text-brand hover:underline" target="_blank" rel="noreferrer">
                Nomzod sahifasi
              </a>
            ) : (
              describeProfileState(candidate)
            )}
          </p>
        </Panel>

        <Panel title="Canonical iqtibos">
          {candidate.quotes.length === 0 ? (
            <p className="text-xs text-ink-soft">
              15-savol javobi bo‘sh. Iqtibosni qo‘lda kiriting.
            </p>
          ) : (
            <ul className="space-y-2">
              {candidate.quotes.map((q, i) => (
                <li key={q.id ?? i}>
                  <button
                    type="button"
                    onClick={() => setQuote(q.text)}
                    className="w-full rounded-[10px] border border-line p-2 text-left text-xs transition hover:border-brand/60"
                  >
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                      {QUOTE_SOURCE_LABELS[q.source] ?? q.source}
                    </span>
                    {q.text.length > 120 ? `${q.text.slice(0, 120)}…` : q.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Portret">
          {post.portraitProcessedUrl ? (
            <Image
              src={post.portraitProcessedUrl}
              alt="Foni olib tashlangan portret"
              width={200}
              height={260}
              unoptimized
              className="h-auto w-full rounded-[10px] border border-line bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px]"
            />
          ) : (
            <p className="text-xs text-ink-soft">
              {candidate.portraitSourceUrl
                ? "Foni hali olib tashlanmagan."
                : "Anketaga rasm biriktirilmagan."}
            </p>
          )}

          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-soft">Manba</dt>
              <dd>{candidate.portraitSourceUrl ? "Anketa rasmi" : "Topilmadi"}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-soft">Fon</dt>
              <dd>
                <Badge accent={TONE_ACCENT[PORTRAIT_STAGE_ACCENTS[portraitStatus.stage]]}>
                  {PORTRAIT_STAGE_LABELS[portraitStatus.stage]}
                </Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-soft">Saturation</dt>
              <dd>0%</dd>
            </div>
          </dl>

          {portraitStatus.stage === "error" ? (
            <p className="mt-2 rounded-[8px] border border-coral/50 bg-coral/10 px-2 py-1.5 text-[11px] leading-snug text-coral">
              Portret fonini avtomatik olib tashlashda xatolik yuz berdi
              {portraitStatus.detail ? `: ${portraitStatus.detail}` : "."}
            </p>
          ) : null}

          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              disabled={pending || !candidate.portraitSourceUrl}
              onClick={() => run(() => preparePortraitAction(post.id))}
            >
              <Scissors className="h-3.5 w-3.5" />
              Portretni qayta ishlash
            </Button>
          ) : null}
        </Panel>
      </div>

      {/* ---------------- CENTRE: 1080x1080 preview ---------------- */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge accent={TONE_ACCENT[POST_STATUS_TONES[post.status]]}>
            {POST_STATUS_LABELS[post.status]}
          </Badge>
          <span className="text-xs text-ink-soft">1080×1080</span>
          {post.renderedAt ? (
            <span className="text-xs text-ink-soft">
              Oxirgi render: {new Date(post.renderedAt).toLocaleString("uz-UZ")}
            </span>
          ) : null}
        </div>

        {activeTemplate ? (
          <PostPreviewCanvas
            layout={previewLayout}
            backgroundUrl={activeTemplate.backgroundUrl}
            foregroundUrl={activeTemplate.foregroundUrl}
          />
        ) : null}

        {warnings.length > 0 ? (
          <div className="rounded-card border border-amber/50 bg-amber/10 p-3">
            <p className="mb-1 flex items-center gap-2 text-xs font-bold text-[#946a10]">
              <AlertTriangle className="h-3.5 w-3.5" />
              Ogohlantirishlar
            </p>
            <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-soft">
              {warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {post.error ? (
          <div className="rounded-card border border-coral/50 bg-coral/10 p-3 text-xs font-semibold text-coral">
            {post.error}
          </div>
        ) : null}

        {post.renderedImageUrl ? (
          <details className="rounded-card border border-line bg-card p-3">
            <summary className="cursor-pointer text-xs font-bold text-ink-soft">
              Haqiqiy render (server)
            </summary>
            <Image
              key={renderVersion}
              src={`/api/admin/post-studio/${post.id}/preview?v=${renderVersion}`}
              alt="Server renderi"
              width={1080}
              height={1080}
              unoptimized
              className="mt-3 h-auto w-full rounded-[10px] border border-line"
            />
          </details>
        ) : null}
      </div>

      {/* ---------------- RIGHT: controls ---------------- */}
      <div className="space-y-4">
        {feedback ? (
          <div
            className={`rounded-card border p-3 text-xs ${
              feedback.ok
                ? "border-green/50 bg-green/10 text-[#2e7d44]"
                : "border-coral/50 bg-coral/10 text-[#c43d3d]"
            }`}
          >
            {feedback.text}
          </div>
        ) : null}

        <form action={onSave} className="space-y-4">
          <Panel title="Matn">
            <Label htmlFor="quote">Iqtibos</Label>
            <Textarea
              id="quote"
              rows={5}
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              disabled={!canManage}
            />
            <p className="mt-1 text-[11px] text-ink-soft">
              Manba: {QUOTE_SOURCE_LABELS[post.quoteSource ?? "none"]}
            </p>

            <Label htmlFor="name_lines" className="mt-3">
              Ism qatorlari (har qatorda bittadan, 2–3 ta)
            </Label>
            <Textarea
              id="name_lines"
              rows={3}
              value={nameLines}
              onChange={(e) => setNameLines(e.target.value)}
              disabled={!canManage}
            />

            <Label htmlFor="bio_items" className="mt-3">
              Qisqa tavsiflar (maksimal 5 ta)
            </Label>
            <Textarea
              id="bio_items"
              rows={5}
              value={bioItems}
              onChange={(e) => setBioItems(e.target.value)}
              disabled={!canManage}
            />
          </Panel>

          <Panel title="Shrift o‘lchamlari (bo‘sh = avtomatik)">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="quote_font_size">Iqtibos</Label>
                <Input
                  id="quote_font_size"
                  name="quote_font_size"
                  type="number"
                  min={10}
                  max={80}
                  defaultValue={post.fontSizeOverrides.quote ?? ""}
                  placeholder={String(layout.quote.fontSize)}
                  disabled={!canManage}
                />
              </div>
              <div>
                <Label htmlFor="name_font_size">Ism</Label>
                <Input
                  id="name_font_size"
                  name="name_font_size"
                  type="number"
                  min={16}
                  max={120}
                  defaultValue={post.fontSizeOverrides.name ?? ""}
                  placeholder={String(layout.name.fontSize)}
                  disabled={!canManage}
                />
              </div>
              <div>
                <Label htmlFor="short_bio_font_size">Tavsif</Label>
                <Input
                  id="short_bio_font_size"
                  name="short_bio_font_size"
                  type="number"
                  min={8}
                  max={40}
                  defaultValue={post.fontSizeOverrides.shortBio ?? ""}
                  placeholder={String(layout.shortBio.fontSize)}
                  disabled={!canManage}
                />
              </div>
            </div>
          </Panel>

          <Panel title="Portret joylashuvi">
            {(
              [
                { key: "offsetX", label: "Gorizontal", min: -200, max: 200, step: 1 },
                { key: "offsetY", label: "Vertikal", min: -200, max: 200, step: 1 },
                { key: "scale", label: "Masshtab", min: 0.5, max: 1.8, step: 0.01 },
              ] as const
            ).map((slider) => (
              <div key={slider.key} className="mb-3 last:mb-0">
                <Label htmlFor={slider.key}>
                  {slider.label}: {transform[slider.key].toFixed(slider.key === "scale" ? 2 : 0)}
                </Label>
                <input
                  id={slider.key}
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={transform[slider.key]}
                  disabled={!canManage}
                  onChange={(e) =>
                    setTransform((t) => ({ ...t, [slider.key]: Number(e.target.value) }))
                  }
                  className="w-full accent-brand"
                />
              </div>
            ))}
          </Panel>

          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                <Sparkles className="h-4 w-4" />
                Saqlash va render
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => rerenderPostAction(post.id))}
              >
                <RefreshCw className="h-4 w-4" />
                Qayta render
              </Button>
            </div>
          ) : null}
        </form>

        {/* ------------------- Telegram ------------------- */}
        <Panel title="Telegram bot">
          <dl className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-ink-soft">Aktiv obunachilar</dt>
              <dd className="font-bold text-ink">{subscribers.active}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">Jami / to‘xtatgan</dt>
              <dd className="font-bold text-ink">
                {subscribers.total} / {subscribers.stopped}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">Yuborilgan</dt>
              <dd className="font-bold text-[#2e7d44]">{delivery.sent}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">Xato</dt>
              <dd className="font-bold text-[#c43d3d]">{delivery.failed}</dd>
            </div>
          </dl>

          <form
            action={(formData) => run(() => saveArticleUrlAction(formData))}
            className="mb-3 space-y-2"
          >
            <input type="hidden" name="post_id" value={post.id} />
            <Label htmlFor="article_url">Maqola havolasi (caption uchun)</Label>
            <Input
              id="article_url"
              name="article_url"
              type="url"
              defaultValue={post.articleUrl ?? candidate.articleUrl ?? ""}
              placeholder="https://…/liderlar/slug"
              disabled={!canManage}
            />
            <p className="text-[11px] text-ink-soft">
              {candidate.articleUrl
                ? "Avtomatik aniqlandi — kerak bo‘lsa qo‘lda o‘zgartiring."
                : `${describeProfileState(candidate)}. Bu yerga to‘liq havolani qo‘yib saqlasangiz, ` +
                  "caption'dagi sayt va ariza havolalari ham o‘sha manzildan olinadi."}
            </p>
            {canManage ? (
              <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                Havolani saqlash
              </Button>
            ) : null}
          </form>

          <form action={(formData) => run(() => saveCaptionAction(formData))} className="space-y-2">
            <input type="hidden" name="post_id" value={post.id} />
            <Label htmlFor="telegram_caption">Caption (MarkdownV2)</Label>
            <Textarea
              id="telegram_caption"
              name="telegram_caption"
              rows={8}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="font-mono text-[11px]"
              disabled={!canManage}
            />
            <p className="text-[11px] text-ink-soft">{[...caption].length}/1024 belgi</p>
            {canManage ? (
              <div className="flex gap-2">
                <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                  Captionni saqlash
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => regenerateCaptionAction(post.id))}
                >
                  Qayta yaratish
                </Button>
              </div>
            ) : null}
          </form>

          {canPublish ? (
            <div className="mt-4 space-y-3 border-t border-line pt-3">
              <form action={(formData) => run(() => sendTelegramTestAction(formData))} className="flex gap-2">
                <input type="hidden" name="post_id" value={post.id} />
                <Input name="chat_id" placeholder="Test chat ID" className="h-8 text-xs" />
                <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                  Test
                </Button>
              </form>

              <form action={(formData) => run(() => sendPostToSubscribersAction(formData))} className="space-y-2">
                <input type="hidden" name="post_id" value={post.id} />
                <Button type="submit" size="sm" className="w-full" disabled={pending}>
                  <Send className="h-3.5 w-3.5" />
                  Bot orqali yuborish ({subscribers.active})
                </Button>
              </form>

              {delivery.failed > 0 ? (
                <form action={(formData) => run(() => sendPostToSubscribersAction(formData))}>
                  <input type="hidden" name="post_id" value={post.id} />
                  <input type="hidden" name="only_failed" value="on" />
                  <Button type="submit" variant="ghost" size="sm" className="w-full" disabled={pending}>
                    Faqat xato bo‘lganlarga qayta yuborish ({delivery.failed})
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
        </Panel>

        {canPublish ? (
          <Panel title="Nashr">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={pending || post.status === "needs_review"}
              onClick={() => run(() => approvePostAction(post.id))}
            >
              <Check className="h-3.5 w-3.5" />
              Tasdiqlash
            </Button>
            <form action={(formData) => run(() => schedulePostAction(formData))} className="mt-2 flex gap-2">
              <input type="hidden" name="post_id" value={post.id} />
              <Input
                type="datetime-local"
                name="scheduled_at"
                className="h-8 text-xs"
                defaultValue={post.scheduledAt?.slice(0, 16) ?? ""}
              />
              <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                Rejalashtirish
              </Button>
            </form>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

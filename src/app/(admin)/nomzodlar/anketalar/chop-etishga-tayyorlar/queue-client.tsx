"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Inbox,
  Loader2,
  Rocket,
  RotateCcw,
  Square,
  XCircle,
} from "lucide-react";
import { Badge, Avatar, StatusBadge } from "@/components/admin/badges";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { EmptyState } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatTashkent } from "@/lib/tashkent-day";
import type {
  BatchProgress,
  PublishQueueRow,
  PublishQueueSummary,
} from "@/lib/intake/publish-batch";
import {
  askPaymentChunkAction,
  cancelPublishBatchAction,
  getBatchProgressAction,
  retryPublishBatchAction,
  startPublishBatchAction,
} from "@/lib/actions/publish-batch";

/**
 * "Chop etishga tayyorlar" boshqaruv paneli.
 *
 * Barcha og'ir ish serverda: bu komponent navbat yaratadi va HAQIQIY holatni
 * so'rab turadi. Hech qanday soxta taymer yo'q — foizi ham, ETA ham batch
 * jadvalidagi tugagan itemlardan hisoblanadi, to'lov so'rovi progressi esa
 * haqiqatda yuborilgan bo'laklardan.
 */

/** Candidates per payment-ask request, so the bar advances several times. */
const PAYMENT_CHUNK_SIZE = 4;
/** How often the running batch is re-read. */
const POLL_INTERVAL_MS = 3000;

interface Props {
  rows: PublishQueueRow[];
  summary: PublishQueueSummary;
  view: "ready" | "unpaid";
  /** Tashkent calendar date the board is showing. */
  date: string;
  /** Today in Tashkent, for the "Bugun" shortcut and the max on the picker. */
  today: string;
  initialProgress: BatchProgress | null;
  canPublish: boolean;
  canAskPayment: boolean;
}

export function PublishQueueClient({
  rows,
  summary,
  view,
  date,
  today,
  initialProgress,
  canPublish,
  canAskPayment,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(initialProgress);
  const [paymentRun, setPaymentRun] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(
    () =>
      view === "unpaid"
        ? rows.filter((r) => r.paymentStatus !== "paid" && r.status !== "published")
        : rows,
    [rows, view],
  );

  /**
   * Candidates a batch can actually act on: paid, not yet published, and not
   * someone already on the site under the same name.
   */
  const eligible = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.paymentStatus === "paid" &&
          !r.alreadyPublished &&
          !r.blacklisted &&
          // Either still to publish, or published and still owed a post.
          (r.status !== "published" || r.postPending),
      ),
    [rows],
  );
  const eligibleIds = useMemo(() => new Set(eligible.map((r) => r.id)), [eligible]);

  const selectedEligible = useMemo(
    () => [...selected].filter((id) => eligibleIds.has(id)),
    [selected, eligibleIds],
  );

  /* ----------------------------- polling ----------------------------- */

  const batchId = progress?.id ?? null;
  const batchRunning = progress ? ["queued", "running"].includes(progress.status) : false;

  // The interval only exists while a batch is actually running, so a finished
  // board stops polling by itself rather than asking the server forever.
  useEffect(() => {
    if (!batchId || !batchRunning) return;
    let stopped = false;

    const tick = async () => {
      try {
        const next = await getBatchProgressAction(batchId);
        if (stopped || !next) return;
        setProgress(next);
        // The table's own columns (status, stage, result links) come from the
        // server render, so the run reaching a terminal state needs one
        // refresh to show what it produced.
        if (!["queued", "running"].includes(next.status)) router.refresh();
      } catch {
        /* a dropped poll is retried on the next tick */
      }
    };

    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [batchId, batchRunning, router]);

  /* ----------------------------- actions ----------------------------- */

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const startBatch = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const ids = selectionMode && selectedEligible.length > 0 ? selectedEligible : null;
      // The date travels with the request: pressing the button on an archive
      // day must queue that day, not today's.
      const result = await startPublishBatchAction(ids, date);
      if (!result.ok) {
        toast("error", "Batch boshlanmadi", result.error);
        return;
      }
      toast("success", "Navbat yaratildi", `${result.total} ta nomzod ketma-ket qayta ishlanadi.`);
      setSelectionMode(false);
      setSelected(new Set());
      const fresh = result.batchId ? await getBatchProgressAction(result.batchId) : null;
      setProgress(fresh);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!batchId) return;
    setBusy(true);
    try {
      await cancelPublishBatchAction(batchId);
      setProgress(await getBatchProgressAction(batchId));
      toast("warning", "Batch bekor qilindi", "Joriy nomzod tugagach yangi ish boshlanmaydi.");
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!batchId) return;
    setBusy(true);
    try {
      const result = await retryPublishBatchAction(batchId);
      setProgress(await getBatchProgressAction(batchId));
      toast("info", "Qayta navbatga qo‘yildi", `${result.requeued ?? 0} ta nomzod.`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Asks the editorial chats about everyone whose payment is still open.
   *
   * Driven chunk by chunk from here so the bar below reports candidates that
   * have genuinely been sent, rather than animating towards a guess.
   */
  const askPayment = async () => {
    const targets = (selectionMode && selected.size > 0
      ? visible.filter((r) => selected.has(r.id))
      : visible
    ).filter((r) => r.paymentStatus !== "paid" && r.status !== "published");

    if (targets.length === 0) {
      toast("info", "So‘raladigan nomzod yo‘q", "Bugungi barcha to‘lovlar tasdiqlangan.");
      return;
    }

    setBusy(true);
    setPaymentRun({ done: 0, total: targets.length });
    let asked = 0;
    let failed = 0;
    try {
      for (let i = 0; i < targets.length; i += PAYMENT_CHUNK_SIZE) {
        const chunk = targets.slice(i, i + PAYMENT_CHUNK_SIZE);
        const result = await askPaymentChunkAction(chunk.map((r) => r.id));
        if (!result.ok) {
          toast("error", "To‘lov so‘rovi yuborilmadi", result.error);
          break;
        }
        asked += result.asked;
        failed += result.failed;
        setPaymentRun({ done: Math.min(i + chunk.length, targets.length), total: targets.length });
      }
      toast(
        failed > 0 ? "warning" : "success",
        "To‘lov so‘rovi yuborildi",
        `${asked} ta nomzod bo‘yicha savol ketdi${failed > 0 ? `, ${failed} tasida xato` : ""}.`,
      );
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
      // The finished bar stays visible for a moment so the last step is seen.
      setTimeout(() => setPaymentRun(null), 2500);
    }
  };

  const batchLabel =
    selectionMode && selectedEligible.length > 0
      ? `Tanlanganlarni chop etish (${selectedEligible.length})`
      : `Barchasini chop etish (${eligible.length})`;

  const goToDate = (next: string) => {
    startTransition(() => {
      router.push(
        `/nomzodlar/anketalar/chop-etishga-tayyorlar?view=${view}&date=${next}`,
      );
    });
  };

  return (
    <div className="space-y-4">
      <DatePicker
        date={date}
        today={today}
        busy={pending}
        onChange={goToDate}
        count={summary.total}
      />

      <SummaryCards summary={summary} />

      {/* ----------------------------- actions ----------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {canPublish && (
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={busy || batchRunning || eligible.length === 0}
          >
            <Rocket className="h-4 w-4" />
            {batchLabel}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            setSelectionMode((v) => !v);
            setSelected(new Set());
          }}
          disabled={busy}
        >
          <CheckSquare className="h-4 w-4" />
          {selectionMode ? "Belgilashni yopish" : "Maxsus belgilash"}
        </Button>
        {canAskPayment && (
          <Button variant="secondary" onClick={askPayment} disabled={busy}>
            <CircleDollarSign className="h-4 w-4" />
            To‘lovni so‘rash
          </Button>
        )}
        {selectionMode && (
          <>
            <button
              type="button"
              onClick={() => setSelected(new Set(visible.map((r) => r.id)))}
              className="text-xs font-bold text-brand hover:underline"
            >
              Barchasini tanlash
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs font-bold text-ink-soft hover:underline"
            >
              Tanlovni bekor qilish
            </button>
            <span className="text-xs text-ink-soft">{selected.size} ta tanlangan</span>
          </>
        )}
      </div>

      {paymentRun && (
        <ProgressPanel
          title="To‘lov so‘rovi yuborilmoqda"
          done={paymentRun.done}
          total={paymentRun.total}
          accent="amber"
        />
      )}

      {progress && <BatchPanel progress={progress} onCancel={cancel} onRetry={retry} busy={busy} />}

      {/* ----------------------------- table ----------------------------- */}
      <div className="overflow-x-auto rounded-panel border border-line bg-card">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.1em] text-ink-soft">
              {selectionMode && <th className="w-10 px-3 py-3" />}
              <th className="px-3 py-3">Nomzod</th>
              <th className="px-3 py-3">Telefon</th>
              <th className="px-3 py-3">Yuborilgan</th>
              <th className="px-3 py-3">To‘lov</th>
              <th className="px-3 py-3">Holat</th>
              <th className="px-3 py-3">Joriy bosqich</th>
              <th className="px-3 py-3">Natija</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <QueueRow
                key={row.id}
                row={row}
                selectionMode={selectionMode}
                selected={selected.has(row.id)}
                onToggle={toggle}
              />
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title={
              view === "unpaid"
                ? "To‘lov qilmaganlar yo‘q"
                : date === today
                  ? "Bugun anketa yo‘q"
                  : `${date} kuni anketa yo‘q`
            }
            description={
              view === "unpaid"
                ? "Bu kundagi barcha nomzodlarning to‘lovi tasdiqlangan."
                : `${date} (Toshkent vaqti bilan) sanasida hech kim anketa yubormagan. Yuqoridagi kalendardan boshqa kunni tanlang.`
            }
          />
        )}
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Chop etishni boshlash">
        <p className="text-sm text-ink">
          <b>
            {selectionMode && selectedEligible.length > 0
              ? selectedEligible.length
              : eligible.length}
          </b>{" "}
          ta nomzod ketma-ket qayta ishlanadi.
        </p>
        {summary.postPending > 0 && (
          <p className="mt-2 rounded-[12px] border border-peach/60 bg-amber/10 px-3 py-2 text-xs text-ink">
            Avval <b>{summary.postPending} ta</b> posti chiqmay qolgan nomzod navbatma-navbat
            tugatiladi, keyin qolganlari davom etadi.
          </p>
        )}
        <ol className="mt-3 space-y-1 text-sm text-ink-soft">
          <li>1. Jaxongir AI — javoblarni yaxshilash</li>
          <li>2. Tasdiqlash</li>
          <li>3. Nomzodga aylantirish</li>
          <li>4. Maqolani nashr qilish</li>
          <li>5. Post yaratish va render</li>
          <li>6. Telegramga yuborish</li>
        </ol>
        <p className="mt-3 rounded-[12px] bg-surface px-3 py-2 text-xs text-ink-soft">
          Navbat serverda saqlanadi — sahifani yopsangiz ham ish davom etadi.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            Bekor qilish
          </Button>
          <Button onClick={startBatch} disabled={busy || pending}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Boshlash
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

/**
 * The day the board is showing.
 *
 * Arrows and the native picker all push a `?date=` URL rather than holding the
 * date in component state, so the view is linkable, survives a reload, and the
 * server does the filtering — the client never slices a cached list.
 */
function DatePicker({
  date,
  today,
  busy,
  count,
  onChange,
}: {
  date: string;
  today: string;
  busy: boolean;
  count: number;
  onChange: (next: string) => void;
}) {
  const isToday = date === today;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-panel border border-line bg-card px-3 py-2.5">
      <CalendarDays className="h-4 w-4 shrink-0 text-brand" />

      <button
        type="button"
        onClick={() => onChange(shiftDate(date, -1))}
        disabled={busy}
        aria-label="Oldingi kun"
        className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-brand/50 hover:text-ink disabled:opacity-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <input
        type="date"
        value={date}
        // Future days hold nothing: submissions cannot arrive before they exist.
        max={today}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        className="h-9 rounded-[12px] border border-line bg-surface px-3 text-sm font-semibold text-ink focus:border-brand/60 focus:outline-2 focus:outline-brand/25"
      />

      <button
        type="button"
        onClick={() => onChange(shiftDate(date, 1))}
        disabled={busy || isToday}
        aria-label="Keyingi kun"
        className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-brand/50 hover:text-ink disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(today)}
          disabled={busy}
          className="rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-bold text-brand transition hover:bg-brand/15"
        >
          Bugunga qaytish
        </button>
      )}

      <span className="ml-auto flex items-center gap-2 text-xs text-ink-soft">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {isToday ? "Bugun" : "Arxiv"} · {count} ta anketa
      </span>
    </div>
  );
}

/** Calendar arithmetic on the YYYY-MM-DD string, with no timezone in play. */
function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function SummaryCards({ summary }: { summary: PublishQueueSummary }) {
  const cards = [
    { label: "Yuborilgan", value: summary.total, accent: "text-brand" },
    { label: "Chop etishga tayyor", value: summary.ready, accent: "text-green" },
    { label: "To‘lov qilmagan", value: summary.unpaid, accent: "text-coral" },
    { label: "Javob kutilmoqda", value: summary.unknown, accent: "text-amber" },
    { label: "Chop etilgan", value: summary.published, accent: "text-electric" },
    { label: "Posti kutilmoqda", value: summary.postPending, accent: "text-amber" },
    { label: "Avval chiqqan", value: summary.duplicates, accent: "text-[#6a52c7]" },
    { label: "Qora ro‘yxat", value: summary.blacklisted, accent: "text-coral" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-8">
      {cards.map((c) => (
        <div key={c.label} className="rounded-panel border border-line bg-card px-4 py-3">
          <p className={cn("font-display text-2xl font-semibold", c.accent)}>{c.value}</p>
          <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">
            {c.label}
          </p>
        </div>
      ))}
    </div>
  );
}

function ProgressPanel({
  title,
  done,
  total,
  accent,
}: {
  title: string;
  done: number;
  total: number;
  accent: "amber" | "brand";
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="rounded-panel border border-line bg-card px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="text-xs text-ink-soft">
          {done} / {total} tekshirildi · {percent}%
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            accent === "amber" ? "bg-amber" : "bg-brand",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function BatchPanel({
  progress,
  onCancel,
  onRetry,
  busy,
}: {
  progress: BatchProgress;
  onCancel: () => void;
  onRetry: () => void;
  busy: boolean;
}) {
  const running = ["queued", "running"].includes(progress.status);
  const failed = progress.failed + progress.items.filter((i) => i.status === "needs_review").length;

  return (
    <div className="rounded-panel border border-line bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide text-ink">
            {running && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
            Chop etish jarayoni
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            <BatchStatusBadge status={progress.status} /> · {progress.processed} / {progress.total}{" "}
            nomzod · {progress.percent}%
          </p>
        </div>
        <div className="flex gap-2">
          {running && (
            <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
              <XCircle className="h-3.5 w-3.5" /> Bekor qilish
            </Button>
          )}
          {!running && failed > 0 && (
            <Button variant="secondary" size="sm" onClick={onRetry} disabled={busy}>
              <RotateCcw className="h-3.5 w-3.5" /> Faqat xatolarni qayta ishlash
            </Button>
          )}
        </div>
      </div>

      <div className="h-2.5 overflow-hidden rounded-full bg-line">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            progress.failed > 0 ? "bg-amber" : "bg-gradient-to-r from-brand to-electric",
          )}
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-4">
        {running && progress.currentName && (
          <>
            <Field label="Hozir" value={progress.currentName} />
            <Field label="Bosqich" value={progress.currentStage ?? "—"} />
          </>
        )}
        <Field label="O‘tgan vaqt" value={formatDuration(progress.elapsedMs)} />
        <Field
          label="Taxminiy qolgan"
          value={
            progress.etaMs != null
              ? `~ ${formatDuration(progress.etaMs)}`
              : running
                ? "hisoblanmoqda…"
                : "—"
          }
        />
        <Field label="Muvaffaqiyatli" value={String(progress.completed)} />
        <Field label="Xato / tekshirish" value={String(failed)} />
        {progress.skipped > 0 && (
          <Field label="O‘tkazib yuborilgan" value={String(progress.skipped)} />
        )}
      </dl>

      {!running && (
        <div className="mt-3 space-y-1 border-t border-line pt-3">
          {progress.items
            .filter((i) => i.error)
            .slice(0, 6)
            .map((item) => (
              <p key={item.id} className="text-xs text-ink-soft">
                <span className="font-semibold text-ink">{item.fullName}</span> — {item.error}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="truncate font-semibold text-ink">{value}</dd>
    </div>
  );
}

const BATCH_STATUS_LABELS: Record<string, { label: string; accent: "cyan" | "green" | "amber" | "coral" | "neutral" }> = {
  queued: { label: "Navbatda", accent: "cyan" },
  running: { label: "Ishlamoqda", accent: "cyan" },
  paused: { label: "To‘xtatilgan", accent: "amber" },
  completed: { label: "Yakunlandi", accent: "green" },
  completed_with_errors: { label: "Xatolar bilan yakunlandi", accent: "amber" },
  failed: { label: "Muvaffaqiyatsiz", accent: "coral" },
  cancelled: { label: "Bekor qilingan", accent: "neutral" },
};

function BatchStatusBadge({ status }: { status: string }) {
  const meta = BATCH_STATUS_LABELS[status] ?? { label: status, accent: "neutral" as const };
  return <Badge accent={meta.accent}>{meta.label}</Badge>;
}

const ITEM_STATUS_LABELS: Record<string, string> = {
  queued: "Kutilmoqda",
  running: "Ishlanmoqda",
  completed: "Tayyor",
  failed: "Xato",
  needs_review: "Tekshirish kerak",
  skipped: "O‘tkazib yuborilgan",
  cancelled: "Bekor qilingan",
};

function QueueRow({
  row,
  selectionMode,
  selected,
  onToggle,
}: {
  row: PublishQueueRow;
  selectionMode: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <tr className="border-b border-line/70 last:border-0 hover:bg-surface/60">
      {selectionMode && (
        <td className="px-3 py-2.5">
          <button
            type="button"
            onClick={() => onToggle(row.id)}
            aria-pressed={selected}
            aria-label={`${row.fullName} — tanlash`}
            className="text-ink-soft transition hover:text-brand"
          >
            {selected ? (
              <CheckSquare className="h-4 w-4 text-brand" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </button>
        </td>
      )}
      <td className="px-3 py-2.5">
        <Link
          href={`/nomzodlar/anketalar/${row.id}`}
          className="flex items-center gap-2.5 hover:underline"
        >
          <Avatar name={row.fullName} size={32} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{row.fullName}</span>
            {row.telegramUsername && (
              <span className="block truncate text-[11px] text-ink-soft">
                {row.telegramUsername}
              </span>
            )}
          </span>
        </Link>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-soft">{row.phone ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-soft">
        {formatTashkent(row.submittedAt)}
      </td>
      <td className="px-3 py-2.5">
        <PaymentBadge status={row.paymentStatus} askCount={row.paymentAskCount} />
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-3 py-2.5 text-xs text-ink-soft">
        {row.blacklisted ? (
          <span className="font-semibold text-coral">Qora ro‘yxat</span>
        ) : row.alreadyPublished ? (
          <span className="font-semibold text-[#6a52c7]">Avval chiqqan</span>
        ) : row.postPending && !row.batchItemStatus ? (
          <span className="font-semibold text-amber">Posti kutilmoqda</span>
        ) : row.batchItemStatus === "running" ? (
          row.batchStage ?? "Ishlanmoqda"
        ) : row.batchItemStatus ? (
          ITEM_STATUS_LABELS[row.batchItemStatus] ?? row.batchItemStatus
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2.5 text-xs">
        <div className="flex flex-wrap gap-2">
          {row.candidateSlug && (
            <Link href={`/candidates/${row.candidateId}`} className="font-semibold text-brand hover:underline">
              Nomzod
            </Link>
          )}
          {row.postId && (
            <Link href={`/postlar/${row.postId}`} className="font-semibold text-electric hover:underline">
              Post
            </Link>
          )}
          {row.alreadyPublished && !row.candidateSlug && (
            <Link
              href={`/candidates/${row.alreadyPublished.candidateId}`}
              className="font-semibold text-[#6a52c7] hover:underline"
            >
              Mavjud maqola
            </Link>
          )}
          {!row.candidateSlug && !row.postId && !row.alreadyPublished && (
            <span className="text-ink-soft">—</span>
          )}
        </div>
        {row.pipelineError && (
          <p className="mt-1 max-w-[220px] truncate text-[11px] text-coral" title={row.pipelineError}>
            {row.pipelineError}
          </p>
        )}
      </td>
    </tr>
  );
}

function PaymentBadge({ status, askCount }: { status: string; askCount: number }) {
  if (status === "paid") return <Badge accent="green">To‘lagan</Badge>;
  if (status === "unpaid") return <Badge accent="coral">To‘lamagan</Badge>;
  // Never rendered as "unpaid": no answer is not the same as a refusal, and
  // showing it as one is how the wrong person gets held back from publishing.
  return (
    <Badge accent="amber">
      Noma’lum{askCount > 0 ? ` · ${askCount}×` : ""}
    </Badge>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} s ${minutes % 60} d`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

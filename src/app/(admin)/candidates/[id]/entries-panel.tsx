"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PencilLine, Plus, Trash2 } from "lucide-react";
import { Button, FormField, Input, Textarea } from "@/components/ui/primitives";
import { ConfirmDialog, Modal } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  addCandidateEntryAction,
  deleteCandidateEntryAction,
  updateCandidateEntryAction,
  type EntryKind,
} from "@/lib/actions/candidates";
import { formatDate } from "@/lib/utils";

export interface EntryRow {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  date_from: string | null;
  date_to: string | null;
  url: string | null;
}

const KIND_LABELS: Record<EntryKind, { title: string; itemLabel: string; subtitleLabel: string }> = {
  education: { title: "Ta’lim", itemLabel: "O‘quv muassasasi", subtitleLabel: "Yo‘nalish / daraja" },
  work: { title: "Ish tajribasi", itemLabel: "Tashkilot", subtitleLabel: "Lavozim" },
  achievement: { title: "Yutuqlar", itemLabel: "Yutuq nomi", subtitleLabel: "Beruvchi tashkilot" },
  event: { title: "Tadbirlar", itemLabel: "Tadbir nomi", subtitleLabel: "Rol / joy" },
  book: { title: "O‘qilgan kitoblar", itemLabel: "Kitob nomi", subtitleLabel: "Muallif" },
  social: { title: "Ijtimoiy tarmoqlar", itemLabel: "Ijtimoiy tarmoq nomi", subtitleLabel: "" },
};

export function EntriesPanel({
  candidateId,
  kind,
  entries,
  canEdit,
}: {
  candidateId: string;
  kind: EntryKind;
  entries: EntryRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingDelete, setPendingDelete] = useState<EntryRow | null>(null);
  const deleteTarget = canEdit && pendingDelete && entries.includes(pendingDelete) ? pendingDelete : null;
  const labels = KIND_LABELS[kind];

  const deleteEntry = (entry: EntryRow) => {
    startTransition(async () => {
      const res = await deleteCandidateEntryAction(candidateId, kind, entry.id);
      if (res.ok) {
        setPendingDelete(null);
        toast("success", "O‘chirildi");
        router.refresh();
      } else toast("error", "Xatolik", res.error);
    });
  };

  return (
    <section className="rounded-card border border-line bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">{labels.title}</h3>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4" /> Qo‘shish
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="py-3 text-sm text-ink-soft">Hozircha yozuv yo‘q</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start gap-3 rounded-[14px] border border-line/70 p-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan" />
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-sm font-bold text-ink">{e.title}</p>
                {e.subtitle && <p className="text-xs text-ink-soft">{e.subtitle}</p>}
                {e.description && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{e.description}</p>
                )}
                {(e.date_from || e.date_to) && (
                  <p className="mt-1 text-[11px] font-semibold text-brand">
                    {formatDate(e.date_from)} {e.date_to ? `— ${formatDate(e.date_to)}` : ""}
                  </p>
                )}
                {e.url && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-[11px] text-electric hover:underline"
                  >
                    {e.url}
                  </a>
                )}
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-1">
                <button type="button" disabled={pending} aria-label={`${e.title} — tahrirlash`}
                  onClick={() => { setEditing(e); setOpen(true); }}
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand transition hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50">
                  <PencilLine className="h-4 w-4" aria-hidden="true" /> Tahrirlash
                </button>
                <button
                  type="button"
                  aria-label={`${e.title} — o‘chirish`}
                  disabled={pending}
                  onClick={() => setPendingDelete(e)}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-coral transition hover:bg-coral/10 focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  O‘chirish
                </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => { if (!pending) setPendingDelete(null); }}
        onConfirm={() => { if (deleteTarget) deleteEntry(deleteTarget); }}
        title={kind === "social" ? "Ijtimoiy tarmoqni o‘chirish" : "Yozuvni o‘chirish"}
        description={`“${deleteTarget?.title ?? ""}${deleteTarget?.subtitle ? ` — ${deleteTarget.subtitle}` : ""}” ${kind === "social" ? "havolasi" : "yozuvi"} o‘chirilsinmi?`}
        confirmLabel="Ha, o‘chirish"
        danger
        loading={pending}
      />

      <Modal open={open} onClose={() => { if (!pending) setOpen(false); }} title={`${labels.title} ${editing ? "tahrirlash" : "qo‘shish"}`}>
        <form
          key={editing?.id ?? "new"}
          action={(fd) =>
            startTransition(async () => {
              const res = editing
                ? await updateCandidateEntryAction(candidateId, kind, editing.id, fd)
                : await addCandidateEntryAction(candidateId, kind, fd);
              if (res.ok) {
                toast("success", editing ? "Saqlandi" : "Qo‘shildi");
                setOpen(false);
                router.refresh();
              } else toast("error", "Xatolik", res.error);
            })
          }
          className="space-y-4"
        >
          <FormField label={labels.itemLabel} htmlFor={`${kind}-title`}>
            <Input id={`${kind}-title`} name="title" defaultValue={editing?.title ?? ""} required minLength={2} />
          </FormField>
          {kind !== "social" && (
            <>
              <FormField label={labels.subtitleLabel} htmlFor={`${kind}-subtitle`}>
                <Input id={`${kind}-subtitle`} name="subtitle" defaultValue={editing?.subtitle ?? ""} />
              </FormField>
              <FormField label="Tavsif" htmlFor={`${kind}-desc`}>
                <Textarea id={`${kind}-desc`} name="description" defaultValue={editing?.description ?? ""} rows={3} />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Boshlanish" htmlFor={`${kind}-from`}>
                  <Input id={`${kind}-from`} name="date_from" defaultValue={editing?.date_from?.slice(0, 10) ?? ""} type="date" />
                </FormField>
                <FormField label="Tugash" htmlFor={`${kind}-to`}>
                  <Input id={`${kind}-to`} name="date_to" defaultValue={editing?.date_to?.slice(0, 10) ?? ""} type="date" />
                </FormField>
              </div>
            </>
          )}
          <FormField label={kind === "social" ? "Havola" : "Havola (ixtiyoriy)"} htmlFor={`${kind}-url`}>
            <Input id={`${kind}-url`} name="url" defaultValue={editing?.url ?? ""} type="url" placeholder="https://" required={kind === "social"} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saqlanmoqda…" : editing ? "Saqlash" : "Qo‘shish"}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

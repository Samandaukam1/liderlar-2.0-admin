"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, FormField, Input, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import {
  addCandidateEntryAction,
  deleteCandidateEntryAction,
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
  social: { title: "Ijtimoiy tarmoqlar", itemLabel: "Tarmoq nomi", subtitleLabel: "Foydalanuvchi nomi" },
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
  const [pending, startTransition] = useTransition();
  const labels = KIND_LABELS[kind];

  return (
    <section className="rounded-card border border-line bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">{labels.title}</h3>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Qo‘shish
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="py-3 text-sm text-ink-soft">Hozircha yozuv yo‘q</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="group flex items-start gap-3 rounded-[14px] border border-line/70 p-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan" />
              <div className="min-w-0 flex-1">
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
                <button
                  aria-label="O‘chirish"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deleteCandidateEntryAction(candidateId, kind, e.id);
                      if (res.ok) {
                        toast("success", "O‘chirildi");
                        router.refresh();
                      } else toast("error", "Xatolik", res.error);
                    })
                  }
                  className="rounded-lg p-1.5 text-ink-soft/50 opacity-0 transition hover:bg-coral/10 hover:text-coral group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={`${labels.title} qo‘shish`}>
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await addCandidateEntryAction(candidateId, kind, fd);
              if (res.ok) {
                toast("success", "Qo‘shildi");
                setOpen(false);
                router.refresh();
              } else toast("error", "Xatolik", res.error);
            })
          }
          className="space-y-4"
        >
          <FormField label={labels.itemLabel} htmlFor={`${kind}-title`}>
            <Input id={`${kind}-title`} name="title" required minLength={2} />
          </FormField>
          <FormField label={labels.subtitleLabel} htmlFor={`${kind}-subtitle`}>
            <Input id={`${kind}-subtitle`} name="subtitle" />
          </FormField>
          <FormField label="Tavsif" htmlFor={`${kind}-desc`}>
            <Textarea id={`${kind}-desc`} name="description" rows={3} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Boshlanish" htmlFor={`${kind}-from`}>
              <Input id={`${kind}-from`} name="date_from" type="date" />
            </FormField>
            <FormField label="Tugash" htmlFor={`${kind}-to`}>
              <Input id={`${kind}-to`} name="date_to" type="date" />
            </FormField>
          </div>
          <FormField label="Havola (ixtiyoriy)" htmlFor={`${kind}-url`}>
            <Input id={`${kind}-url`} name="url" type="url" placeholder="https://" />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saqlanmoqda…" : "Qo‘shish"}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

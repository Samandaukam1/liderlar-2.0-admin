"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button, FormField, Input, Select } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import { setTop100Action } from "@/lib/actions/content";

export function AddToTop100({
  candidates,
}: {
  candidates: Array<{ id: string; full_name: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [candidateId, setCandidateId] = useState("");
  const [position, setPosition] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Ro‘yxatga qo‘shish
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="TOP 100 ga qo‘shish">
        <div className="space-y-4">
          <FormField label="Nomzod" htmlFor="t100-candidate">
            <Select id="t100-candidate" value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
              <option value="">Tanlang…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Pozitsiya (1–100)" htmlFor="t100-pos">
            <Input id="t100-pos" type="number" min={1} max={100} value={position} onChange={(e) => setPosition(e.target.value)} />
          </FormField>
          <div className="flex justify-end">
            <Button
              disabled={!candidateId || !position || pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await setTop100Action(candidateId, parseInt(position, 10));
                  if (res.ok) {
                    toast("success", "TOP 100 ga qo‘shildi");
                    setOpen(false);
                    setCandidateId("");
                    setPosition("");
                    router.refresh();
                  } else toast("error", "Xatolik", res.error);
                })
              }
            >
              {pending ? "Saqlanmoqda…" : "Qo‘shish"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function Top100RowControls({
  candidateId,
  position,
}: {
  candidateId: string;
  position: number | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(position?.toString() ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Input
        type="number"
        min={1}
        max={100}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Pozitsiya"
        className="h-8 w-20 text-center text-sm font-bold"
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={pending || !value || parseInt(value, 10) === position}
        onClick={() =>
          startTransition(async () => {
            const res = await setTop100Action(candidateId, parseInt(value, 10));
            if (res.ok) {
              toast("success", "Pozitsiya yangilandi");
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          })
        }
      >
        Saqlash
      </Button>
      <button
        title="Ro‘yxatdan olib tashlash"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await setTop100Action(candidateId, null);
            if (res.ok) {
              toast("success", "Ro‘yxatdan olib tashlandi");
              router.refresh();
            } else toast("error", "Xatolik", res.error);
          })
        }
        className="rounded-lg p-1.5 text-ink-soft transition hover:bg-coral/10 hover:text-coral"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
